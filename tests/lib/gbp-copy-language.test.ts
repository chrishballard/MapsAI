import { describe, it, expect, vi, beforeEach } from 'vitest';

// 2026-06-30: the Bees Friends Cleaners Portland profile has its GBP language
// set to es-419, so Google handed RankMaps Spanish service type names, and the
// service generator (which said nothing about language) wrote 8 Spanish
// descriptions that were pushed to Google. Every client is a US business:
// every generator whose output lands on a Google profile, or feeds one, must
// say to write in US English whatever language its inputs are in.

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/lib/claude', () => ({ generate: mocks.generate }));

const { generateServiceDescriptions } = await import('@/lib/service-generator');
const { generateDescription } = await import('@/lib/description-generator');
const { generateMonthlyPosts } = await import('@/lib/post-generator');
const { generateReviewResponse } = await import('@/lib/review-responder');
const { generateKeywordSuggestions } = await import('@/lib/keyword-generator');

// A Spanish-language profile, as RankMaps receives it from Google
const spanishProfile = {
  name: 'Bees Friends Cleaners',
  category: 'Servicio de limpieza',
  address: 'Portland, ME',
};

function lastSystemPrompt(): string {
  const calls = mocks.generate.mock.calls;
  return calls[calls.length - 1][0].system as string;
}

function expectUsEnglishRule(system: string) {
  expect(system).toMatch(/write (?:everything |it |the \w+ )?in US English/i);
  // Inputs in another language must not pull the output along with them
  expect(system).toMatch(/even (?:when|if) .*another language/i);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('US English instruction in GBP copy generators', () => {
  it('service descriptions', async () => {
    mocks.generate.mockResolvedValue({
      services: [{ serviceName: 'Limpieza de colchones', description: 'Mattress cleaning in Portland.' }],
    });
    await generateServiceDescriptions({
      businessName: spanishProfile.name,
      category: spanishProfile.category,
      address: spanishProfile.address,
      keywords: [],
      cities: [],
      serviceNames: ['Limpieza de colchones'],
    });
    const system = lastSystemPrompt();
    expectUsEnglishRule(system);
    // The service name itself is a matching key and must not be translated
    expect(system).toMatch(/Copy each service name EXACTLY as given/);
  });

  it('business description', async () => {
    mocks.generate.mockResolvedValue({ description: 'x'.repeat(730) });
    await generateDescription({ ...spanishProfile, keywords: [], cities: [] });
    expectUsEnglishRule(lastSystemPrompt());
  });

  it('posts from the default template', async () => {
    mocks.generate.mockResolvedValue({
      posts: [{ content: 'Spring cleaning slots are open.', suggestedType: 'WHATS_NEW' }],
    });
    await generateMonthlyPosts(spanishProfile);
    expectUsEnglishRule(lastSystemPrompt());
  });

  it('posts from a custom prompt template', async () => {
    mocks.generate.mockResolvedValue({
      posts: [{ content: 'Spring cleaning slots are open.', suggestedType: 'WHATS_NEW' }],
    });
    await generateMonthlyPosts(spanishProfile, 'Write 4 short, upbeat posts.');
    const system = lastSystemPrompt();
    expect(system).toContain('Write 4 short, upbeat posts.');
    expectUsEnglishRule(system);
  });

  it('review replies', async () => {
    mocks.generate.mockResolvedValue({ response: 'Thank you, Ana!', sentiment: 'positive', tone: 'warm' });
    await generateReviewResponse({
      businessName: spanishProfile.name,
      businessCategory: spanishProfile.category,
      reviewerName: 'Ana',
      starRating: 5,
      reviewComment: 'Excelente servicio',
    });
    expectUsEnglishRule(lastSystemPrompt());
  });

  it('healthcare review replies', async () => {
    mocks.generate.mockResolvedValue({ response: 'Thank you for the kind words, Ana.', sentiment: 'positive', tone: 'warm' });
    await generateReviewResponse({
      businessName: 'Portland Dental',
      businessCategory: 'Dentist',
      reviewerName: 'Ana',
      starRating: 5,
      reviewComment: 'Muy amables',
    });
    expectUsEnglishRule(lastSystemPrompt());
  });

  it('healthcare replies keep English after operator instructions (the privacy check reads English)', async () => {
    mocks.generate.mockResolvedValue({ response: 'Thank you for the kind words, Ana.', sentiment: 'positive', tone: 'warm' });
    await generateReviewResponse({
      businessName: 'Portland Dental',
      businessCategory: 'Dentist',
      reviewerName: 'Ana',
      starRating: 5,
      reviewComment: 'Muy amables',
      customInstructions: 'Answer Spanish reviews in Spanish.',
    });
    const system = lastSystemPrompt();
    const afterInstructions = system.slice(system.indexOf('</operator_instructions>'));
    expect(afterInstructions).toMatch(/always reply in US English/);
  });

  it('target keywords (they feed every other generator)', async () => {
    mocks.generate.mockResolvedValue({
      keywords: Array.from({ length: 8 }, (_, i) => ({ keyword: `cleaning ${i}`, reasoning: 'Fits.' })),
    });
    await generateKeywordSuggestions(spanishProfile);
    expectUsEnglishRule(lastSystemPrompt());
  });
});
