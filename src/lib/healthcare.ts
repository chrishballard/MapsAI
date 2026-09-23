/**
 * Healthcare mode for review replies.
 *
 * A dental practice, med spa, or clinic that answers a Google review must
 * never confirm the reviewer is (or was) a patient, and never repeat a
 * visit, treatment, appointment, bill, insurance detail or record. HHS has
 * fined practices for replies that did. Profiles whose Google primary
 * category is a healthcare one get a stricter reply prompt, a check on
 * every draft before it can be approved, and no unattended publishing
 * (AUTO mode and Approve all are held).
 *
 * Kept free of server-only imports so client components can run the same
 * category test and draft check the API enforces.
 */

/** Lowercase, strip accents ("Spa médical" -> "spa medical"). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Matched as substrings of the normalized Google category display name.
// Deliberately broad: a false positive only makes replies more careful and
// holds bulk publishing; a false negative can publish patient information.
const HEALTHCARE_CATEGORY_TERMS = [
  // Dental
  "dentist",
  "dental",
  "denture",
  "orthodont",
  "periodont",
  "endodont",
  "prosthodont",
  "oral surgeon",
  "maxillofacial",
  // Aesthetic medicine
  "med spa",
  "medspa",
  "medical spa",
  "spa medical",
  "surgeon",
  "botox",
  "laser hair removal",
  "skin care clinic",
  // Physicians and clinics
  "medical",
  "physician",
  "doctor",
  "clinic",
  "hospital",
  "urgent care",
  "health center",
  "health centre",
  "medicine",
  "pediatric",
  "paediatric",
  "pediatrician",
  "obstetric",
  "gynecolog",
  "dermatolog",
  "cardiolog",
  "neurolog",
  "oncolog",
  "urolog",
  "radiolog",
  "gastroenterolog",
  "endocrinolog",
  "rheumatolog",
  "allergist",
  "orthopedic",
  "podiatr",
  "optometr",
  "ophthalmolog",
  "optician",
  "eye care",
  "audiolog",
  "hearing aid",
  "chiropract",
  "acupunct",
  "naturopath",
  "homeopath",
  "osteopath",
  "physiotherap",
  "therapist",
  "therapy",
  "rehabilitation",
  "dietitian",
  "nutritionist",
  "fertility",
  "pharmac",
  "weight loss",
  "wellness center",
  "wellness centre",
  // Mental health
  "psychiatr",
  "psycholog",
  "psychotherap",
  "counselor",
  "counsellor",
  "counseling",
  "counselling",
  "mental health",
  "behavioral health",
  "addiction",
  "treatment center",
  // Residential and home care
  "nursing",
  "assisted living",
  "memory care",
  "hospice",
  "home health",
  "home care",
  "senior care",
  "midwife",
];

// Categories that contain a term above but are not healthcare providers.
const NOT_HEALTHCARE_PATTERN =
  /\b(veterinar\w*|animal|pets?|tree|attorneys?|lawyers?|law|insurance|credit)\b/;

/**
 * True when a Google primary category (Profile.category, the display name
 * such as "Dentist" or "Medical spa") belongs to a healthcare business.
 */
export function isHealthcareCategory(
  category: string | null | undefined
): boolean {
  if (!category) return false;
  const normalized = normalize(category);
  if (!HEALTHCARE_CATEGORY_TERMS.some((term) => normalized.includes(term))) {
    return false;
  }
  return !NOT_HEALTHCARE_PATTERN.test(normalized);
}

/** One reason a healthcare draft cannot be approved as written. */
export interface HealthcareReplyIssue {
  /** Short operator-facing reason, e.g. "Mentions a visit or appointment". */
  reason: string;
  /** The text in the reply that triggered it. */
  match: string;
}

const REPLY_CHECKS: { reason: string; pattern: RegExp }[] = [
  {
    reason: "Uses an em or en dash",
    pattern: /[\u2012\u2013\u2014\u2015]|\s-{1,2}\s/,
  },
  {
    reason: "Implies the reviewer is a patient",
    pattern:
      /\b(patients?|dental family|our family of|trust(ing)? (us|in us) with|(your|our) (care|dental care|smile|teeth|tooth|health|recovery|comfort|family's)|care you (received|receive|got)|(in|under) our care|taking care of you|caring for you|(have|having) you (here|in|with us)|your experience|experience (with us|here|at)|(you've|you have|you) experienced|your (family|son|daughter|child|children|kids?|husband|wife|mom|mother|dad|father|parents?)|(send|sending|sent|bring|bringing|brought) (your|them|him|her)|(continue|continuing) to (serve|see|help) you)\b/i,
  },
  {
    reason: "Mentions a visit or appointment",
    pattern:
      /\b(visits?|visited|visiting|appointments?|appt|check-?ups?|see(ing)? you|welcome you back|come back|coming back|come (in|see us)|stop(ping)? by|next time you)\b/i,
  },
  {
    reason: "Mentions treatment or a clinical detail",
    pattern:
      /\b(treatments?|treated|treating|procedures?|exams?|examinations?|cleanings?|surgery|surgeries|diagnos\w*|prescri\w*|medications?|x-?rays?|crowns?|fillings?|extractions?|root canals?|implants?|injections?|fillers?|botox|symptoms?|pain|anxiety|conditions?)\b/i,
  },
  {
    reason: "Mentions a bill, insurance or payment",
    pattern:
      /\b(billing|billed|invoices?|payments?|insurance|insured|medicaid|medicare|copays?|deductibles?|care ?credit|financing|costs?|prices?|quoted?|out of pocket)\b/i,
  },
  {
    reason: "Mentions a record or chart",
    pattern: /\b(records?|charts?|files?)\b/i,
  },
  {
    reason: "Admits fault",
    pattern:
      /\b(responsibility|responsible|our fault|my fault|we failed|failures?|fell short|falls? short|let you down|mistakes?|unacceptable|should (never|not) have|dropped the ball|we were wrong|i was wrong|make (this|it|things) right)\b/i,
  },
];

