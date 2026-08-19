// Gate for the Profile Settings page. Fields only become editable here once
// onboarding is complete — before that, the wizard is the single place to
// enter them, so incomplete profiles are sent back to it.

export type SettingsAccess = "not-found" | "onboarding" | "ok";

export function resolveSettingsAccess(
  profile: {
    onboardingProgress: { isComplete: boolean } | null;
  } | null
): SettingsAccess {
  if (!profile) return "not-found";
  if (!profile.onboardingProgress?.isComplete) return "onboarding";
  return "ok";
}
