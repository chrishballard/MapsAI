import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service type catalog is what the services pages offer as Google's
// types and what the push matches saved titles against. It is read from the
// location's primary category, with two fallbacks that were both broken:
// categories:batchGet without view=FULL answers with no service types at all,
// and the last fallback invented display names from the type ids
// ("job_type_id:mattress_cleaning" became "job type id:mattress cleaning"),
// which the wizard then offered as a service to pick. A type Google gives no
// name for must be reported as unresolved, and any fallback marks the read
// degraded so a replace-mode push knows not to trust it.

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createGoogleClient: vi.fn(),
}));

vi.mock('@/lib/google', () => ({ createGoogleClient: mocks.createGoogleClient }));

const { fetchStructuredServices, fetchServiceTypeCatalog } = await import(
  '@/lib/google-business-info'
);

const target = { googleAccountId: 'ga1', locationName: 'locations/123' };

const CATEGORY = 'categories/gcid:house_cleaning_service';
const MATTRESS = 'job_type_id:mattress_cleaning';
const CARPET = 'job_type_id:carpet_cleaning';

const NAMED_TYPES = [
  { serviceTypeId: MATTRESS, displayName: 'Mattress cleaning' },
  { serviceTypeId: CARPET, displayName: 'Carpet cleaning' },
];

/**
 * Route a mocked request by URL. `batchGet` answers the BASIC view (no
 * service types) unless the request asks for FULL, as Google does.
 */
function routeRequests(answers: {
  primaryCategory?: Record<string, unknown>;
  batchGetFull?: Record<string, unknown> | Error;
  serviceItems?: unknown[];
  languageCode?: string;
}) {
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/categories:batchGet')) {
      if (parsed.searchParams.get('view') !== 'FULL') {
        return { data: { categories: [{ name: CATEGORY, displayName: 'House cleaning service' }] } };
      }
      if (answers.batchGetFull instanceof Error) throw answers.batchGetFull;
      return { data: { categories: [answers.batchGetFull ?? { name: CATEGORY }] } };
    }
    const readMask = parsed.searchParams.get('readMask');
    if (readMask === 'categories,languageCode') {
      return {
        data: {
          categories: { primaryCategory: answers.primaryCategory },
          ...(answers.languageCode ? { languageCode: answers.languageCode } : {}),
        },
      };
    }
    if (readMask === 'serviceItems') {
      return { data: { serviceItems: answers.serviceItems ?? [] } };
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createGoogleClient.mockResolvedValue({ request: mocks.request });
});

describe('fetchStructuredServices fallbacks', () => {
  it('asks categories:batchGet for the FULL view, the only one that carries service types', async () => {
    routeRequests({
      primaryCategory: { name: CATEGORY },
      batchGetFull: { name: CATEGORY, serviceTypes: NAMED_TYPES },
    });

    expect(await fetchStructuredServices(target)).toEqual(NAMED_TYPES);

    const batchGet = mocks.request.mock.calls
      .map(([args]) => new URL(args.url))
      .find((u) => u.pathname.endsWith('/categories:batchGet'));
    expect(batchGet?.searchParams.get('view')).toBe('FULL');
  });

  it('never turns a type id into a display name', async () => {
    routeRequests({
      primaryCategory: { name: CATEGORY },
      serviceItems: [
        { structuredServiceItem: { serviceTypeId: MATTRESS } },
        { freeFormServiceItem: { label: { displayName: 'Window washing' } } },
      ],
    });

    expect(await fetchStructuredServices(target)).toEqual([]);
  });
});

describe('fetchServiceTypeCatalog', () => {
  it('trusts the location category catalog when every type has a name', async () => {
    routeRequests({ primaryCategory: { name: CATEGORY, serviceTypes: NAMED_TYPES } });

    expect(await fetchServiceTypeCatalog(target)).toEqual({
      serviceTypes: NAMED_TYPES,
      unresolvedTypeIds: [],
      degraded: false,
      source: 'location',
    });
    // No fallback traffic on the healthy path
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('reports a catalog type with no display name as unresolved', async () => {
    routeRequests({
      primaryCategory: {
        name: CATEGORY,
        serviceTypes: [NAMED_TYPES[0], { serviceTypeId: CARPET }, { serviceTypeId: CARPET, displayName: '' }],
      },
    });

    expect(await fetchServiceTypeCatalog(target)).toEqual({
      serviceTypes: [NAMED_TYPES[0]],
      unresolvedTypeIds: [CARPET],
      degraded: true,
      source: 'location',
    });
  });

  it.each([['es-419'], [undefined]])(
    'marks a categories:batchGet catalog degraded on a profile not known to be English (%s)',
    async (languageCode) => {
      // batchGet names the types in English, which on a non-English profile
      // are not the titles the saved rows were picked from.
      routeRequests({
        primaryCategory: { name: CATEGORY },
        batchGetFull: { name: CATEGORY, serviceTypes: NAMED_TYPES },
        languageCode,
      });

      expect(await fetchServiceTypeCatalog(target)).toEqual({
        serviceTypes: NAMED_TYPES,
        unresolvedTypeIds: [],
        degraded: true,
        source: 'batchGet',
      });
    }
  );

  it('trusts a categories:batchGet catalog on an English profile', async () => {
    // Its English names are the profile's own, so it is as good as the
    // location's read and must not block a replace push.
    routeRequests({
      primaryCategory: { name: CATEGORY },
      batchGetFull: { name: CATEGORY, serviceTypes: NAMED_TYPES },
      languageCode: 'en',
    });

    expect(await fetchServiceTypeCatalog(target)).toEqual({
      serviceTypes: NAMED_TYPES,
      unresolvedTypeIds: [],
      degraded: false,
      source: 'batchGet',
    });
  });

  it('falls back to the live structured ids, unnamed, when neither catalog read has types', async () => {
    routeRequests({
      primaryCategory: { name: CATEGORY },
      batchGetFull: new Error('batchGet 500'),
      serviceItems: [
        { structuredServiceItem: { serviceTypeId: MATTRESS, description: 'Old.' } },
        { structuredServiceItem: { serviceTypeId: MATTRESS } },
        { freeFormServiceItem: { label: { displayName: 'Window washing' } } },
      ],
    });

    expect(await fetchServiceTypeCatalog(target)).toEqual({
      serviceTypes: [],
      unresolvedTypeIds: [MATTRESS],
      degraded: true,
      source: 'live',
    });
  });

  it('still lets a failed location read throw, so the push aborts', async () => {
    mocks.request.mockRejectedValue(new Error('GBP 503'));

    await expect(fetchServiceTypeCatalog(target)).rejects.toThrow('GBP 503');
  });
});
