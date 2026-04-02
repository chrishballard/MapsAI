// Score thresholds: green >= 70 | amber 40-69 | red < 40
// D-01: Equal weighting across all 5 active signals — 20 points each, 100 total
// D-08: Fixed 30-day rolling window for time-based signals

export type ScoreStatus = 'good' | 'warning' | 'critical';
export type ScoreGrade = 'green' | 'amber' | 'red';

export interface ScoreCheck {
  signal: string;
  score: number;
  max: number;
  status: ScoreStatus;
  value: string;
  benchmark: string;
  recommendation: string;
}

export interface OptimizationScore {
  total: number;
  grade: ScoreGrade;
  checks: ScoreCheck[];
}

// Input: plain interface with no Prisma imports — safe to use in both server and client contexts
export interface ProfileInput {
  reviews: Array<{ rating: number; reviewDate: Date }>;
  posts: Array<{ publishedAt: Date | null; status: string }>;
  descriptions: Array<{ isApproved: boolean; isPushed: boolean }>;
  services: Array<{ isApproved: boolean; isPushed: boolean }>;
}

const WINDOW_DAYS = 30;

// Active signals: D-02
// Skipped: images (D-03), attributes (D-04)

function scoreReviewFrequency(
  reviews: ProfileInput['reviews'],
  windowStart: Date
): ScoreCheck {
  const recent = reviews.filter(r => r.reviewDate >= windowStart);
  const count = recent.length;

  let score: number;
  let status: ScoreStatus;

  if (count >= 4) {
    score = 20;
    status = 'good';
  } else if (count >= 1) {
    // Proportional: 1 review = 5 pts, 2 = 10 pts, 3 = 15 pts
    score = count * 5;
    status = 'warning';
  } else {
    score = 0;
    status = 'critical';
  }

  return {
    signal: 'Review Frequency',
    score,
    max: 20,
    status,
    value: `${count} review${count === 1 ? '' : 's'} in 30 days`,
    benchmark: '4+ reviews per 30 days',
    recommendation: 'Encourage happy customers to leave a review after service.',
  };
}

function scorePostFrequency(
  posts: ProfileInput['posts'],
  windowStart: Date
): ScoreCheck {
  const recent = posts.filter(
    p => p.publishedAt !== null && p.publishedAt >= windowStart
  );
  const count = recent.length;

  let score: number;
  let status: ScoreStatus;

  if (count >= 4) {
    score = 20;
    status = 'good';
  } else if (count >= 1) {
    // Proportional: 1 post = 5 pts, 2 = 10 pts, 3 = 15 pts
    score = count * 5;
    status = 'warning';
  } else {
    score = 0;
    status = 'critical';
  }

  return {
    signal: 'Post Frequency',
    score,
    max: 20,
    status,
    value: `${count} post${count === 1 ? '' : 's'} in 30 days`,
    benchmark: '4+ posts per 30 days',
    recommendation: 'Publish at least 1 Google post per week to stay active.',
  };
}

function scoreRating(reviews: ProfileInput['reviews']): ScoreCheck {
  if (reviews.length === 0) {
    return {
      signal: 'Rating',
      score: 0,
      max: 20,
      status: 'critical',
      value: 'No reviews yet',
      benchmark: '4.0+ average rating',
      recommendation: 'Respond to all reviews and resolve complaints promptly.',
    };
  }

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const rounded = Math.round(avg * 10) / 10;

  let score: number;
  let status: ScoreStatus;

  if (avg >= 4.0) {
    score = 20;
    status = 'good';
  } else if (avg >= 3.0) {
    // Proportional 10-19 pts: maps [3.0, 4.0) to [10, 20)
    score = Math.round(10 + ((avg - 3.0) / 1.0) * 9);
    status = 'warning';
  } else {
    // Critical: < 3.0 — maps [0, 3.0) to [0, 9]
    score = Math.round((avg / 3.0) * 9);
    status = 'critical';
  }

  return {
    signal: 'Rating',
    score,
    max: 20,
    status,
    value: `${rounded} average rating`,
    benchmark: '4.0+ average rating',
    recommendation: 'Respond to all reviews and resolve complaints promptly.',
  };
}

function scoreDescriptionCompleteness(
  descriptions: ProfileInput['descriptions']
): ScoreCheck {
  const pushed = descriptions.find(d => d.isApproved && d.isPushed);
  const approved = descriptions.find(d => d.isApproved && !d.isPushed);

  let score: number;
  let status: ScoreStatus;
  let value: string;

  if (pushed) {
    score = 20;
    status = 'good';
    value = 'Description approved and pushed';
  } else if (approved) {
    score = 10;
    status = 'warning';
    value = 'Description approved, not pushed';
  } else {
    score = 0;
    status = 'critical';
    value = 'No approved description';
  }

  return {
    signal: 'Description Completeness',
    score,
    max: 20,
    status,
    value,
    benchmark: 'Description approved and live on GBP',
    recommendation: 'Approve and push the AI-generated description from the optimization page.',
  };
}

function scoreServicesCompleteness(
  services: ProfileInput['services']
): ScoreCheck {
  const pushedCount = services.filter(s => s.isPushed).length;

  let score: number;
  let status: ScoreStatus;

  if (pushedCount >= 3) {
    score = 20;
    status = 'good';
  } else if (pushedCount >= 1) {
    // Proportional: 1 service = 7 pts, 2 = 13 pts
    score = pushedCount === 1 ? 7 : 13;
    status = 'warning';
  } else {
    score = 0;
    status = 'critical';
  }

  return {
    signal: 'Services Completeness',
    score,
    max: 20,
    status,
    value: `${pushedCount} service${pushedCount === 1 ? '' : 's'} pushed`,
    benchmark: '3+ services live on GBP',
    recommendation: 'Add or approve more services to show Google your full offering.',
  };
}

export function computeOptimizationScore(profile: ProfileInput): OptimizationScore {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const checks: ScoreCheck[] = [
    scoreReviewFrequency(profile.reviews, windowStart),
    scorePostFrequency(profile.posts, windowStart),
    scoreRating(profile.reviews),
    scoreDescriptionCompleteness(profile.descriptions),
    scoreServicesCompleteness(profile.services),
  ];

  const total = checks.reduce((sum, c) => sum + c.score, 0);
  // Score thresholds: green >= 70, amber 40-69, red < 40
  const grade: ScoreGrade = total >= 70 ? 'green' : total >= 40 ? 'amber' : 'red';

  return { total, grade, checks };
}
