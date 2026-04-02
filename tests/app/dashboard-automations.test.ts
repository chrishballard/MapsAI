import { describe, it, expect } from 'vitest';
import { buildAutomationItems } from '../../src/app/dashboard/automations-feed';

describe('buildAutomationItems', () => {
  const basePost = (id: string, status: string, updatedAt: Date, profileId = 'p1', profileName = 'Profile A') => ({
    id,
    status,
    updatedAt,
    profile: { id: profileId, name: profileName },
  });

  const baseResponse = (id: string, status: string, updatedAt: Date, profileId = 'p1', profileName = 'Profile A') => ({
    id,
    status,
    updatedAt,
    review: { profileId, profile: { name: profileName } },
  });

  const baseDescription = (id: string, pushedAt: Date, profileId = 'p1', profileName = 'Profile A') => ({
    id,
    pushedAt,
    profile: { id: profileId, name: profileName },
  });

  it('merges posts, review responses, and descriptions into single array', () => {
    const post = basePost('post1', 'PUBLISHED', new Date('2024-01-03'));
    const response = baseResponse('resp1', 'PUBLISHED', new Date('2024-01-02'));
    const description = baseDescription('desc1', new Date('2024-01-01'));

    const result = buildAutomationItems([post], [response], [description]);

    expect(result).toHaveLength(3);
  });

  it('sorts all items by time descending (newest first)', () => {
    const post = basePost('post1', 'PUBLISHED', new Date('2024-01-01'));
    const response = baseResponse('resp1', 'PUBLISHED', new Date('2024-01-03'));
    const description = baseDescription('desc1', new Date('2024-01-02'));

    const result = buildAutomationItems([post], [response], [description]);

    expect(result[0].id).toBe('resp1');
    expect(result[1].id).toBe('desc1');
    expect(result[2].id).toBe('post1');
  });

  it('slices result to maximum 20 items', () => {
    const posts = Array.from({ length: 15 }, (_, i) =>
      basePost(`post${i}`, 'PUBLISHED', new Date(2024, 0, i + 1))
    );
    const responses = Array.from({ length: 10 }, (_, i) =>
      baseResponse(`resp${i}`, 'PUBLISHED', new Date(2024, 1, i + 1))
    );
    const descriptions = Array.from({ length: 5 }, (_, i) =>
      baseDescription(`desc${i}`, new Date(2024, 2, i + 1))
    );

    const result = buildAutomationItems(posts, responses, descriptions);

    expect(result).toHaveLength(20);
  });

  it('maps post with status PUBLISHED to label "Published post" with detailHref "/dashboard/posts"', () => {
    const post = basePost('post1', 'PUBLISHED', new Date('2024-01-01'));
    const [item] = buildAutomationItems([post], [], []);

    expect(item.label).toBe('Published post');
    expect(item.detailHref).toBe('/dashboard/posts');
    expect(item.type).toBe('post');
  });

  it('maps post with status SCHEDULED to label "Scheduled post"', () => {
    const post = basePost('post1', 'SCHEDULED', new Date('2024-01-01'));
    const [item] = buildAutomationItems([post], [], []);

    expect(item.label).toBe('Scheduled post');
  });

  it('maps post with status APPROVED to label "Approved post"', () => {
    const post = basePost('post1', 'APPROVED', new Date('2024-01-01'));
    const [item] = buildAutomationItems([post], [], []);

    expect(item.label).toBe('Approved post');
  });

  it('maps review response with status PUBLISHED to label "Published review reply" with detailHref "/dashboard/reviews"', () => {
    const response = baseResponse('resp1', 'PUBLISHED', new Date('2024-01-01'));
    const [item] = buildAutomationItems([], [response], []);

    expect(item.label).toBe('Published review reply');
    expect(item.detailHref).toBe('/dashboard/reviews');
    expect(item.type).toBe('review_reply');
  });

  it('maps description push to label "Pushed description" with detailHref "/dashboard/profiles/{profileId}"', () => {
    const description = baseDescription('desc1', new Date('2024-01-01'), 'profile-abc');
    const [item] = buildAutomationItems([], [], [description]);

    expect(item.label).toBe('Pushed description');
    expect(item.detailHref).toBe('/dashboard/profiles/profile-abc');
    expect(item.type).toBe('description');
  });

  it('uses pushedAt (not updatedAt) as time field for description items', () => {
    const pushedAt = new Date('2024-06-15T10:00:00Z');
    const description = { ...baseDescription('desc1', pushedAt) };

    const [item] = buildAutomationItems([], [], [description]);

    expect(item.time).toEqual(pushedAt);
  });

  it('returns empty array when all inputs are empty', () => {
    const result = buildAutomationItems([], [], []);
    expect(result).toHaveLength(0);
  });
});
