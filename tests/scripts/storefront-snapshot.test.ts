import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSnapshotIdentity,
  findSlugForProfileId,
  findSnapshotPath,
  loadSnapshotAddress,
  loadSnapshotJson,
  newestBeforeSnapshot,
  readSnapshotAddress,
  snapshotProfileId,
} from '../../scripts/storefront-snapshot';

// How scripts/restore-storefront-address.ts decides WHICH address it is about
// to push back onto a client's listing. Every refusal here is a case where
// guessing would write one client's address onto another client's profile, or
// send Google an address with no street in it.

// A registry in the shape sync-registry.py writes: a YAML list of entries,
// block-style lists, `[]` inline for an empty one.
const registry = `# Vineyard Growth canonical client registry.
#   rankmapsProfileIds      - list of Profile.id (cuid) from Rankmaps Postgres.
- slug: boulder-apps
  businessName: Boulder Apps
  website: null
  rankmapsProfileIds: []
  gbpStatus: none
- slug: badger-gutters
  businessName: Badger Gutters
  rankmapsProfileIds:
  - cmqtn283f00qe1gn29v4q0t1j
  - cmrmb5ugt008x1bnqoxkofr2h
  gbpPlaceIds:
  - ChIJAAAAAAAAAAARAAAAAAAAAAA
  - ChIJBBBBBBBBBBBRBBBBBBBBBBB
  askElephantQuery: null
- slug: wilson-dentistry
  businessName: Wilson Dentistry
  rankmapsProfileIds:
  - cmu3523uh00232cmvvennobfq
  audits: {}
`;

describe('findSlugForProfileId', () => {
  it('finds the slug that lists a profile id', () => {
    expect(findSlugForProfileId(registry, 'cmu3523uh00232cmvvennobfq')).toBe(
      'wilson-dentistry'
    );
  });

  it('finds a secondary profile of a multi-profile client', () => {
    expect(findSlugForProfileId(registry, 'cmrmb5ugt008x1bnqoxkofr2h')).toBe(
      'badger-gutters'
    );
  });

  it('returns null for an id the registry does not list', () => {
    expect(findSlugForProfileId(registry, 'cmnotarealprofileid00000')).toBeNull();
  });

  it('does not match a place id from the list that follows', () => {
    // gbpPlaceIds sits directly under rankmapsProfileIds and is indented the
    // same way. Matching into it would hand back a slug for something that is
    // not a profile id at all.
    expect(findSlugForProfileId(registry, 'ChIJAAAAAAAAAAARAAAAAAAAAAA')).toBeNull();
  });

  it('reads an empty inline list as listing nothing', () => {
    expect(findSlugForProfileId(registry, '[]')).toBeNull();
  });

  it('strips quotes around a slug', () => {
    const quoted = `- slug: 'rockeffeler'\n  rankmapsProfileIds:\n  - 'cmabc123'\n`;
    expect(findSlugForProfileId(quoted, 'cmabc123')).toBe('rockeffeler');
  });
});

