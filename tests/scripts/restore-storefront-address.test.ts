import { describe, it, expect } from 'vitest';
import {
  carriesStorefrontAddress,
  decideOverwrite,
  parseArgs,
  patchUrl,
  USAGE,
} from '../../scripts/restore-storefront-address';

// The flag rules, the overwrite decision and the request URL of the one script
// in here that can put a storefront address back on a live Google listing.
// Rehearsal is the default; a real write takes both --write and --yes; a
// half-typed or half-edited command writes nothing.
//
// These are all pure, and importing them starts nothing: the script only calls
// main() when process.env.VITEST is unset.

const ID = 'cmqtn283f00qe1gn29v4q0t1j';
const OTHER = 'cmrmb5ugt008x1bnqoxkofr2h';

describe('parseArgs: what runs with no flags', () => {
  it('rehearses when only a profile id is given', () => {
    expect(parseArgs([ID])).toEqual({
      ok: true,
      profileId: ID,
      snapshot: undefined,
      mode: 'rehearse',
      overwriteExisting: false,
    });
  });

  it('treats --validate-only as the explicit spelling of the default', () => {
    expect(parseArgs([ID, '--validate-only'])).toMatchObject({
      ok: true,
      profileId: ID,
      mode: 'rehearse',
    });
  });
});

describe('parseArgs: what it takes to write', () => {
  it('writes only when both --write and --yes are given', () => {
    expect(parseArgs([ID, '--write', '--yes'])).toMatchObject({
      ok: true,
      mode: 'write',
      overwriteExisting: false,
    });
  });

  it('does not care which order the two flags come in', () => {
    expect(parseArgs([ID, '--yes', '--write'])).toMatchObject({ ok: true, mode: 'write' });
  });

  it('accepts them around a --snapshot', () => {
    expect(
      parseArgs([ID, '--write', '--snapshot', '/tmp/before-2026-09-01.json', '--yes'])
    ).toEqual({
      ok: true,
      profileId: ID,
      snapshot: '/tmp/before-2026-09-01.json',
      mode: 'write',
      overwriteExisting: false,
    });
  });

  it('rehearses when --validate-only is passed alongside --write --yes', () => {
    // A contradictory command line is read the safe way round.
    expect(parseArgs([ID, '--write', '--yes', '--validate-only'])).toMatchObject({
      ok: true,
      mode: 'rehearse',
    });
  });
});

