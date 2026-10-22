import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BusinessOption, ReviewsOnlyBadge } from '../../src/components/business-selector';

// Reviews-only profiles (offboarded, reviews still synced: Lumos Dental) sit
// in the business selector since #21 so their reviews settings can be
// reached, but they get no AI posts and are left off the post Generate page.
// Nothing in the selector said so: picking one and opening Posts looked
// like a business whose posts had gone missing.

const base = { id: 'p1', name: 'Lumos Dental', address: '1 Main St', category: null };

describe('BusinessOption', () => {
  it('marks a reviews-only business', () => {
    const html = renderToStaticMarkup(
      <BusinessOption profile={{ ...base, reviewsOnly: true }} selected={false} onSelect={() => {}} />
    );
    expect(html).toContain('Lumos Dental');
    expect(html).toContain('Reviews only');
    expect(html).toContain('No AI posts');
  });

  it('adds nothing for an onboarded business', () => {
    const html = renderToStaticMarkup(
      <BusinessOption profile={{ ...base, reviewsOnly: false }} selected={false} onSelect={() => {}} />
    );
    expect(html).not.toContain('Reviews only');
  });
});

describe('ReviewsOnlyBadge', () => {
  it('explains itself on hover', () => {
    const html = renderToStaticMarkup(<ReviewsOnlyBadge />);
    expect(html).toContain('Reviews only');
    expect(html).toMatch(/title="[^"]*no AI posts/i);
  });
});