describe('findSlugForProfileId: the slug belongs to its own entry', () => {
  // Every entry in the live registry opens with `- slug:` today, so none of
  // this has gone wrong in production yet. It is one dropped sort_keys=False,
  // or one hand edit of a file whose own header invites hand edits, away from
  // going wrong, and the failure mode is silent: a real slug for the wrong
  // client, which the caller then opens and reads an address out of.

  const slugNotFirst = `- slug: alpha
  businessName: Alpha Co
  rankmapsProfileIds:
  - id-alpha
- businessName: Beta Co
  slug: beta
  rankmapsProfileIds:
  - id-beta
`;

  it('reads a slug that is not the first key of its entry', () => {
    expect(findSlugForProfileId(slugNotFirst, 'id-beta')).toBe('beta');
  });

  it('still reads the entry that does open with its slug', () => {
    expect(findSlugForProfileId(slugNotFirst, 'id-alpha')).toBe('alpha');
  });

  it('resolves an id seen before its own entry names a slug', () => {
    // safe_dump with sort_keys sorts `slug` after `rankmapsProfileIds`, so the
    // ids arrive first and the slug turns up at the bottom of the entry.
    const slugLast = `- slug: alpha
  rankmapsProfileIds:
  - id-alpha
- businessName: Gamma Co
  rankmapsProfileIds:
  - id-gamma
  website: gamma.example
  slug: gamma
`;
    expect(findSlugForProfileId(slugLast, 'id-gamma')).toBe('gamma');
  });

  it('returns null, not the previous slug, for an entry that names none', () => {
    // The regression this was rewritten for. Reading it as 'alpha' sends the
    // caller into alpha's vault folder for delta's profile.
    const noSlug = `- slug: alpha
  rankmapsProfileIds:
  - id-alpha
- businessName: Delta Co
  rankmapsProfileIds:
  - id-delta
`;
    expect(findSlugForProfileId(noSlug, 'id-delta')).toBeNull();
    expect(findSlugForProfileId(noSlug, 'id-alpha')).toBe('alpha');
  });

  it('returns null for an id listed under a key that is not rankmapsProfileIds', () => {
    const elsewhere = `- slug: alpha
  rankmapsProfileIds:
  - id-alpha
- businessName: Epsilon Co
  gbpPlaceIds:
  - id-epsilon
  contacts:
  - id-contact
  slug: epsilon
`;
    expect(findSlugForProfileId(elsewhere, 'id-epsilon')).toBeNull();
    expect(findSlugForProfileId(elsewhere, 'id-contact')).toBeNull();
  });

  it('does not carry a slug past the entry that declared it', () => {
    // Two entries, only the first with a slug, and an id in neither: the
    // answer is null and not the one slug that happens to be in scope.
    const two = `- slug: alpha
  rankmapsProfileIds:
  - id-alpha
- businessName: Beta Co
  rankmapsProfileIds:
  - id-beta
  slug: beta
`;
    expect(findSlugForProfileId(two, 'id-nobody')).toBeNull();
    expect(findSlugForProfileId(two, 'id-beta')).toBe('beta');
  });
});

describe('newestBeforeSnapshot', () => {
  it('picks the latest date in the filename', () => {
    expect(
      newestBeforeSnapshot([
        'before-2026-09-14.json',
        'before-2026-08-02.json',
        'before-2026-09-02.json',
      ])
    ).toBe('before-2026-09-14.json');
  });

  it('ignores anything that is not a dated snapshot', () => {
    expect(
      newestBeforeSnapshot(['snapshot.md', 'reviews.md', 'before-2026-09-14.json'])
    ).toBe('before-2026-09-14.json');
  });

  it('returns null when there are none', () => {
    expect(newestBeforeSnapshot(['snapshot.md', 'rankings.md'])).toBeNull();
  });
});

describe('findSnapshotPath', () => {
  let vaultRoot: string;
  const slug = 'badger-gutters';
  const profileId = 'cmrmb5ugt008x1bnqoxkofr2h';
  const other = 'cmqtn283f00qe1gn29v4q0t1j';

  const gbpDir = () => join(vaultRoot, 'clients', slug, 'gbp');

  beforeAll(() => {
    vaultRoot = mkdtempSync(join(tmpdir(), 'storefront-snapshot-'));
    mkdirSync(join(gbpDir(), profileId), { recursive: true });
    mkdirSync(join(gbpDir(), other), { recursive: true });
  });

  afterAll(() => {
    rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('prefers the profile-specific directory', () => {
    writeFileSync(join(gbpDir(), 'before-2026-09-20.json'), '{}');
    writeFileSync(join(gbpDir(), profileId, 'before-2026-09-14.json'), '{}');

    const found = findSnapshotPath({ vaultRoot, slug, profileId });
    expect(found).toEqual({
      ok: true,
      value: join(gbpDir(), profileId, 'before-2026-09-14.json'),
    });
  });

  it('never reaches into another profile directory', () => {
    // The newest snapshot for this client sits under the OTHER location.
    writeFileSync(join(gbpDir(), other, 'before-2026-09-30.json'), '{}');

    const found = findSnapshotPath({ vaultRoot, slug, profileId });
    expect(found).toEqual({
      ok: true,
      value: join(gbpDir(), profileId, 'before-2026-09-14.json'),
    });
  });

  it('refuses an empty profile directory rather than reading the client folder', () => {
    // Badger Gutters has two locations. This profile has a directory of its
    // own, so the client-level before-2026-09-20.json is some other
    // location's frozen address, and falling through to it is how the wrong
    // street ends up on this listing.
    const empty = 'cmemptydir00000000000000';
    mkdirSync(join(gbpDir(), empty), { recursive: true });

    const found = findSnapshotPath({ vaultRoot, slug, profileId: empty });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error).toContain(join(gbpDir(), empty));
    expect(found.error).toContain(gbpDir());
    expect(found.error).toContain('--snapshot');
  });

  it('reads the client folder only when the profile has no directory at all', () => {
    // Where a single-location client's audit writes. checkSnapshotIdentity
    // has the last word on whether that file is really this profile's.
    const found = findSnapshotPath({ vaultRoot, slug, profileId: other + 'x' });
    expect(found).toEqual({
      ok: true,
      value: join(gbpDir(), 'before-2026-09-20.json'),
    });
  });

  it('refuses, naming both directories, when there is no snapshot anywhere', () => {
    const found = findSnapshotPath({ vaultRoot, slug: 'no-such-client', profileId });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error).toContain(profileId);
    expect(found.error).toContain(join(vaultRoot, 'clients', 'no-such-client', 'gbp'));
    expect(found.error).toContain('--snapshot');
  });
});

