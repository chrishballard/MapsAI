import { describe, it, expect, vi, beforeEach } from 'vitest';

// Attributes are not a Location field — ?readMask=attributes answers 400
// "Invalid field mask provided". They need two endpoints, and the write needs
// a required attributeMask, `name` keys, and no output-only valueType.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));

const { fetchAttributes, pushAttributesToGBP } = await import(
  '@/lib/google-business-info'
);

const target = { googleAccountId: 'ga1', locationName: 'locations/123' };

const SET_ATTRIBUTES = {
  name: 'locations/123/attributes',
  attributes: [
    { name: 'attributes/has_parking_lot_free', valueType: 'BOOL', values: [true] },
    {
      name: 'attributes/url_facebook',
      valueType: 'URL',
      uriValues: [{ uri: 'https://facebook.com/badger' }],
    },
  ],
};

const CATALOG = {
  attributeMetadata: [
    {
      parent: 'attributes/has_parking_lot_free',
      valueType: 'BOOL',
      displayName: 'Free parking lot',
      groupDisplayName: 'Parking',
      valueMetadata: [{ value: true, displayName: 'Free parking lot' }],
    },
    {
      parent: 'attributes/has_wheelchair_accessible_entrance',
      valueType: 'BOOL',
      displayName: 'Wheelchair accessible entrance',
      groupDisplayName: 'Accessibility',
    },
    {
      parent: 'attributes/pay_check',
      valueType: 'BOOL',
      displayName: 'Cheques',
      groupDisplayName: 'Payments',
      deprecated: true,
    },
  ],
};

/** Route a mocked request by URL so each test only states what it cares about. */
function routeRequests(
  overrides: { set?: unknown; catalogPages?: unknown[] } = {}
) {
  const pages = overrides.catalogPages ?? [CATALOG];
  let pageIndex = 0;
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (url.includes('/attributes?parent=') || url.includes('/v1/attributes?parent=')) {
      return { data: pages[pageIndex++] };
    }
    if (url.endsWith('/attributes')) {
      return { data: overrides.set ?? SET_ATTRIBUTES };
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

describe('fetchAttributes', () => {
  it('reads the two endpoints that work and never the readMask that 400s', async () => {
    routeRequests();
    await fetchAttributes(target);

    const urls = mocks.request.mock.calls.map((c) => (c[0] as { url: string }).url);
    expect(urls.some((u) => u.endsWith('/v1/locations/123/attributes'))).toBe(true);
    expect(urls.some((u) => u.includes('/v1/attributes?parent=locations%2F123'))).toBe(true);
    expect(urls.some((u) => u.includes('readMask=attributes'))).toBe(false);
  });

  // parent is mutually exclusive with languageCode/regionCode/categoryName:
  // sending languageCode alongside it fails with
  // `language_code: "Field must not be set when parent is set."`
  it('never sends languageCode on the catalog call', async () => {
    routeRequests();
    await fetchAttributes(target);

    const catalogUrl = mocks.request.mock.calls
      .map((c) => (c[0] as { url: string }).url)
      .find((u) => u.includes('parent='))!;
    expect(catalogUrl).not.toContain('languageCode');
    expect(catalogUrl).not.toContain('regionCode');
    expect(catalogUrl).not.toContain('categoryName');
  });

  it('keys attributes by the bare id taken from `name`, not a missing attributeId', async () => {
    routeRequests();
    const { attributes } = await fetchAttributes(target);

    const ids = attributes.map((a) => a.attributeId);
    expect(ids).toContain('has_parking_lot_free');
    expect(ids).toContain('url_facebook');
    expect(ids.some((id) => id === undefined || id.startsWith('attributes/'))).toBe(false);
  });

  it('offers catalog attributes that are not set, so "not set" can be recommended', async () => {
    routeRequests();
    const { attributes } = await fetchAttributes(target);

    const unset = attributes.find(
      (a) => a.attributeId === 'has_wheelchair_accessible_entrance'
    );
    expect(unset).toBeDefined();
    expect(unset!.currentValue).toBeNull();
    expect(unset!.groupDisplayName).toBe('Accessibility');
  });

  it('overlays the live value onto the catalog entry', async () => {
    routeRequests();
    const { attributes } = await fetchAttributes(target);

    const set = attributes.find((a) => a.attributeId === 'has_parking_lot_free')!;
    expect(set.currentValue).toBe(true);
    expect(set.displayName).toBe('Free parking lot');
  });

  it('drops deprecated attributes — Google accepts updates to them and saves nothing', async () => {
    routeRequests();
    const { attributes } = await fetchAttributes(target);

    expect(attributes.map((a) => a.attributeId)).not.toContain('pay_check');
  });

  it('still returns an attribute that is set but missing from the catalog', async () => {
    routeRequests();
    const { attributes } = await fetchAttributes(target);

    const facebook = attributes.find((a) => a.attributeId === 'url_facebook')!;
    expect(facebook.valueType).toBe('URL');
    expect(facebook.currentValue).toBe('https://facebook.com/badger');
  });

  it('pages the catalog to the end', async () => {
    routeRequests({
      catalogPages: [
        { ...CATALOG, nextPageToken: 'page2' },
        {
          attributeMetadata: [
            {
              parent: 'attributes/has_restroom',
              valueType: 'BOOL',
              displayName: 'Restroom',
              groupDisplayName: 'Amenities',
            },
          ],
        },
      ],
    });
    const { attributes } = await fetchAttributes(target);

    expect(attributes.map((a) => a.attributeId)).toContain('has_restroom');
  });

  it('degrades to the set attributes when the catalog call fails', async () => {
    mocks.request.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('parent=')) throw new Error('catalog down');
      return { data: SET_ATTRIBUTES };
    });

    const { attributes, error } = await fetchAttributes(target);
    expect(error).toBeUndefined();
    expect(attributes.map((a) => a.attributeId)).toEqual([
      'has_parking_lot_free',
      'url_facebook',
    ]);
  });
});

