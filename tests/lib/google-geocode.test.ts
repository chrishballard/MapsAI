import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAreaPlaceId } from '@/lib/google-geocode';

// Geocoding is how a city name becomes the place id a GBP service area
// needs. The rule these tests exist for: it must never hand back the place
// id of a street address or a business, because a service area built from
// one covers a single building instead of a town and nothing on the listing
// makes that obvious.

const KEY = { apiKey: 'test-key' };

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }))
  );
}

/** The URL the one fetch call was made against. */
function requestedUrl() {
  const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  expect(fetchMock.mock.calls).toHaveLength(1);
  return String(fetchMock.mock.calls[0][0]);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('resolveAreaPlaceId', () => {
  it('returns the place id and Google’s own formatted name for a city', async () => {
    respondWith({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJ2-65Sl2BTYcRAAAAAAAAAAA',
          formatted_address: 'American Fork, UT, USA',
          types: ['locality', 'political'],
        },
      ],
    });

    const result = await resolveAreaPlaceId('American Fork, UT', KEY);

    expect(result).toEqual({
      ok: true,
      place: {
        placeId: 'ChIJ2-65Sl2BTYcRAAAAAAAAAAA',
        placeName: 'American Fork, UT, USA',
        types: ['locality', 'political'],
      },
    });
  });

  it('sends the query and key url-encoded', async () => {
    respondWith({
      status: 'OK',
      results: [{ place_id: 'ChIJ1', formatted_address: 'Lehi, UT, USA', types: ['locality'] }],
    });

    await resolveAreaPlaceId('Lehi, UT', KEY);

    const url = requestedUrl();
    expect(url).toContain('address=Lehi%2C%20UT');
    expect(url).toContain('key=test-key');
  });

  // The important one. A valid place id for the wrong KIND of place is the
  // failure that would silently produce a one-building service area.
  it('refuses a street address even though Google returned a valid id', async () => {
    respondWith({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJstreet',
          formatted_address: '114 W Sicula Rd, Vineyard, UT 84058, USA',
          types: ['street_address'],
        },
      ],
    });

    const result = await resolveAreaPlaceId('114 W Sicula Rd, Vineyard UT', KEY);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('not a city or region');
    expect(result.ok === false && result.error).toContain('street_address');
  });

  it('refuses a business result', async () => {
    respondWith({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJbiz',
          formatted_address: 'Utah Valley Pediatrics, American Fork, UT, USA',
          types: ['establishment', 'point_of_interest'],
        },
      ],
    });

    const result = await resolveAreaPlaceId('Utah Valley Pediatrics', KEY);
    expect(result.ok).toBe(false);
  });

  it('accepts a county or state, which a service area may legitimately name', async () => {
    respondWith({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJcounty',
          formatted_address: 'Utah County, UT, USA',
          types: ['administrative_area_level_2', 'political'],
        },
      ],
    });

    const result = await resolveAreaPlaceId('Utah County', KEY);
    expect(result.ok).toBe(true);
  });

  // Geocoding reports its own failures inside a 200 body, so a caller that
  // only checks the HTTP status sees success on a dead key.
  it('reports a REQUEST_DENIED body as a failure, not a success', async () => {
    respondWith({
      status: 'REQUEST_DENIED',
      error_message: 'This API project is not authorized to use this API.',
    });

    const result = await resolveAreaPlaceId('Lehi, UT', KEY);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('REQUEST_DENIED');
    expect(result.ok === false && result.error).toContain('not authorized');
  });

  it('reports ZERO_RESULTS', async () => {
    respondWith({ status: 'ZERO_RESULTS', results: [] });

    const result = await resolveAreaPlaceId('asdfghjkl', KEY);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('ZERO_RESULTS');
  });

  it('never throws when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      })
    );

    const result = await resolveAreaPlaceId('Lehi, UT', KEY);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('ENOTFOUND');
  });

  it('says so plainly when no key is configured', async () => {
    respondWith({ status: 'OK', results: [] });
    const previous = process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;

    const result = await resolveAreaPlaceId('Lehi, UT');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('GOOGLE_GEOCODING_API_KEY');
    expect(globalThis.fetch).not.toHaveBeenCalled();

    if (previous !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = previous;
  });
});