describe('snapshotProfileId', () => {
  it('reads the top-level profile_id gbp-audit writes', () => {
    expect(snapshotProfileId({ profile_id: 'cmrmb5ugt008x1bnqoxkofr2h' })).toBe(
      'cmrmb5ugt008x1bnqoxkofr2h'
    );
  });

  it('answers null for anything that is not a non-empty string', () => {
    expect(snapshotProfileId({})).toBeNull();
    expect(snapshotProfileId({ profile_id: '' })).toBeNull();
    expect(snapshotProfileId({ profile_id: '   ' })).toBeNull();
    expect(snapshotProfileId({ profile_id: 42 })).toBeNull();
    expect(snapshotProfileId({ profile_id: null })).toBeNull();
    expect(snapshotProfileId(null)).toBeNull();
    expect(snapshotProfileId('cmabc')).toBeNull();
    expect(snapshotProfileId([{ profile_id: 'cmabc' }])).toBeNull();
  });
});

describe('checkSnapshotIdentity', () => {
  const profileId = 'cmrmb5ugt008x1bnqoxkofr2h';
  const other = 'cmqtn283f00qe1gn29v4q0t1j';

  it('passes a snapshot that names this profile, in both modes', () => {
    for (const mode of ['rehearse', 'write'] as const) {
      expect(
        checkSnapshotIdentity({ snapshot: { profile_id: profileId }, profileId, mode })
      ).toEqual({ verdict: 'match' });
    }
  });

  it('refuses a snapshot frozen for another profile, in both modes', () => {
    // The Badger Gutters case: two locations, two frozen addresses, and a
    // --snapshot path or a client-level fallback that reaches the wrong one.
    // A rehearsal is refused too: validating the wrong client's address
    // proves nothing, and a rehearsal that passes is what talks somebody into
    // re-running it with --write --yes.
    for (const mode of ['rehearse', 'write'] as const) {
      const verdict = checkSnapshotIdentity({
        snapshot: { profile_id: other, fields: {} },
        profileId,
        mode,
      });
      expect(verdict.verdict).toBe('refuse');
      if (verdict.verdict === 'match') return;
      expect(verdict.message).toContain(other);
      expect(verdict.message).toContain(profileId);
    }
  });

  it('refuses a snapshot with no profile_id before a write', () => {
    const verdict = checkSnapshotIdentity({
      snapshot: { fields: { address: { value: {} } } },
      profileId,
      mode: 'write',
    });
    expect(verdict.verdict).toBe('refuse');
    if (verdict.verdict === 'match') return;
    expect(verdict.message).toContain('profile_id');
    expect(verdict.message).toContain(profileId);
  });

  it('warns instead of refusing when the same snapshot is only rehearsed', () => {
    // Reading an unattributed file is how the operator finds out what is in
    // it. Writing one is a guess.
    const verdict = checkSnapshotIdentity({
      snapshot: { fields: { address: { value: {} } } },
      profileId,
      mode: 'rehearse',
    });
    expect(verdict.verdict).toBe('warn');
    if (verdict.verdict === 'match') return;
    expect(verdict.message).toContain('WARNING');
    expect(verdict.message).toContain('profile_id');
  });

  it('treats a blank or non-string profile_id as no profile_id', () => {
    expect(
      checkSnapshotIdentity({ snapshot: { profile_id: '  ' }, profileId, mode: 'write' })
        .verdict
    ).toBe('refuse');
    expect(
      checkSnapshotIdentity({ snapshot: { profile_id: 7 }, profileId, mode: 'rehearse' })
        .verdict
    ).toBe('warn');
  });
});

