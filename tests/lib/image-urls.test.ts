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
