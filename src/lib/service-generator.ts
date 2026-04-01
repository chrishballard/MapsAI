import { z } from "zod";
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ServiceDescriptionSchema = z.object({
  services: z.array(
    z.object({
      serviceName: z.string(),
      description: z.string(),
    })
  ),
});

export async function generateServiceDescriptions(params: {
  businessName: string;
  category: string | null;
  address: string | null;
  keywords: string[];
  cities: string[];
  serviceNames: string[];
}): Promise<{ serviceName: string; description: string }[]> {
  const systemPrompt = `You are an expert local SEO copywriter specializing in Google Business Profile service descriptions. Write compelling, SEO-optimized descriptions for each service listed below.

IMPORTANT: Only generate descriptions for the exact services provided. Do NOT add, suggest, or invent additional services.

Rules:
- Write a unique description for each service provided — no more, no less
- Each description MUST be under 300 characters (this is a hard Google limit)
- Naturally incorporate the provided target keywords where relevant — do NOT force every keyword into every description
- Reference target cities/service areas naturally where appropriate
- Write in third person (use the business name or "the business", never "we" or "our")
- Each description should differentiate itself — avoid repetitive phrasing across descriptions
- Focus on: what the service includes, why customers choose this business for it, and what makes their approach unique
- Do NOT include phone numbers, URLs, or promotional language (e.g. "best", "#1", "call now")
- Do NOT use ALL CAPS for emphasis`;

  const userMessage = [
    `Business name: ${params.businessName}`,
    params.category ? `Category: ${params.category}` : null,
    params.address ? `Address: ${params.address}` : null,
    params.keywords.length > 0
      ? `Target keywords: ${params.keywords.join(", ")}`
      : null,
    params.cities.length > 0
      ? `Service areas/cities: ${params.cities.join(", ")}`
      : null,
    `\nServices to describe:\n${params.serviceNames.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(ServiceDescriptionSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse service descriptions from Claude");
  }

  // Validate that every input serviceName has a corresponding output
  const outputNames = new Set(parsed.services.map((s) => s.serviceName));
  for (const name of params.serviceNames) {
    if (!outputNames.has(name)) {
      console.warn(
        `[service-generator] Missing description for service: ${name}`
      );
    }
  }

  return parsed.services;
}