describe('readSnapshotAddress', () => {
  // Badger Gutters Park Rd, as gbp-audit froze it on 2026-09-14.
  const parkRd = {
    regionCode: 'US',
    languageCode: 'en',
    postalCode: '28209-2259',
    administrativeArea: 'NC',
    locality: 'Charlotte',
    addressLines: ['4108 Park Rd', 'Suite 106'],
  };

  it('returns the frozen address object untouched', () => {
    const result = readSnapshotAddress({
      profile_id: 'cmrmb5ugt008x1bnqoxkofr2h',
      fields: { address: { value: parkRd, observed: true } },
    });

    expect(result).toEqual({ ok: true, value: parkRd });
    // Same object, same key order: this is what goes back to Google, and a
    // rebuilt one would be an edit to the client's address.
    if (result.ok) expect(Object.keys(result.value)).toEqual(Object.keys(parkRd));
  });

  it('refuses a snapshot that is not an object', () => {
    expect(readSnapshotAddress('nope')).toMatchObject({ ok: false });
    expect(readSnapshotAddress(null)).toMatchObject({ ok: false });
    expect(readSnapshotAddress([parkRd])).toMatchObject({ ok: false });
  });

  it('refuses a snapshot with no fields block', () => {
    const result = readSnapshotAddress({ profile_id: 'x' });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('`fields`');
  });

  it('refuses a snapshot with no address field', () => {
    const result = readSnapshotAddress({ fields: { phone: { value: '704' } } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('`fields.address`');
  });

  it('refuses an address field that was frozen with no value', () => {
    const result = readSnapshotAddress({
      fields: { address: { value: null, observed: false } },
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('address object');
  });

  it('refuses an address with no addressLines', () => {
    const { addressLines, ...withoutLines } = parkRd;
    expect(addressLines).toBeDefined();

    const result = readSnapshotAddress({ fields: { address: { value: withoutLines } } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('addressLines');
  });

  it('refuses an empty addressLines list', () => {
    const result = readSnapshotAddress({
      fields: { address: { value: { ...parkRd, addressLines: [] } } },
    });
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses addressLines that hold only blank strings', () => {
    const result = readSnapshotAddress({
      fields: { address: { value: { ...parkRd, addressLines: ['', '  '] } } },
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe('loadSnapshotJson and loadSnapshotAddress', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'storefront-load-'));
    writeFileSync(
      join(dir, 'before-2026-09-14.json'),
      JSON.stringify({
        profile_id: 'cmu3523uh00232cmvvennobfq',
        fields: { address: { value: { locality: 'Charlotte', addressLines: ['4108 Park Rd'] } } },
      })
    );
    writeFileSync(join(dir, 'broken.json'), '{ not json');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses the whole snapshot, so identity and address read the same parse', () => {
    const parsed = loadSnapshotJson(join(dir, 'before-2026-09-14.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(snapshotProfileId(parsed.value)).toBe('cmu3523uh00232cmvvennobfq');
    expect(readSnapshotAddress(parsed.value)).toMatchObject({ ok: true });
  });

  it('reads the address out of a snapshot file', () => {
    expect(loadSnapshotAddress(join(dir, 'before-2026-09-14.json'))).toEqual({
      ok: true,
      value: { locality: 'Charlotte', addressLines: ['4108 Park Rd'] },
    });
  });

  it('refuses a file that is not there', () => {
    const result = loadSnapshotAddress(join(dir, 'before-1999-01-01.json'));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('Could not read snapshot');
    expect(loadSnapshotJson(join(dir, 'before-1999-01-01.json'))).toMatchObject({
      ok: false,
    });
  });

  it('refuses a file that is not valid JSON', () => {
    const result = loadSnapshotAddress(join(dir, 'broken.json'));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('names the file in a refusal, so the operator knows which one was wrong', () => {
    const result = loadSnapshotAddress(join(dir, 'broken.json'));
    if (!result.ok) expect(result.error).toContain('broken.json');
  });
});
