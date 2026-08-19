/**
 * Google Business Profile field limits, shared by server and client code.
 * Dependency-free on purpose (same pattern as image-validation.ts) so client
 * components can import it without dragging server SDKs into the bundle.
 */

/** Google's hard limit for a GBP service description. */
export const MAX_SERVICE_DESCRIPTION_LENGTH = 300;

/** Google's limit for custom (free-form) service names. */
export const MAX_SERVICE_NAME_LENGTH = 120;

/**
 * App cap on service names per description-generation request. Matches the
 * save endpoints' cap — service-rich GBP categories expose 30-70 service
 * types and the UI pre-checks all of them.
 */
export const MAX_SERVICES_PER_GENERATE = 100;
