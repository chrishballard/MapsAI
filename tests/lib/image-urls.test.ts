import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  displayImageUrl,
  resolvePostImageSourceUrl,
  isPubliclyReachable,
} from '@/lib/image-urls';

// The publish worker hands resolvePostImageSourceUrl's output to Google as
// the post photo's sourceUrl — it must never emit a URL Google can't fetch.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolvePostImageSourceUrl', () => {
  it('prefers the Google-hosted URL for GBP-synced images', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://app.example.com');
    expect(
      resolvePostImageSourceUrl({
        publicToken: 'ab'.repeat(16),
        googleUrl: 'https://lh3.googleusercontent.com/p/abc',
        thumbnailUrl: null,
      })
    ).toBe('https://lh3.googleusercontent.com/p/abc');
  });

  it('builds an absolute public URL for uploaded images', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://app.example.com/');
    const token = 'ab'.repeat(16);
    expect(
      resolvePostImageSourceUrl({
        publicToken: token,
        googleUrl: null,
        thumbnailUrl: null,
      })
    ).toBe(`https://app.example.com/api/public/images/${token}`);
  });

  it('returns null for uploaded images when the app URL is not public', () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    expect(
      resolvePostImageSourceUrl({
        publicToken: 'ab'.repeat(16),
        googleUrl: null,
        thumbnailUrl: null,
      })
    ).toBeNull();
  });

  it('returns null when no app URL is configured', () => {
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(
      resolvePostImageSourceUrl({
        publicToken: 'ab'.repeat(16),
        googleUrl: null,
        thumbnailUrl: null,
      })
    ).toBeNull();
  });
});

describe('isPubliclyReachable', () => {
  it('accepts public https URLs only', () => {
    expect(isPubliclyReachable('https://app.example.com/x')).toBe(true);
    expect(isPubliclyReachable('http://app.example.com/x')).toBe(false);
    expect(isPubliclyReachable('https://localhost:3000/x')).toBe(false);
    expect(isPubliclyReachable('https://127.0.0.1/x')).toBe(false);
    expect(isPubliclyReachable('not a url')).toBe(false);
  });

  it('rejects local names and private, loopback and link-local addresses', () => {
    // Google fetches the sourceUrl from its own network, so none of these
    // can ever work, and NEXTAUTH_URL pointing at one is a config mistake.
    for (const url of [
      'https://app.localhost/x',
      'https://APP.LOCALHOST/x',
      'https://localhost./x',
      'https://metadata.google.internal/x',
      'https://printer.local/x',
      'https://10.0.0.5/x',
      'https://172.16.0.1/x',
      'https://172.31.255.255/x',
      'https://192.168.1.10/x',
      'https://127.1.2.3/x',
      'https://2130706433/x', // 127.0.0.1 written as one number
      'https://169.254.169.254/x',
      'https://0.0.0.0/x',
      'https://[::1]/x',
      'https://[::]/x',
      'https://[fc00::1]/x',
      'https://[fd12:3456::1]/x',
      'https://[fe80::1]/x',
      'https://[::ffff:127.0.0.1]/x',
      'https://[::ffff:192.168.0.1]/x',
    ]) {
      expect(isPubliclyReachable(url), url).toBe(false);
    }
  });

  it('accepts public addresses just outside the private ranges', () => {
    for (const url of [
      'https://lh3.googleusercontent.com/p/abc',
      'https://localhost.example.com/x',
      'https://internal.example.com/x',
      'https://172.15.0.1/x',
      'https://172.32.0.1/x',
      'https://11.0.0.1/x',
      'https://192.169.0.1/x',
      'https://[2001:4860:4860::8888]/x',
      'https://[::ffff:8.8.8.8]/x',
      'https://[fc::1]/x', // 00fc, not fc00
      'https://[fe8::1]/x', // 0fe8, not fe80
    ]) {
      expect(isPubliclyReachable(url), url).toBe(true);
    }
  });
});

describe('displayImageUrl', () => {
  it('falls back thumbnail → googleUrl → public thumb route', () => {
    const token = 'ab'.repeat(16);
    expect(
      displayImageUrl({ publicToken: token, googleUrl: 'g', thumbnailUrl: 't' })
    ).toBe('t');
    expect(
      displayImageUrl({ publicToken: token, googleUrl: 'g', thumbnailUrl: null })
    ).toBe('g');
    // Uploaded bytes display via the lightweight thumb variant — only
    // Google fetches the bare full-size URL.
    expect(
      displayImageUrl({ publicToken: token, googleUrl: null, thumbnailUrl: null })
    ).toBe(`/api/public/images/${token}?size=thumb`);
  });
});
