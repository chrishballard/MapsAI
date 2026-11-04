import { describe, it, expect } from 'vitest';
import {
  findRepeatedReply,
  withoutReviewerName,
  type EarlierReply,
} from '@/lib/review-reply-repeats';

function earlier(content: string, reviewerName: string | null): EarlierReply {
  return { content, reviewerName, ratingOnly: true };
}

describe('findRepeatedReply', () => {
  it('catches the same sentence with the name swapped', () => {
    const robin = earlier(
      'Thank you so much for the 5-star rating, Robin, we really appreciate it!',
      'Robin Hale'
    );
    expect(
      findRepeatedReply(
        'Thank you so much for the 5-star rating, Sam, we really appreciate it!',
        'Sam Ortiz',
        [robin]
      )
    ).toBe(robin);
  });

  it('ignores case and punctuation', () => {
    const other = earlier('Thanks for the five stars, Dana. We appreciate it.', 'Dana');
    expect(
      findRepeatedReply('thanks for the five-stars, Lee! we appreciate it', 'Lee', [other])
    ).toBe(other);
  });

  it('takes out a full name and a two-letter one', () => {
    const other = earlier('Thank you, Dana Lee, we appreciate it.', 'Dana Lee');
    expect(findRepeatedReply('Thank you, A T, we appreciate it.', 'A T', [other])).toBe(other);
  });

  it('leaves a lone letter alone inside the reply', () => {
    const other = earlier('Thanks, what a kind note.', null);
    expect(findRepeatedReply('Thanks, what kind note.', 'A', [other])).toBeNull();
  });

  it('copes with a name full of regex characters', () => {
    const other = earlier('Thanks (Mr. *Lee), we appreciate it.', '(Mr. *Lee)');
    expect(findRepeatedReply('Thanks Dana, we appreciate it.', 'Dana', [other])).toBe(other);
  });

  it('lets different wording through', () => {
    const robin = earlier('Thank you for the 5-star rating, Robin!', 'Robin');
    expect(
      findRepeatedReply('Thanks for the five stars, Sam. It means a lot.', 'Sam', [robin])
    ).toBeNull();
  });

  it('never matches a reply that is nothing but the name', () => {
    expect(findRepeatedReply('Sam!', 'Sam', [earlier('Robin!', 'Robin')])).toBeNull();
  });
});

describe('withoutReviewerName', () => {
  it.each([
    ['Thank you for the rating, Robin, we appreciate it!', 'Robin', 'Thank you for the rating, we appreciate it!'],
    ['Thanks, Sam.', 'Sam', 'Thanks.'],
    ['Alex, thank you so much.', 'Alex Ruiz', 'thank you so much.'],
    ['Thank you, J Ford!', 'J Ford', 'Thank you!'],
    ['Thanks so much.', null, 'Thanks so much.'],
  ])('%s', (reply, name, expected) => {
    expect(withoutReviewerName(reply, name)).toBe(expected);
  });
});
