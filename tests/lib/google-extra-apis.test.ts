import { describe, it, expect, vi, beforeEach } from 'vitest';

// Three APIs the GBP audit could not reach. Two are switched off on the Cloud
// project (JSON 403 SERVICE_DISABLED, fixed by one click). The third answers
// Google's HTML 404 page on every path including its own discovery doc, which
// enabling an API does not fix. The audit has to tell those apart.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));

const { fetchPlaceActionLinks } = await import('@/lib/google-place-actions');
const { fetchVoiceOfMerchantState, fetchVerifications } = await import(
  '@/lib/google-verifications'
);
const { fetchQuestions } = await import('@/lib/google-qanda');

const target = { googleAccountId: 'ga1', locationName: 'locations/123' };

function serviceDisabled(service: string) {
  return {
    response: {
      status: 403,
      data: {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: `${service} has not been used in project 25337394982 before or it is disabled.`,
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'SERVICE_DISABLED',
              domain: 'googleapis.com',
              metadata: {
                service,
                activationUrl: `https://console.developers.google.com/apis/api/${service}/overview?project=25337394982`,
              },
            },
          ],
        },
      },
    },
  };
}

const htmlShell404 = {
  response: { status: 404, data: '<!DOCTYPE html>\n<html lang=en>...' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

describe('fetchPlaceActionLinks', () => {
  it('returns the links and pages to the end', async () => {
    mocks.request
      .mockResolvedValueOnce({
        data: {
          placeActionLinks: [
            { placeActionType: 'APPOINTMENT', uri: 'https://book.example.com' },
          ],
          nextPageToken: 'p2',
        },
      })
      .mockResolvedValueOnce({
        data: { placeActionLinks: [{ placeActionType: 'SHOP_ONLINE', uri: 'https://shop.test' }] },
      });

    const result = await fetchPlaceActionLinks(target);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('calls the placeActionLinks collection on the place actions host', async () => {
    mocks.request.mockResolvedValue({ data: { placeActionLinks: [] } });
    await fetchPlaceActionLinks(target);

    expect((mocks.request.mock.calls[0][0] as { url: string }).url).toContain(
      'https://mybusinessplaceactions.googleapis.com/v1/locations/123/placeActionLinks'
    );
  });

  it('reports the disabled API with its activation URL rather than "none set"', async () => {
    mocks.request.mockRejectedValue(
      serviceDisabled('mybusinessplaceactions.googleapis.com')
    );

    const result = await fetchPlaceActionLinks(target);
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.unavailable?.reason).toBe('SERVICE_DISABLED');
    expect(result.unavailable?.activationUrl).toContain('project=25337394982');
  });

  it('distinguishes an empty result from an unreachable API', async () => {
    mocks.request.mockResolvedValue({ data: {} });

    const result = await fetchPlaceActionLinks(target);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.unavailable).toBeUndefined();
  });
});

describe('fetchVoiceOfMerchantState', () => {
  it('uses the capitalised VoiceOfMerchantState path segment', async () => {
    mocks.request.mockResolvedValue({ data: { hasVoiceOfMerchant: true } });
    const result = await fetchVoiceOfMerchantState(target);

    expect(result.data?.hasVoiceOfMerchant).toBe(true);
    expect((mocks.request.mock.calls[0][0] as { url: string }).url).toBe(
      'https://mybusinessverifications.googleapis.com/v1/locations/123/VoiceOfMerchantState'
    );
  });

  it('reports the disabled API', async () => {
    mocks.request.mockRejectedValue(
      serviceDisabled('mybusinessverifications.googleapis.com')
    );

    const result = await fetchVoiceOfMerchantState(target);
    expect(result.unavailable?.reason).toBe('SERVICE_DISABLED');
  });
});

describe('fetchVerifications', () => {
  it('returns the verification attempts', async () => {
    mocks.request.mockResolvedValue({
      data: { verifications: [{ method: 'ADDRESS', state: 'COMPLETED' }] },
    });

    const result = await fetchVerifications(target);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
  });
});

describe('fetchQuestions', () => {
  it('lists questions with their answers from the Q&A host', async () => {
    mocks.request.mockResolvedValue({
      data: { questions: [{ text: 'Do you do repairs?', totalAnswerCount: 0 }] },
    });

    const result = await fetchQuestions(target);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].totalAnswerCount).toBe(0);
    const url = (mocks.request.mock.calls[0][0] as { url: string }).url;
    expect(url).toContain('https://mybusinessqanda.googleapis.com/v1/locations/123/questions');
    expect(url).toContain('answersPerQuestion=10');
  });

  // The correction that matters: the Q&A host 404s on every path, so this is
  // NOT the disabled-API case and enabling the API in the console will not fix
  // it. Anything that reports it must not send someone to the Cloud console.
  it('reports NOT_ROUTED, not SERVICE_DISABLED, for the HTML 404', async () => {
    mocks.request.mockRejectedValue(htmlShell404);

    const result = await fetchQuestions(target);
    expect(result.ok).toBe(false);
    expect(result.unavailable?.reason).toBe('NOT_ROUTED');
    expect(result.unavailable?.activationUrl).toBeUndefined();
    expect(result.error).toContain('not a disabled-API error');
  });
});
