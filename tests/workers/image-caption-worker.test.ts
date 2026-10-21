import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Caption worker: permanent skips complete the job (retrying can't help a
// row with no usable input), while transient captioner errors propagate so
// BullMQ retries with backoff.

const mocks = vi.hoisted(() => ({
  captionImage: vi.fn(),
  recordCaptionRetriesExhausted: vi.fn(),
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
  recordCaptionRetriesExhausted: mocks.recordCaptionRetriesExhausted,
}));

await import('../../workers/image-caption-worker');

function job(
  imageId: string,
  { attemptsMade = 0, priorAttempts }: { attemptsMade?: number; priorAttempts?: number } = {}
) {
  return {
    id: `caption-${imageId}`,
    data: priorAttempts === undefined ? { imageId } : { imageId, priorAttempts },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<{ imageId: string }>;
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
    expect(mocks.recordCaptionRetriesExhausted).not.toHaveBeenCalled();
  });
});

describe('image caption worker attempt cap', () => {
  // A failed job is replaced on the next trigger (sync, upload, generation
  // batch) with the attempts it spent carried in priorAttempts. Six in all,
  // then the image is recorded as a permanent skip instead of retried.

  it('records RETRIES_EXHAUSTED and completes when the 6th attempt fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.captionImage.mockRejectedValue(
      new Error('Failed to parse image caption from Claude')
    );

    // 3 attempts in the job this one replaced, 2 failed so far in this one.
    await expect(
      mocks.processor!(job('img1', { priorAttempts: 3, attemptsMade: 2 }))
    ).resolves.toBeUndefined();
    expect(mocks.recordCaptionRetriesExhausted).toHaveBeenCalledWith('img1');
  });

  it('never captions a job that starts with the attempts already spent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      mocks.processor!(job('img1', { priorAttempts: 6 }))
    ).resolves.toBeUndefined();
    expect(mocks.captionImage).not.toHaveBeenCalled();
    expect(mocks.recordCaptionRetriesExhausted).toHaveBeenCalledWith('img1');
  });

  it('still retries below the cap', async () => {
    mocks.captionImage.mockRejectedValue(new Error('rate limited'));

    await expect(
      mocks.processor!(job('img1', { priorAttempts: 3, attemptsMade: 1 }))
    ).rejects.toThrow('rate limited');
    expect(mocks.recordCaptionRetriesExhausted).not.toHaveBeenCalled();
  });
});
