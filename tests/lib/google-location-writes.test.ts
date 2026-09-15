import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every Location field write goes out as PATCH {location}?updateMask=<field>.
// The masks and payload shapes here were validated against a live profile on
// 2026-09-14 with validateOnly=true, so this file is what stops them drifting.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));

const {
  pushDescriptionToGBP,
  pushServicesToGBP,
  pushHoursToGBP,
  pushSpecialHoursToGBP,
  pushWebsiteToGBP,
  pushCategoriesToGBP,
  pushTitleToGBP,
  pushPhoneNumbersToGBP,
  pushServiceAreaToGBP,
} = await import('@/lib/google-business-info');

const target = { googleAccountId: 'ga1', locationName: 'locations/123' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ data: {} });
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

/** The single call the push made, decomposed. */
function sentRequest() {
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const call = mocks.request.mock.calls[0][0] as {
    url: string;
    method: string;
    data: Record<string, unknown>;
  };
  const url = new URL(call.url);
  return {
    method: call.method,
    path: url.pathname,
    updateMask: url.searchParams.get('updateMask'),
    validateOnly: url.searchParams.get('validateOnly'),
    body: call.data,
  };
}

describe('Location field pushes', () => {
  it('sends regularHours under the regularHours mask', async () => {
    const regularHours = {
      periods: [
        {
          openDay: 'MONDAY',
          openTime: { hours: 7 },
          closeDay: 'MONDAY',
          closeTime: { hours: 21 },
        },
      ],
    };
    const result = await pushHoursToGBP({ ...target, regularHours });

    expect(result).toEqual({ success: true });
    const sent = sentRequest();
    expect(sent.method).toBe('PATCH');
    expect(sent.path).toBe('/v1/locations/123');
    expect(sent.updateMask).toBe('regularHours');
    expect(sent.body).toEqual({ regularHours });
  });

  it('sends specialHours under the specialHours mask', async () => {
    const specialHours = {
      specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
      ],
    };
    await pushSpecialHoursToGBP({ ...target, specialHours });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('specialHours');
    expect(sent.body).toEqual({ specialHours });
  });

  it('sends websiteUri under the websiteUri mask', async () => {
    await pushWebsiteToGBP({ ...target, websiteUri: 'https://example.com' });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('websiteUri');
    expect(sent.body).toEqual({ websiteUri: 'https://example.com' });
  });

  it('sends the whole categories object, names only', async () => {
    // Clients are prohibited from updating the primary or additional
    // categories individually through the update mask, so both travel
    // together; displayName/serviceTypes are output-only on Category.
    await pushCategoriesToGBP({
      ...target,
      primaryCategoryId: 'categories/gcid:gutter_service',
      additionalCategoryIds: ['categories/gcid:gutter_cleaning_service'],
    });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('categories');
    expect(sent.body).toEqual({
      categories: {
        primaryCategory: { name: 'categories/gcid:gutter_service' },
        additionalCategories: [
          { name: 'categories/gcid:gutter_cleaning_service' },
        ],
      },
    });
  });

  it('omits additionalCategories entirely when none are given', async () => {
    await pushCategoriesToGBP({
      ...target,
      primaryCategoryId: 'categories/gcid:plumber',
    });

    const categories = sentRequest().body.categories as Record<string, unknown>;
    expect(categories).not.toHaveProperty('additionalCategories');
  });

  it('sends title under the title mask', async () => {
    await pushTitleToGBP({ ...target, title: 'Badger Gutters' });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('title');
    expect(sent.body).toEqual({ title: 'Badger Gutters' });
  });

  it('sends phoneNumbers under the phoneNumbers mask', async () => {
    await pushPhoneNumbersToGBP({
      ...target,
      primaryPhone: '(980) 480-8383',
      additionalPhones: ['(704) 555-0100'],
    });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('phoneNumbers');
    expect(sent.body).toEqual({
      phoneNumbers: {
        primaryPhone: '(980) 480-8383',
        additionalPhones: ['(704) 555-0100'],
      },
    });
  });

  it('adds validateOnly only when asked', async () => {
    await pushTitleToGBP({ ...target, title: 'Badger Gutters' });
    expect(sentRequest().validateOnly).toBeNull();

    mocks.request.mockClear();
    await pushTitleToGBP({ ...target, title: 'Badger Gutters', validateOnly: true });
    expect(sentRequest().validateOnly).toBe('true');
  });

  it('never throws — a Google failure comes back as { success: false }', async () => {
    mocks.request.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            message: 'Request contains an invalid argument.',
            details: [
              {
                fieldViolations: [
                  { field: 'website_uri', description: 'Invalid URL' },
                ],
              },
            ],
          },
        },
      },
    });

    const result = await pushWebsiteToGBP({ ...target, websiteUri: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('website_uri: Invalid URL');
  });
});

