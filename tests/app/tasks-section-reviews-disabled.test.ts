import { describe, it, expect, vi, beforeEach } from 'vitest';

// "No review-related tasks" while reviews are off: the dashboard task list
// must not offer review replies for approval on a disabled profile.

const mocks = vi.hoisted(() => ({
  prisma: {
    post: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
  },
  getSelectedProfileId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/selected-profile', () => ({
  getSelectedProfileId: mocks.getSelectedProfileId,
}));

const { TasksSection } = await import('@/app/dashboard/tasks-section');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSelectedProfileId.mockResolvedValue('p1');
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.review.findMany.mockResolvedValue([]);
});

describe('TasksSection', () => {
  it('only queries drafted replies for profiles with reviews enabled', async () => {
    await TasksSection();

    expect(mocks.prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          profileId: 'p1',
          profile: { reviewsEnabled: true },
          response: { status: 'DRAFTED' },
        }),
      })
    );
  });
});
