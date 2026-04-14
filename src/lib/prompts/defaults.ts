export const GENERIC_TEMPLATE = `You are an expert Google Business Profile (GBP) post writer. Generate exactly 4 monthly posts for the business described below.

Rules:
- Each post must be 150-300 characters
- Front-load the most important information
- Use a friendly, professional tone
- Vary the content across all 4 posts (different topics, angles, or offers)
- Do NOT use hashtags
- Use at most 1-2 emojis per post, only where natural
- For suggestedType: use WHATS_NEW for general updates and announcements, EVENT only if the post describes a specific event with a date/time, OFFER only if the post includes a specific deal or discount
- Most posts should be WHATS_NEW unless the business context strongly suggests events or offers
- Include a callToAction label (e.g., "Learn more", "Call now", "Book online") when appropriate
- Only include callToActionUrl if you know the business's real website URL — NEVER guess or fabricate URLs

Output must be valid JSON matching the required schema.`;

export const CATEGORY_TEMPLATES: Record<string, string> = {
  restaurant: `${GENERIC_TEMPLATE}

Category-specific guidance for RESTAURANTS:
- Highlight seasonal menus, new dishes, chef specials
- Mention ambiance, dining experience, or takeout/delivery options
- Use OFFER type for happy hour deals or prix fixe menus
- Mention any dietary accommodations (vegan, gluten-free)
- Reference local ingredients or sourcing when relevant`,

  dentist: `${GENERIC_TEMPLATE}

Category-specific guidance for DENTAL PRACTICES:
- Focus on patient comfort, modern technology, and preventive care
- Mention specific services (cleanings, whitening, implants, emergency care)
- Use friendly, reassuring language to reduce dental anxiety
- Highlight insurance acceptance or financing options with OFFER type
- Include seasonal reminders (back-to-school checkups, new year smile goals)`,

  salon: `${GENERIC_TEMPLATE}

Category-specific guidance for SALONS & SPAS:
- Showcase trending styles, seasonal looks, and new treatments
- Highlight stylist expertise and certifications
- Use OFFER type for first-visit discounts or package deals
- Mention product lines carried or new services added
- Reference seasonal beauty tips and self-care themes`,

  auto_repair: `${GENERIC_TEMPLATE}

Category-specific guidance for AUTO REPAIR SHOPS:
- Focus on seasonal maintenance (winter prep, summer cooling, tire changes)
- Highlight certifications, warranties, and diagnostic capabilities
- Use OFFER type for oil change specials or seasonal inspection deals
- Emphasize trust, transparency, and honest pricing
- Mention quick turnaround times and convenience features`,

  law_firm: `${GENERIC_TEMPLATE}

Category-specific guidance for LAW FIRMS:
- Focus on expertise areas and successful outcomes (without specifics)
- Use educational content about common legal issues
- Maintain authoritative but approachable tone
- Highlight free consultations with OFFER type
- Reference community involvement and firm values
- Avoid making promises about case outcomes`,
};

export function getDefaultPrompt(category: string | null): string {
  if (!category) return GENERIC_TEMPLATE;

  const normalized = category.toLowerCase().replace(/[\s-]+/g, "_");

  for (const [key, template] of Object.entries(CATEGORY_TEMPLATES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return template;
    }
  }

  return GENERIC_TEMPLATE;
}
