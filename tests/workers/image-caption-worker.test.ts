import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Caption worker: permanent skips complete the job (retrying can't help a
// row with no usable input), while transient captioner errors propagate so
// BullMQ retries with backoff.

const mocks = vi.hoisted(() => ({
  captionImage: vi.fn(),
  processor: undefined as
    | ((job: Job<{ imageId: string }>) => Promise<void>)
    | undefined,
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      _name: string,
      processor: (job: Job<{ imageId: string }>) => Promise<void>
    ) {
      mocks.processor = processor;
    }
    on() {
      return this;
    }
  },
}));
vi.mock('../../src/lib/queue/connection', () => ({ redisConnection: {} }));
vi.mock('../../src/lib/image-captioner', () => ({
  captionImage: mocks.captionImage,
}));

await import('../../workers/image-caption-worker');

function job(imageId: string) {
  return { id: `caption-${imageId}`, data: { imageId } } as Job<{
    imageId: string;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('image caption worker', () => {
  it('captions the job image and completes', async () => {
    mocks.captionImage.mockResolvedValue({ imageId: 'img1', ok: true });

    await expect(mocks.processor!(job('img1'))).resolves.toBeUndefined();
    expect(mocks.captionImage).toHaveBeenCalledWith('img1');
  });

  it('completes (no retry) on a permanent skip', async () => {
    mocks.captionImage.mockResolvedValue({
      imageId: 'img1',
      ok: false,
      skipped: 'NO_INPUT',
    });

    await expect(mocks.processor!(job('img1'))).resolves.toBeUndefined();
  });

  it('propagates transient failures so BullMQ retries', async () => {
    mocks.captionImage.mockRejectedValue(new Error('rate limited'));

    await expect(mocks.processor!(job('img1'))).rejects.toThrow('rate limited');
  });
});
