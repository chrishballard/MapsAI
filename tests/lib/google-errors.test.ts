import { describe, it, expect } from 'vitest';
import {
  describeGoogleError,
  isServiceDisabled,
  isUnroutedHost,
  readFailure,
  serviceDisabledActivationUrl,
} from '@/lib/google-errors';

// A GBP 400 says only "Request contains an invalid argument." — the field and
// the rule it broke live in error.details. Every push helper runs failures
// through describeGoogleError so the caller sees which field Google rejected.

function gaxios(status: number, data: unknown, message = 'Request failed') {
  return { response: { status, data }, message };
}

const fieldViolation400 = gaxios(
  400,
  {
    error: {
      code: 400,
      message: 'Request contains an invalid argument.',
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.BadRequest',
          fieldViolations: [
            {
              field: 'service_area',
              description:
                'Storefront_address must be explicitly set to empty for pure service area business.',
            },
            { field: 'service_area.places', description: 'Field is required' },
          ],
        },
      ],
    },
  },
  'Request contains an invalid argument.'
);

const serviceDisabled403 = gaxios(403, {
  error: {
    code: 403,
    message: 'My Business Place Actions API has not been used in project ...',
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'SERVICE_DISABLED',
        domain: 'googleapis.com',
        metadata: {
          service: 'mybusinessplaceactions.googleapis.com',
          activationUrl:
            'https://console.developers.google.com/apis/api/mybusinessplaceactions.googleapis.com/overview?project=25337394982',
        },
      },
    ],
  },
});

const htmlShell404 = gaxios(404, '<!DOCTYPE html>\n<html lang=en>...', '<!DOCTYPE html>');

describe('describeGoogleError', () => {
  it('names every field violation instead of the useless top-level message', () => {
    const described = describeGoogleError(fieldViolation400, 'fallback');
    expect(described).toContain('service_area');
    expect(described).toContain('Storefront_address must be explicitly set to empty');
    expect(described).toContain('service_area.places: Field is required');
    expect(described).not.toBe('Request contains an invalid argument.');
  });

  it('falls back to the ErrorInfo reason and metadata when there are no field violations', () => {
    const described = describeGoogleError(serviceDisabled403, 'fallback');
    expect(described).toContain('SERVICE_DISABLED');
    expect(described).toContain('mybusinessplaceactions.googleapis.com');
  });

  it('uses the Error message when the failure never reached Google', () => {
    expect(describeGoogleError(new Error('socket hang up'), 'fallback')).toBe(
      'socket hang up'
    );
  });

  it('says an HTML 404 is an unrouted endpoint, not a disabled API', () => {
    const described = describeGoogleError(htmlShell404, 'fallback');
    expect(described).toContain('not routed');
    expect(described).toContain('not a disabled-API error');
  });
});

describe('API availability classification', () => {
  it('detects SERVICE_DISABLED and hands back the activation link', () => {
    expect(isServiceDisabled(serviceDisabled403)).toBe(true);
    expect(serviceDisabledActivationUrl(serviceDisabled403)).toContain(
      'project=25337394982'
    );
  });

  // The whole point of keeping these apart: enabling an API in the console
  // fixes SERVICE_DISABLED and does nothing at all for an unrouted host.
  it('does not mistake an HTML 404 for a disabled API', () => {
    expect(isServiceDisabled(htmlShell404)).toBe(false);
    expect(isUnroutedHost(htmlShell404)).toBe(true);
    expect(isUnroutedHost(serviceDisabled403)).toBe(false);
  });

  it('treats a JSON 404 as a missing resource, not an unrouted host', () => {
    const missing = gaxios(404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
    expect(isUnroutedHost(missing)).toBe(false);
  });
});

describe('readFailure', () => {
  it('reports a disabled API with its reason and activation URL', () => {
    const result = readFailure(serviceDisabled403, 'fallback');
    expect(result.ok).toBe(false);
    expect(result.unavailable?.reason).toBe('SERVICE_DISABLED');
    expect(result.unavailable?.activationUrl).toContain('mybusinessplaceactions');
  });

  it('reports an unrouted host as NOT_ROUTED with no activation URL', () => {
    const result = readFailure(htmlShell404, 'fallback');
    expect(result.unavailable?.reason).toBe('NOT_ROUTED');
    expect(result.unavailable?.activationUrl).toBeUndefined();
  });

  it('leaves `unavailable` unset for an ordinary call failure', () => {
    const result = readFailure(fieldViolation400, 'fallback');
    expect(result.ok).toBe(false);
    expect(result.unavailable).toBeUndefined();
    expect(result.error).toContain('service_area');
  });
});