// A run of 7+ digits, allowing the usual separators: anything that reads as
// a phone number.
const PHONE_PATTERN = /\+?\d[\d\s().-]{5,}\d/g;

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Check a healthcare reply for the things it must never say. Returns an
 * empty list when the reply can be approved.
 *
 * `reviewerName` is blanked out first, so a reviewer called "Bill" or
 * "Patience" doesn't trip a check. `officePhone` is the one phone number the
 * reply may contain; any other number is an issue.
 *
 * A pattern check, not a guarantee: it catches the phrases the old drafts
 * leaned on ("your next visit", "trust in our care", "I take full
 * responsibility"). A person still reads every healthcare reply before it
 * publishes, because AUTO mode and Approve all are held for these profiles.
 */
export function checkHealthcareReply(
  text: string,
  options: { reviewerName?: string | null; officePhone?: string | null } = {}
): HealthcareReplyIssue[] {
  let checked = text;
  const name = options.reviewerName?.trim();
  if (name) {
    for (const part of [name, ...name.split(/\s+/)]) {
      if (part.length < 2) continue;
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      checked = checked.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
    }
  }

  const issues: HealthcareReplyIssue[] = [];
  for (const { reason, pattern } of REPLY_CHECKS) {
    const match = checked.match(pattern);
    if (match) issues.push({ reason, match: match[0].trim() || match[0] });
  }

  const officeDigits = options.officePhone ? digitsOf(options.officePhone) : "";
  for (const found of checked.match(PHONE_PATTERN) ?? []) {
    const digits = digitsOf(found);
    if (digits.length < 7) continue;
    // Allow the office number with or without a country code.
    const isOffice =
      officeDigits.length >= 7 &&
      (digits.endsWith(officeDigits) || officeDigits.endsWith(digits));
    if (!isOffice) {
      issues.push({
        reason: "Contains a phone number that isn't the office's",
        match: found.trim(),
      });
      break;
    }
  }

  return issues;
}

const RATING_WORDS = ["one", "two", "three", "four", "five"];

/**
 * The reply a healthcare draft falls back to when the model's own attempts
 * keep failing the privacy check. Deliberately plain: it says nothing about
 * the reviewer, and a person edits or approves it before anything publishes
 * (healthcare replies never publish unattended).
 */
export function safeHealthcareReply(input: {
  reviewerName: string | null;
  starRating: number;
  reviewComment: string | null;
  businessPhone?: string | null;
}): string {
  const name = input.reviewerName?.trim() || null;
  const phone = input.businessPhone?.trim() || null;
  const call = phone ? `please call the office at ${phone}` : "please call the office";
  const rating = Math.min(5, Math.max(1, Math.round(input.starRating)));

  if (rating <= 2) {
    return `${name ? `${name}, we're` : "We're"} sorry to read this. We'd like to talk with you directly, so ${call}.`;
  }
  if (rating === 3) {
    return `Thank you for the feedback${name ? `, ${name}` : ""}. If you'd like to talk it over, ${call}.`;
  }
  if (input.reviewComment?.trim()) {
    return `Thank you for the kind words${name ? `, ${name}` : ""}. We appreciate you taking the time to write.`;
  }
  return `Thanks for the ${RATING_WORDS[rating - 1]} stars${name ? `, ${name}` : ""}. We appreciate it.`;
}

/** Operator-facing one-liner listing a draft's issues. */
export function describeHealthcareIssues(issues: HealthcareReplyIssue[]): string {
  return issues.map((i) => `${i.reason} ("${i.match}")`).join("; ");
}

/** Refusal for Approve all on a healthcare profile. */
export const HEALTHCARE_BULK_APPROVE_HELD_ERROR =
  "Approve all is off for healthcare businesses. Read and approve each reply on its own: a reply that confirms someone is a patient, or repeats their visit, treatment or bill, can break HIPAA.";
