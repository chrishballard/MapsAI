import { describe, it, expect } from 'vitest';
import { resolveSettingsAccess } from '../../src/app/dashboard/profiles/[id]/settings/access';

// The Profile Settings page is the post-onboarding home for every onboarding
// field. Incomplete profiles must be routed back to the wizard, never shown
// the settings page.

describe('resolveSettingsAccess', () => {
  it('returns not-found for a missing profile', () => {
    expect(resolveSettingsAccess(null)).toBe('not-found');
  });

  it('routes to onboarding when the profile has no progress record', () => {
    expect(resolveSettingsAccess({ onboardingProgress: null })).toBe(
      'onboarding'
    );
  });

  it('routes to onboarding while onboarding is incomplete', () => {
    expect(
      resolveSettingsAccess({ onboardingProgress: { isComplete: false } })
    ).toBe('onboarding');
  });

  it('grants access once onboarding is complete', () => {
    expect(
      resolveSettingsAccess({ onboardingProgress: { isComplete: true } })
    ).toBe('ok');
  });
});
