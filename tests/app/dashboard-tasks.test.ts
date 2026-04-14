import { describe, it, expect } from 'vitest';
import { buildTaskItems } from '../../src/app/dashboard/tasks-section';
import type { TaskItem } from '../../src/app/dashboard/tasks-table';

describe('buildTaskItems', () => {
  const baseDraftPost = (id: string, createdAt: Date) => ({
    id,
    createdAt,
    content: 'Post content here',
    type: 'WHATS_NEW',
    callToAction: null as string | null,
    profile: { name: 'Profile A' },
  });

  const baseDraftedReview = (id: string, createdAt: Date) => ({
    id,
    createdAt,
    reviewerName: 'John Doe' as string | null,
    rating: 4,
    comment: 'Great place' as string | null,
    profile: { name: 'Profile A' },
    response: { content: 'Thank you for your review!' } as { content: string } | null,
  });

  it('maps draft post to task with type "approve_post" and correct fields', () => {
    const post = baseDraftPost('post1', new Date('2024-01-01'));
    const tasks = buildTaskItems([post], []);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe('approve_post');
    expect(tasks[0].id).toBe('post1');
    expect(tasks[0].profileName).toBe('Profile A');
    expect(tasks[0].postContent).toBe('Post content here');
    expect(tasks[0].postType).toBe('WHATS_NEW');
  });

  it('maps drafted review response to task with type "approve_review_reply"', () => {
    const review = baseDraftedReview('rev1', new Date('2024-01-01'));
    const tasks = buildTaskItems([], [review]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe('approve_review_reply');
    expect(tasks[0].id).toBe('rev1');
    expect(tasks[0].reviewerName).toBe('John Doe');
    expect(tasks[0].rating).toBe(4);
    expect(tasks[0].responseContent).toBe('Thank you for your review!');
  });

  it('returns empty array when no drafts', () => {
    const tasks = buildTaskItems([], []);
    expect(tasks).toHaveLength(0);
  });
});