describe('pushServiceAreaToGBP', () => {
  // The whole-object mask is rejected: sending `serviceArea` drags the
  // required businessType into the write, which Google reads as a business
  // type transition and answers 400 "Storefront_address must be explicitly
  // set to empty for pure service area business." Narrowing to
  // serviceArea.places validates clean and cannot touch the address.
  it('uses the serviceArea.places mask, never the whole serviceArea object', async () => {
    await pushServiceAreaToGBP({
      ...target,
      placeIds: ['ChIJvchYlskwVIgROi4KVlAWC44'],
    });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('serviceArea.places');
    expect(sent.updateMask).not.toBe('serviceArea');
  });

  it('sends placeId alone — placeName is not required on write', async () => {
    await pushServiceAreaToGBP({
      ...target,
      placeIds: ['ChIJvchYlskwVIgROi4KVlAWC44', 'ChIJBdYlOnaiVogR4c_krwxkfB0'],
    });

    expect(sentRequest().body).toEqual({
      serviceArea: {
        places: {
          placeInfos: [
            { placeId: 'ChIJvchYlskwVIgROi4KVlAWC44' },
            { placeId: 'ChIJBdYlOnaiVogR4c_krwxkfB0' },
          ],
        },
      },
    });
  });

  it('never sends businessType, which is what the whole-object mask got wrong', async () => {
    await pushServiceAreaToGBP({ ...target, placeIds: ['ChIJ1'] });

    const serviceArea = sentRequest().body.serviceArea as Record<string, unknown>;
    expect(serviceArea).not.toHaveProperty('businessType');
    expect(serviceArea).not.toHaveProperty('regionCode');
  });

  it('refuses more than 20 places before calling Google', async () => {
    const result = await pushServiceAreaToGBP({
      ...target,
      placeIds: Array.from({ length: 21 }, (_, i) => `ChIJ${i}`),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at most 20');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('accepts exactly 20 places', async () => {
    const result = await pushServiceAreaToGBP({
      ...target,
      placeIds: Array.from({ length: 20 }, (_, i) => `ChIJ${i}`),
    });

    expect(result).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty list rather than clearing the service area', async () => {
    const result = await pushServiceAreaToGBP({ ...target, placeIds: [] });

    expect(result.success).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

// scripts/gbp-validate-writes.ts rehearses every push against a live client
// profile. If validateOnly ever stops reaching these two — the only paths that
// also run unattended — that dry run silently becomes a real write.
describe('validateOnly reaches the two oldest push paths', () => {
  it('pushDescriptionToGBP honours validateOnly', async () => {
    await pushDescriptionToGBP({
      ...target,
      description: 'Badger Gutters serves the Charlotte metro.',
      validateOnly: true,
    });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('profile.description');
    expect(sent.validateOnly).toBe('true');
    expect(sent.body).toEqual({
      profile: { description: 'Badger Gutters serves the Charlotte metro.' },
    });
  });

  it('pushServicesToGBP honours validateOnly', async () => {
    const serviceItems = [{ freeFormServiceItem: { label: { displayName: 'Gutter cleaning' } } }];
    await pushServicesToGBP({ ...target, serviceItems, validateOnly: true });

    const sent = sentRequest();
    expect(sent.updateMask).toBe('serviceItems');
    expect(sent.validateOnly).toBe('true');
    expect(sent.body).toEqual({ serviceItems });
  });

  it('writes for real when validateOnly is not asked for', async () => {
    await pushDescriptionToGBP({ ...target, description: 'x' });
    expect(sentRequest().validateOnly).toBeNull();
  });
});
