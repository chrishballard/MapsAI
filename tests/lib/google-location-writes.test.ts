import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every Location field write goes out as PATCH {location}?updateMask=<field>.
// The masks and payload shapes here were validated against live profiles with
// validateOnly=true on 2026-09-14 and again on 2026-09-15 (the second run
// added the from-zero service-area path), so this file is what stops them
// drifting.

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
  storefrontRemovalRisk,
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

  // The Categories schema: "During updates, both fields must be set."
  // Omitting a field is not the same as sending it empty, and clearing the
  // additional categories has to actually clear them.
  it('sends an explicit empty additionalCategories rather than omitting it', async () => {
    await pushCategoriesToGBP({
      ...target,
      primaryCategoryId: 'categories/gcid:plumber',
    });

    expect(sentRequest().body.categories).toEqual({
      primaryCategory: { name: 'categories/gcid:plumber' },
      additionalCategories: [],
    });
  });

  // Same rule on PhoneNumbers: "During updates, both fields must be set."
  it('sends an explicit empty additionalPhones rather than omitting it', async () => {
    await pushPhoneNumbersToGBP({ ...target, primaryPhone: '(980) 480-8383' });

    expect(sentRequest().body.phoneNumbers).toEqual({
      primaryPhone: '(980) 480-8383',
      additionalPhones: [],
    });
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

  it('adds the validateOnly query param only when asked', async () => {
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
  // The push reads the current serviceArea AND storefrontAddress first, so
  // tests have to answer the GET as well as the PATCH.
  function withCurrent(serviceArea: unknown, storefrontAddress?: unknown) {
    mocks.request.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === 'GET') return { data: { serviceArea, storefrontAddress } };
      return { data: {} };
    });
  }

  /** The PATCH the push made, ignoring the GET that preceded it. */
  function sentPatch() {
    const patches = mocks.request.mock.calls
      .map((c) => c[0] as { url: string; method: string; data: Record<string, unknown> })
      .filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    const url = new URL(patches[0].url);
    return {
      updateMask: url.searchParams.get('updateMask'),
      body: patches[0].data,
    };
  }

  /** The readMask the push asked for before writing. */
  function sentReadMask() {
    const gets = mocks.request.mock.calls
      .map((c) => c[0] as { url: string; method: string })
      .filter((c) => c.method === 'GET');
    expect(gets).toHaveLength(1);
    return new URL(gets[0].url).searchParams.get('readMask');
  }

  const SAB = { businessType: 'CUSTOMER_AND_BUSINESS_LOCATION' };

  // Exactly the shape Google returned for Badger Gutters Park Rd, two address
  // lines and all, because the point of the from-zero path is that it goes
  // back unchanged.
  const ADDRESS = {
    regionCode: 'US',
    languageCode: 'en',
    postalCode: '28209-2259',
    administrativeArea: 'NC',
    locality: 'Charlotte',
    addressLines: ['4108 Park Rd', 'Suite 106'],
  };

  beforeEach(() => withCurrent(SAB));

  // On a profile that already has places the whole-object mask is rejected:
  // sending `serviceArea` drags the required businessType into the write,
  // which Google reads as a business type transition and answers 400
  // "Storefront_address must be explicitly set to empty for pure service area
  // business." Narrowing to serviceArea.places validates clean and cannot
  // touch the address. (From zero it is the other way round — see below.)
  it('uses the serviceArea.places mask, never the whole serviceArea object', async () => {
    await pushServiceAreaToGBP({
      ...target,
      places: [{ placeId: 'ChIJvchYlskwVIgROi4KVlAWC44' }],
    });

    expect(sentPatch().updateMask).toBe('serviceArea.places');
  });

  it('sends placeId alone when the caller has no place name', async () => {
    await pushServiceAreaToGBP({
      ...target,
      places: [
        { placeId: 'ChIJvchYlskwVIgROi4KVlAWC44' },
        { placeId: 'ChIJBdYlOnaiVogR4c_krwxkfB0' },
      ],
    });

    expect(sentPatch().body).toEqual({
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

  // PlaceInfo.placeName is marked Required in the schema. A placeId-only
  // payload validated clean, but the caller usually has the name (it comes
  // back from fetchCurrentServiceArea), and it must survive the round trip.
  it('passes placeName through when the caller has it', async () => {
    await pushServiceAreaToGBP({
      ...target,
      places: [
        { placeId: 'ChIJvchYlskwVIgROi4KVlAWC44', placeName: 'Monroe, NC, USA' },
        { placeId: 'ChIJBdYlOnaiVogR4c_krwxkfB0' },
      ],
    });

    expect(sentPatch().body).toEqual({
      serviceArea: {
        places: {
          placeInfos: [
            { placeId: 'ChIJvchYlskwVIgROi4KVlAWC44', placeName: 'Monroe, NC, USA' },
            { placeId: 'ChIJBdYlOnaiVogR4c_krwxkfB0' },
          ],
        },
      },
    });
  });

  it('never sends businessType once the profile already has a service area', async () => {
    await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

    const serviceArea = sentPatch().body.serviceArea as Record<string, unknown>;
    expect(serviceArea).not.toHaveProperty('businessType');
    expect(serviceArea).not.toHaveProperty('regionCode');
  });

  it('reads serviceArea and storefrontAddress in one GET', async () => {
    await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

    expect(sentReadMask()).toBe('serviceArea,storefrontAddress');
  });

  it('never names storefrontAddress when the profile already has places', async () => {
    withCurrent(SAB, ADDRESS);
    await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

    const sent = sentPatch();
    expect(sent.updateMask).toBe('serviceArea.places');
    expect(sent.body).not.toHaveProperty('storefrontAddress');
  });

  // A profile with no service area at all. `serviceArea.places` is rejected
  // there — "Can't add an incomplete service area. Specify the whole
  // service_area field in the request" — and the whole-object mask on its own
  // validates but comes back coerced to CUSTOMER_LOCATION_ONLY, which hides
  // the storefront. Naming storefrontAddress in the same mask is the one
  // shape that validated with the hybrid type intact (Park Rd, 2026-09-15).
  describe('when the profile has no service area yet', () => {
    beforeEach(() => withCurrent(undefined, ADDRESS));

    it('writes serviceArea and storefrontAddress together', async () => {
      const result = await pushServiceAreaToGBP({
        ...target,
        places: [{ placeId: 'ChIJvchYlskwVIgROi4KVlAWC44', placeName: 'Monroe, NC, USA' }],
      });

      expect(result).toEqual({ success: true });
      const sent = sentPatch();
      expect(sent.updateMask).toBe('serviceArea,storefrontAddress');
      expect(sent.body).toEqual({
        serviceArea: {
          businessType: 'CUSTOMER_AND_BUSINESS_LOCATION',
          places: {
            placeInfos: [
              { placeId: 'ChIJvchYlskwVIgROi4KVlAWC44', placeName: 'Monroe, NC, USA' },
            ],
          },
        },
        storefrontAddress: ADDRESS,
      });
    });

    // CUSTOMER_LOCATION_ONLY takes the address off the listing. Google
    // coerces to it when storefrontAddress is left out of the mask, so the
    // one thing this path must never do is send it.
    it('asks for the hybrid type, never CUSTOMER_LOCATION_ONLY', async () => {
      await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

      const serviceArea = sentPatch().body.serviceArea as Record<string, unknown>;
      expect(serviceArea.businessType).toBe('CUSTOMER_AND_BUSINESS_LOCATION');
    });

    // Reconstructing the address would drop whatever field Google sent that
    // this code does not know about, and quietly edit the client's address.
    it('echoes the address back untouched, unknown fields included', async () => {
      const odd = { ...ADDRESS, sortingCode: 'X1', revision: 7, sublocality: 'Dilworth' };
      withCurrent(undefined, odd);

      await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

      expect(sentPatch().body.storefrontAddress).toEqual(odd);
    });

    it('takes the same path for a BUSINESS_TYPE_UNSPECIFIED location', async () => {
      withCurrent({ businessType: 'BUSINESS_TYPE_UNSPECIFIED' }, ADDRESS);

      const result = await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

      expect(result).toEqual({ success: true });
      expect(sentPatch().updateMask).toBe('serviceArea,storefrontAddress');
    });
  });

  // No service area and no address: shape 3 has nothing to echo, and the only
  // mask left is the one that converts the profile to service-area-only.
  // Unprobed, so it stays refused rather than guessed at.
  it('refuses a location with neither a service area nor an address', async () => {
    withCurrent(undefined, undefined);

    const result = await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no address to send back');
    expect(
      mocks.request.mock.calls.filter((c) => (c[0] as { method: string }).method === 'PATCH')
    ).toHaveLength(0);
  });

  it('reports a failed read instead of throwing', async () => {
    mocks.request.mockRejectedValue(new Error('socket hang up'));

    const result = await pushServiceAreaToGBP({ ...target, places: [{ placeId: 'ChIJ1' }] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('socket hang up');
  });

  it('refuses more than 20 places before calling Google at all', async () => {
    const result = await pushServiceAreaToGBP({
      ...target,
      places: Array.from({ length: 21 }, (_, i) => ({ placeId: `ChIJ${i}` })),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at most 20');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('accepts exactly 20 places', async () => {
    const result = await pushServiceAreaToGBP({
      ...target,
      places: Array.from({ length: 20 }, (_, i) => ({ placeId: `ChIJ${i}` })),
    });

    expect(result).toEqual({ success: true });
  });

  it('refuses an empty list rather than clearing the service area', async () => {
    const result = await pushServiceAreaToGBP({ ...target, places: [] });

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

// Losing a storefront address is the one unrecoverable mistake in this file:
// the map pin stops showing a location and getting it back means
// re-verification by postcard. storefrontRemovalRisk runs on every Location
// write, so these are the tests that stand between a future push and a
// client's pin.
describe('the storefront address guard', () => {
  const ADDRESS = { regionCode: 'US', locality: 'Charlotte' };

  describe('refuses', () => {
    it('businessType CUSTOMER_LOCATION_ONLY, whatever the mask', () => {
      const risk = storefrontRemovalRisk('serviceArea,storefrontAddress', {
        serviceArea: { businessType: 'CUSTOMER_LOCATION_ONLY', places: {} },
        storefrontAddress: ADDRESS,
      });

      expect(risk).toContain('CUSTOMER_LOCATION_ONLY');
    });

    // The quiet one: Google answers 200 and silently coerces the type.
    it('the whole serviceArea mask when storefrontAddress is not alongside it', () => {
      const risk = storefrontRemovalRisk('serviceArea', {
        serviceArea: {
          businessType: 'CUSTOMER_AND_BUSINESS_LOCATION',
          places: { placeInfos: [{ placeId: 'ChIJ1' }] },
        },
      });

      expect(risk).toContain('without storefrontAddress');
    });

    it('storefrontAddress named in the mask but absent from the body', () => {
      expect(storefrontRemovalRisk('storefrontAddress', {})).toContain(
        'no address in the body'
      );
    });

    it('storefrontAddress named in the mask but null or empty', () => {
      expect(
        storefrontRemovalRisk('storefrontAddress', { storefrontAddress: null })
      ).toBeTruthy();
      expect(
        storefrontRemovalRisk('storefrontAddress', { storefrontAddress: {} })
      ).toBeTruthy();
    });

    it('an empty subfield edit of the address', () => {
      expect(storefrontRemovalRisk('storefrontAddress.addressLines', {})).toBeTruthy();
    });
  });

  describe('allows', () => {
    it('the shape pushServiceAreaToGBP uses from zero', () => {
      const risk = storefrontRemovalRisk('serviceArea,storefrontAddress', {
        serviceArea: {
          businessType: 'CUSTOMER_AND_BUSINESS_LOCATION',
          places: { placeInfos: [{ placeId: 'ChIJ1' }] },
        },
        storefrontAddress: ADDRESS,
      });

      expect(risk).toBeNull();
    });

    it('the narrow serviceArea.places mask', () => {
      const risk = storefrontRemovalRisk('serviceArea.places', {
        serviceArea: { places: { placeInfos: [{ placeId: 'ChIJ1' }] } },
      });

      expect(risk).toBeNull();
    });

    it('writes that have nothing to do with the address', () => {
      expect(
        storefrontRemovalRisk('profile.description', {
          profile: { description: 'hi' },
        })
      ).toBeNull();
      expect(storefrontRemovalRisk('regularHours', { regularHours: {} })).toBeNull();
    });
  });

  // Proves the guard is wired into patchLocation, not just exported and
  // forgotten. The vector is real: pushServiceAreaToGBP only checks that the
  // address it read is truthy, so a profile whose storefrontAddress comes
  // back as {} slips past its own check and is stopped here instead.
  it('stops the request before it reaches Google', async () => {
    mocks.request.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === 'GET') {
        return { data: { serviceArea: undefined, storefrontAddress: {} } };
      }
      return { data: {} };
    });

    const result = await pushServiceAreaToGBP({
      ...target,
      places: [{ placeId: 'ChIJ1' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Refused');
    expect(
      mocks.request.mock.calls.filter((c) => (c[0] as { method: string }).method === 'PATCH')
    ).toHaveLength(0);
  });
});
