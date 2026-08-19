import { describe, it, expect, vi, beforeEach } from 'vitest';

// The "Pending Reviews" stat and the AI Insights pending count must match
// the task list: drafts whose star rating is set to Ignore are not pending
// work and must not inflate either number.

const mocks = vi.hoisted(() => ({
  prisma: {
    profile: { count: vi.fn() },
    post: { count: vi.fn() },
    reviewResponse: { count: vi.fn() },
    report: { count: vi.fn() },
  },
  getSelectedProfileId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/selected-profile', () => ({
  getSelectedProfileId: mocks.getSelectedProfileId,
}));

const { StatsGrid, AIInsightsPanel } = await import(
  '@/app/dashboard/stats-grid'
);

const IGNORED_RATINGS_NOT_FILTER = {
  NOT: {
    OR: [
      { rating: 1, profile: { reviewReplyMode1: 'IGNORE' } },
      { rating: 2, profile: { reviewReplyMode2: 'IGNORE' } },
      { rating: 3, profile: { reviewReplyMode3: 'IGNORE' } },
      { rating: 4, profile: { reviewReplyMode4: 'IGNORE' } },
      { rating: 5, profile: { reviewReplyMode5: 'IGNORE' } },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSelectedProfileId.mockResolvedValue('p1');
  mocks.prisma.profile.count.mockResolvedValue(1);
  mocks.prisma.post.count.mockResolvedValue(0);
  mocks.prisma.reviewResponse.count.mockResolvedValue(0);
  mocks.prisma.report.count.mockResolvedValue(0);
});

describe('pending review counts', () => {
  it('StatsGrid excludes drafts for ignored star ratings', async () => {
    await StatsGrid();

    expect(mocks.prisma.reviewResponse.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'DRAFTED',
          review: expect.objectContaining({
            profileId: 'p1',
            profile: { reviewsEnabled: true },
            ...IGNORED_RATINGS_NOT_FILTER,
          }),
        }),
      })
    );
  });

  it('AIInsightsPanel excludes drafts for ignored star ratings', async () => {
    await AIInsightsPanel();

    expect(mocks.prisma.reviewResponse.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'DRAFTED',
          review: expect.objectContaining({
            profileId: 'p1',
            profile: { reviewsEnabled: true },
            ...IGNORED_RATINGS_NOT_FILTER,
          }),
        }),
      })
    );
  });
});
