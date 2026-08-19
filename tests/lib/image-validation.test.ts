import { describe, it, expect } from 'vitest';
import {
  sniffImageContentType,
  imageDimensions,
  validateImageUpload,
  IMAGE_MAX_BYTES,
} from '@/lib/image-validation';
import { pngBytes, jpegBytes, junkBytes } from '../helpers/image-fixtures';

// Upload validation gate — everything entering the image library (team and
// client uploads) passes through here.

describe('sniffImageContentType', () => {
  it('recognizes JPEG and PNG magic bytes', () => {
    expect(sniffImageContentType(jpegBytes(800, 600))).toBe('image/jpeg');
    expect(sniffImageContentType(pngBytes(800, 600))).toBe('image/png');
  });

  it('rejects everything else', () => {
    expect(sniffImageContentType(junkBytes())).toBeNull();
    expect(sniffImageContentType(new Uint8Array(0))).toBeNull();
  });
});

describe('imageDimensions', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(imageDimensions(pngBytes(1234, 567), 'image/png')).toEqual({
      width: 1234,
      height: 567,
    });
  });

  it('reads JPEG dimensions from the SOF marker', () => {
    expect(imageDimensions(jpegBytes(1600, 1200), 'image/jpeg')).toEqual({
      width: 1600,
      height: 1200,
    });
  });
});

describe('validateImageUpload', () => {
  it('accepts a valid photo and reports its dimensions', () => {
    const result = validateImageUpload(jpegBytes(1200, 900));
    expect(result).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      width: 1200,
      height: 900,
    });
  });

  it('rejects non-image files', () => {
    const result = validateImageUpload(junkBytes());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JPG and PNG/);
  });

  it('rejects images below the Google 400x300 minimum', () => {
    const result = validateImageUpload(pngBytes(399, 300));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/400x300/);

    const tooShort = validateImageUpload(pngBytes(400, 299));
    expect(tooShort.ok).toBe(false);
  });

  it('accepts the exact 400x300 minimum', () => {
    expect(validateImageUpload(pngBytes(400, 300)).ok).toBe(true);
  });

  it('rejects files under the 10KB floor', () => {
    const result = validateImageUpload(jpegBytes(800, 600, 5 * 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/10KB/);
  });

  it('rejects files over the size cap', () => {
    const result = validateImageUpload(jpegBytes(800, 600, IMAGE_MAX_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/);
  });
});