describe('parseArgs: the half-flag refusal', () => {
  it('refuses --write on its own', () => {
    const parsed = parseArgs([ID, '--write']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (!parsed.ok) {
      expect(parsed.message).toContain('REFUSED');
      expect(parsed.message).toContain('--yes');
    }
  });

  it('refuses --yes on its own', () => {
    const parsed = parseArgs([ID, '--yes']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (!parsed.ok) {
      expect(parsed.message).toContain('REFUSED');
      expect(parsed.message).toContain('--write');
    }
  });

  it('refuses a half flag even with a snapshot and a validate-only in the line', () => {
    expect(
      parseArgs([ID, '--snapshot', '/tmp/s.json', '--yes', '--validate-only'])
    ).toMatchObject({ ok: false, exitCode: 2 });
  });

  it('never returns a mode on a refusal, so no caller can fall through to a write', () => {
    expect('mode' in parseArgs([ID, '--write'])).toBe(false);
  });
});

describe('parseArgs: the positional profile id', () => {
  it('asks for usage when there is no profile id at all', () => {
    expect(parseArgs([])).toEqual({ ok: false, exitCode: 1, message: USAGE });
  });

  it('asks for usage when there are only flags', () => {
    expect(parseArgs(['--write', '--yes'])).toMatchObject({ ok: false, exitCode: 1 });
  });

  it('does not mistake the value of --snapshot for the profile id', () => {
    expect(parseArgs(['--snapshot', '/tmp/before-2026-09-01.json', ID])).toEqual({
      ok: true,
      profileId: ID,
      snapshot: '/tmp/before-2026-09-01.json',
      mode: 'rehearse',
      overwriteExisting: false,
    });
  });

  it('asks for usage when --snapshot swallows the only positional token', () => {
    expect(parseArgs(['--snapshot', ID])).toMatchObject({ ok: false, exitCode: 1 });
  });

  it('usage names the flags a real write needs', () => {
    expect(USAGE).toContain('--write --yes');
  });
});

describe('parseArgs: a second profile id is refused, not dropped', () => {
  // Taking the first of two and running is the usual convention, and it is the
  // wrong one here: the two ids are two clients, the run edits one live
  // listing, and nothing on screen would say which. Google renormalizes an
  // address on write, so a restore is watched one profile at a time anyway.

  it('refuses two profile ids', () => {
    const parsed = parseArgs([ID, OTHER]);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (parsed.ok) return;
    expect(parsed.message).toContain('REFUSED');
    expect(parsed.message).toContain(ID);
    expect(parsed.message).toContain(OTHER);
  });

  it('refuses two profile ids even with --write --yes', () => {
    const parsed = parseArgs([ID, OTHER, '--write', '--yes']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    expect('mode' in parsed).toBe(false);
  });

  it('refuses a stray token that is not a flag and not a path', () => {
    // A pasted word, a shell glob that expanded, a half-deleted argument.
    expect(parseArgs([ID, 'gutters'])).toMatchObject({ ok: false, exitCode: 2 });
  });
});

describe('parseArgs: --snapshot has to carry a path', () => {
  it('refuses a --snapshot with nothing after it', () => {
    const parsed = parseArgs([ID, '--snapshot']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (parsed.ok) return;
    expect(parsed.message).toContain('REFUSED');
    expect(parsed.message).toContain('--snapshot');
  });

  it('refuses a dangling --snapshot as the whole command line', () => {
    expect(parseArgs(['--snapshot'])).toMatchObject({ ok: false, exitCode: 2 });
  });

  it('does not read the next flag as the path', () => {
    // The shape that mattered: `--snapshot --write --yes` used to set the
    // snapshot to "--write" and go on to parse a valid write, so the run
    // reached Google before failing on a file that was never a file.
    const parsed = parseArgs([ID, '--snapshot', '--write', '--yes']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    expect('mode' in parsed).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('--snapshot');
  });

  it('refuses two --snapshot paths rather than taking the first', () => {
    const parsed = parseArgs([ID, '--snapshot', '/a.json', '--snapshot', '/b.json']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (parsed.ok) return;
    expect(parsed.message).toContain('/a.json');
    expect(parsed.message).toContain('/b.json');
  });
});

describe('parseArgs: --overwrite-existing', () => {
  it('is off unless it is asked for', () => {
    expect(parseArgs([ID])).toMatchObject({ overwriteExisting: false });
    expect(parseArgs([ID, '--write', '--yes'])).toMatchObject({ overwriteExisting: false });
  });

  it('is accepted alongside --write --yes', () => {
    expect(parseArgs([ID, '--write', '--yes', '--overwrite-existing'])).toEqual({
      ok: true,
      profileId: ID,
      snapshot: undefined,
      mode: 'write',
      overwriteExisting: true,
    });
  });

  it('is refused on its own', () => {
    const parsed = parseArgs([ID, '--overwrite-existing']);
    expect(parsed).toMatchObject({ ok: false, exitCode: 2 });
    if (parsed.ok) return;
    expect(parsed.message).toContain('--overwrite-existing');
    expect(parsed.message).toContain('--write --yes');
  });

  it('is refused behind a half flag', () => {
    expect(parseArgs([ID, '--write', '--overwrite-existing'])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
    expect(parseArgs([ID, '--yes', '--overwrite-existing'])).toMatchObject({
      ok: false,
      exitCode: 2,
    });
  });

  it('is carried, and inert, when --validate-only turns the run back into a rehearsal', () => {
    // It was given alongside a real --write --yes, so it parses. decideOverwrite
    // then ignores it, because a rehearsal was never going to change anything.
    expect(
      parseArgs([ID, '--write', '--yes', '--overwrite-existing', '--validate-only'])
    ).toMatchObject({ ok: true, mode: 'rehearse', overwriteExisting: true });
  });
});

describe('carriesStorefrontAddress', () => {
  it('is true for any non-empty address object', () => {
    expect(carriesStorefrontAddress({ addressLines: ['4108 Park Rd'] })).toBe(true);
    // Looser than the read-back check on purpose: a remnant Google would not
    // render is still something a write would destroy, and a needless refusal
    // costs one flag where an overwrite costs re-verification by postcard.
    expect(carriesStorefrontAddress({ regionCode: 'US' })).toBe(true);
  });

  it('is false for nothing, an empty object, or a shape that is not one', () => {
    expect(carriesStorefrontAddress(undefined)).toBe(false);
    expect(carriesStorefrontAddress(null)).toBe(false);
    expect(carriesStorefrontAddress({})).toBe(false);
    expect(carriesStorefrontAddress([])).toBe(false);
    expect(carriesStorefrontAddress('4108 Park Rd')).toBe(false);
  });
});

describe('decideOverwrite', () => {
  const onListing = { regionCode: 'US', addressLines: ['1 Other St'] };

  it('proceeds on a listing with no address, which is what a restore is for', () => {
    for (const live of [undefined, {}, null]) {
      expect(
        decideOverwrite(live, { mode: 'write', overwriteExisting: false })
      ).toEqual({ action: 'proceed' });
    }
  });

  it('refuses a write onto a listing that still has an address', () => {
    const decision = decideOverwrite(onListing, {
      mode: 'write',
      overwriteExisting: false,
    });
    expect(decision.action).toBe('refuse');
    if (decision.action === 'proceed') return;
    expect(decision.message).toContain('already has an address');
    expect(decision.message).toContain('--overwrite-existing');
  });

  it('refuses over a remnant address too', () => {
    expect(
      decideOverwrite({ regionCode: 'US' }, { mode: 'write', overwriteExisting: false })
        .action
    ).toBe('refuse');
  });

  it('proceeds when --overwrite-existing says replacing it is the intent', () => {
    expect(
      decideOverwrite(onListing, { mode: 'write', overwriteExisting: true })
    ).toEqual({ action: 'proceed' });
  });

  it('never refuses a rehearsal, whatever the listing holds', () => {
    // validateOnly changes nothing, and watching Google accept the frozen
    // address is the whole point of rehearsing.
    for (const overwriteExisting of [false, true]) {
      expect(
        decideOverwrite(onListing, { mode: 'rehearse', overwriteExisting })
      ).toEqual({ action: 'proceed' });
      expect(
        decideOverwrite(undefined, { mode: 'rehearse', overwriteExisting })
      ).toEqual({ action: 'proceed' });
    }
  });
});

describe('patchUrl', () => {
  const location = 'locations/12345678901234567890';

  it('carries validateOnly=true on every rehearsal', () => {
    for (const mask of ['storefrontAddress', 'storefrontAddress,serviceArea']) {
      expect(patchUrl(location, mask, 'rehearse')).toContain('&validateOnly=true');
    }
    expect(patchUrl('locations/999', 'storefrontAddress', 'rehearse')).toContain(
      '&validateOnly=true'
    );
  });

  it('never mentions validateOnly on a real write', () => {
    for (const mask of ['storefrontAddress', 'storefrontAddress,serviceArea']) {
      expect(patchUrl(location, mask, 'write')).not.toContain('validateOnly');
    }
  });

  it('is the rehearsal URL with the rehearsal part taken off', () => {
    // States the relationship the two modes have, so that dropping the suffix
    // from one of them cannot pass as a refactor.
    expect(patchUrl(location, 'storefrontAddress', 'rehearse')).toBe(
      `${patchUrl(location, 'storefrontAddress', 'write')}&validateOnly=true`
    );
  });

  it('points at the business information API and percent-encodes the mask', () => {
    expect(patchUrl(location, 'storefrontAddress,serviceArea', 'write')).toBe(
      'https://mybusinessbusinessinformation.googleapis.com/v1/' +
        'locations/12345678901234567890?updateMask=storefrontAddress%2CserviceArea'
    );
  });
});