describe('pushAttributesToGBP', () => {
  function sent() {
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const call = mocks.request.mock.calls[0][0] as {
      url: string;
      method: string;
      data: { name: string; attributes: Array<Record<string, unknown>> };
    };
    const url = new URL(call.url);
    return {
      method: call.method,
      path: url.pathname,
      attributeMask: url.searchParams.get('attributeMask'),
      body: call.data,
    };
  }

  beforeEach(() => {
    mocks.request.mockResolvedValue({ data: {} });
  });

  // attributeMask is a REQUIRED query parameter. Absent, Google treats the
  // write as "all attributes", which deletes everything not in the payload.
  it('always sends attributeMask, derived from the attributes being written', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [
        { attributeId: 'has_parking_lot_free', valueType: 'BOOL', values: [true] },
        {
          attributeId: 'url_facebook',
          valueType: 'URL',
          uriValues: [{ uri: 'https://facebook.com/badger' }],
        },
      ],
    });

    expect(sent().attributeMask).toBe(
      'attributes/has_parking_lot_free,attributes/url_facebook'
    );
  });

  it('keys each attribute by `name`, never attributeId', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [{ attributeId: 'has_parking_lot_free', valueType: 'BOOL', values: [true] }],
    });

    const [attr] = sent().body.attributes;
    expect(attr.name).toBe('attributes/has_parking_lot_free');
    expect(attr).not.toHaveProperty('attributeId');
  });

  it('leaves out the output-only valueType', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [{ attributeId: 'has_parking_lot_free', valueType: 'BOOL', values: [true] }],
    });

    expect(sent().body.attributes[0]).not.toHaveProperty('valueType');
  });

  it('PATCHes the attributes sub-resource and names it in the body', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [{ attributeId: 'has_parking_lot_free', valueType: 'BOOL', values: [true] }],
    });

    const s = sent();
    expect(s.method).toBe('PATCH');
    expect(s.path).toBe('/v1/locations/123/attributes');
    expect(s.body.name).toBe('locations/123/attributes');
  });

  it('accepts an id that already carries the attributes/ prefix', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [
        { attributeId: 'attributes/has_parking_lot_free', valueType: 'BOOL', values: [true] },
      ],
    });

    expect(sent().attributeMask).toBe('attributes/has_parking_lot_free');
    expect(sent().body.attributes[0].name).toBe('attributes/has_parking_lot_free');
  });

  it('puts each value type in its own field', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [
        { attributeId: 'a_bool', valueType: 'BOOL', values: [true] },
        { attributeId: 'a_enum', valueType: 'ENUM', values: ['SOME_VALUE'] },
        {
          attributeId: 'a_repeated',
          valueType: 'REPEATED_ENUM',
          repeatedEnumValue: { setValues: ['X'], unsetValues: [] },
        },
        { attributeId: 'a_url', valueType: 'URL', uriValues: [{ uri: 'https://x.test' }] },
      ],
    });

    const [b, e, r, u] = sent().body.attributes;
    expect(b.values).toEqual([true]);
    expect(e.values).toEqual(['SOME_VALUE']);
    expect(r.repeatedEnumValue).toEqual({ setValues: ['X'], unsetValues: [] });
    expect(u.uriValues).toEqual([{ uri: 'https://x.test' }]);
  });

  // Google's documented delete: an id in the mask with no matching entry in
  // the attributes list is removed.
  it('adds removeAttributeIds to the mask without adding them to the body', async () => {
    await pushAttributesToGBP({
      ...target,
      attributes: [{ attributeId: 'has_parking_lot_free', valueType: 'BOOL', values: [true] }],
      removeAttributeIds: ['url_facebook'],
    });

    const s = sent();
    expect(s.attributeMask).toBe(
      'attributes/has_parking_lot_free,attributes/url_facebook'
    );
    expect(s.body.attributes).toHaveLength(1);
  });

  it('refuses an empty write rather than sending a mask that means "all"', async () => {
    const result = await pushAttributesToGBP({ ...target, attributes: [] });

    expect(result.success).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('never throws — it reports the field violation', async () => {
    mocks.request.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            details: [
              { fieldViolations: [{ field: 'attributes', description: 'Unknown attribute' }] },
            ],
          },
        },
      },
    });

    const result = await pushAttributesToGBP({
      ...target,
      attributes: [{ attributeId: 'nope', valueType: 'BOOL', values: [true] }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('attributes: Unknown attribute');
  });
});
