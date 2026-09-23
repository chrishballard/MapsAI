import { describe, it, expect } from 'vitest';
import {
  checkHealthcareReply,
  isHealthcareCategory,
  safeHealthcareReply,
} from '@/lib/healthcare';

// Healthcare mode keys off the Google primary category. The lists below are
// every category on a production profile as of 2026-09-23, split the way
// the matcher must split them.

const PROD_HEALTHCARE_CATEGORIES = [
  'Alternative medicine practitioner',
  'Assisted living facility',
  'Cardiologist',
  'Cosmetic dentist',
  'Cosmetic surgeon',
  'Counselor',
  'Dental clinic',
  'Dental implants provider',
  'Dentist',
  'Doctor',
  'Home health care service',
  'Hypnotherapy service',
  'Medical clinic',
  'Medical spa',
  'Mental health service',
  'Optometrist',
  'Orthodontist',
  'Pediatric dentist',
  'Physical therapist',
  'Plastic surgeon',
  'Psychiatrist',
  'Spa médical',
  'Wellness center',
];

const PROD_OTHER_CATEGORIES = [
  'Accounting firm', 'Adult entertainment store', 'Appliance repair service',
  'Auto glass repair service', 'Auto glass shop', 'Auto repair shop',
  'Barber shop', 'Bathroom remodeler', 'Bookkeeping service',
  'Bottled water supplier', 'Boutique', 'Business broker', 'Cabinet maker',
  'Cafe', 'Car detailing service', 'Carpet cleaning service', 'Carpintero',
  'Carport and pergola builder', 'Caterer', 'Certified public accountant',
  'Child care agency', 'College', 'Commercial real estate agency',
  'Computer support and services', 'Concrete contractor',
  'Construction company', 'Construction machine dealer', 'Contractor',
  'Corporate office', 'Countertop store', 'Couvreur', 'Cremation service',
  'Criminal justice attorney', 'Custom home builder', 'Deck builder',
  'Diseñador paisajista', 'Divorce lawyer', 'Dock builder',
  'Dry wall contractor', 'Electrician', 'Electronics store',
  'Equipment rental agency', 'Estate planning attorney', 'Event venue',
  'Financial advisor', 'Financial consultant',
  'Fire damage restoration service', 'Ford dealer', 'Forestry service',
  'General contractor', 'Glass & mirror shop', 'Gutter service',
  'Gymnastics club', 'Hat shop', 'Health insurance agency', 'Home builder',
  'Home improvement shop', 'Home inspector', 'House cleaning service',
  'HVAC contractor', 'Indoor golf course', 'Insurance broker', 'Jeweler',
  'Jewelry store', 'Junk removal service', 'Kitchen remodeler',
  'Landscape designer', 'Landscape lighting designer', 'Landscaper',
  'Law firm', 'Lawn care service', 'Lawyer', 'Lighting contractor',
  'Liquor store', 'Loss adjuster', 'Lumber store', 'Mailing service',
  'Marketing agency', 'Mortgage broker', 'Mover',
  'Moving and storage service', 'Moving service', 'Music school', 'Painter',
  'Painting', 'Passport photo processor', 'Patio enclosure supplier',
  'Paving contractor', 'Personal chef service', 'Personal injury attorney',
  'Pest control service', 'Pet cemetery', 'Pet funeral service',
  'Photo booth', 'Pizza restaurant', 'Plumber', 'Pool cleaning service',
  'Pressure washing service', 'Property management company',
  'Real estate agency', 'Real estate agent', 'Real estate consultant',
  'Real estate school', 'Recruitment Agency', 'Remodeler', 'Repair service',
  'Roofing contractor', 'Roofing Service', 'RV park', 'Sandblasting service',
  'Self-storage facility', 'Servicios de limpieza doméstica', 'Sign shop',
  'Software company', 'Sushi restaurant', 'Tattoo and piercing shop',
  'Tattoo shop', 'Tax preparation service', 'Townhouse complex',
  'Travel agency', 'Tree service', 'Turf supplier', 'Tutoring service',
  'Vaporiser Shop', 'Vehicle wrapping service',
  'Vitamin & supplements store', 'Water damage restoration service',
  'Wedding venue', 'Western apparel store', 'Window cleaning service',
  'Window installation service', 'Window supplier',
];

describe('isHealthcareCategory', () => {
  it.each(PROD_HEALTHCARE_CATEGORIES)('treats "%s" as healthcare', (category) => {
    expect(isHealthcareCategory(category)).toBe(true);
  });

  it.each(PROD_OTHER_CATEGORIES)('does not treat "%s" as healthcare', (category) => {
    expect(isHealthcareCategory(category)).toBe(false);
  });

  it.each([
    'Oral surgeon',
    'Periodontist',
    'Endodontist',
    'Chiropractor',
    'Physician',
    'Family practice physician',
    'Urgent care center',
    'Dermatologist',
    'Pediatrician',
    'Podiatrist',
    'Psychologist',
    'Nursing home',
    'Hospice',
    'Pharmacy',
    'Acupuncture clinic',
    'Skin care clinic',
    'Laser hair removal service',
    'Weight loss service',
    'Audiologist',
    'MEDICAL SPA',
  ])('treats other healthcare categories like "%s" as healthcare', (category) => {
    expect(isHealthcareCategory(category)).toBe(true);
  });

  it.each([
    'Veterinarian',
    'Animal hospital',
    'Veterinary clinic',
    'Pet groomer',
    'Tree surgeon',
    'Medical malpractice attorney',
    'Medical lawyer',
    'Credit counseling service',
    'Health insurance agency',
  ])('leaves out look-alikes such as "%s"', (category) => {
    expect(isHealthcareCategory(category)).toBe(false);
  });

  it('is false with no category', () => {
    expect(isHealthcareCategory(null)).toBe(false);
    expect(isHealthcareCategory(undefined)).toBe(false);
    expect(isHealthcareCategory('')).toBe(false);
  });
});

// The unsafe drafts below are made up, but each one repeats a pattern the
// RankMaps generator produced on a dental profile in September 2026. The
// safe replies are in the style that profile's operator approved.
const OFFICE = '(555) 010-4477';

describe('checkHealthcareReply', () => {
  it.each([
    ['Thanks for the 5-star rating, Dana! We look forward to seeing you at your next visit!', 'Mentions a visit or appointment'],
    ['Dana, your trust in our care means the world to our team.', 'Implies the reviewer is a patient'],
    ['We are honored to have you as a patient.', 'Implies the reviewer is a patient'],
    ["We're glad the new crown is working well for you.", 'Mentions treatment or a clinical detail'],
    ['I sincerely apologize for the billing confusion and what your insurance covered.', 'Mentions a bill, insurance or payment'],
    ['We hope your son feels better soon and we will find a path forward with Medicaid.', 'Implies the reviewer is a patient'],
    ['This is not the level of care we strive for, and I take full responsibility.', 'Admits fault'],
    ['What you described represents failures that should never have happened.', 'Admits fault'],
    ['Thank you, Dana — it means a lot.', 'Uses an em or en dash'],
    ['Thank you, Dana – it means a lot.', 'Uses an em or en dash'],
    ['Thank you, Dana - it means a lot.', 'Uses an em or en dash'],
    ['Please review your records and call us.', 'Mentions a record or chart'],
    ["We're grateful for your trust in sending your family to our practice.", 'Implies the reviewer is a patient'],
    ['We look forward to continuing to serve you for years to come.', 'Implies the reviewer is a patient'],
  ])('flags "%s"', (reply, reason) => {
    const issues = checkHealthcareReply(reply, {
      reviewerName: 'Dana',
      officePhone: OFFICE,
    });
    expect(issues.map((i) => i.reason)).toContain(reason);
  });

  it.each([
    "Dana, we're sorry to read this. We'd like to talk with you directly. Please call the office at (555) 010-4477.",
    'Thanks for the five stars, Dana. We appreciate it.',
    'Dana, thank you for the kind words about Dr. Lee. We will make sure he sees this.',
    'Thank you, Dana. We work hard to keep the place clean and comfortable, so this is great to hear.',
    "Dana, thank you for taking the time to write this. If you're open to a conversation, please call the office at 555-010-4477.",
    'Thanks, Dana. We have put a lot into the equipment here, so that is good to hear.',
  ])('passes "%s"', (reply) => {
    expect(
      checkHealthcareReply(reply, { reviewerName: 'Dana', officePhone: OFFICE })
    ).toEqual([]);
  });

  it('allows the office number with a country code', () => {
    expect(
      checkHealthcareReply('Please call the office at +1 555 010 4477.', {
        officePhone: OFFICE,
      })
    ).toEqual([]);
  });

  it('flags any phone number that is not the office number', () => {
    const issues = checkHealthcareReply('Please call us at (555) 999-1234.', {
      officePhone: OFFICE,
    });
    expect(issues.map((i) => i.reason)).toEqual([
      "Contains a phone number that isn't the office's",
    ]);
  });

  it('flags a phone number when the office number is unknown', () => {
    const issues = checkHealthcareReply('Please call (555) 010-4477.', {});
    expect(issues).toHaveLength(1);
  });

  it("ignores words inside the reviewer's own name", () => {
    expect(
      checkHealthcareReply('Thank you, Bill Patient. We appreciate it.', {
        reviewerName: 'Bill Patient',
      })
    ).toEqual([]);
  });

  it('does not confuse "patience" with "patient"', () => {
    expect(checkHealthcareReply('Thank you for your patience, Dana.')).toEqual([]);
  });
});

describe('safeHealthcareReply', () => {
  it('passes the healthcare check at every rating, with and without a name, comment or phone', () => {
    for (const starRating of [1, 2, 3, 4, 5]) {
      for (const reviewerName of ['Dana Smith', null]) {
        for (const reviewComment of ['Great people', null]) {
          for (const businessPhone of [OFFICE, null]) {
            const reply = safeHealthcareReply({
              reviewerName,
              starRating,
              reviewComment,
              businessPhone,
            });
            expect(
              checkHealthcareReply(reply, {
                reviewerName,
                officePhone: businessPhone,
              })
            ).toEqual([]);
          }
        }
      }
    }
  });

  it('invites a call to the office number on a negative review', () => {
    expect(
      safeHealthcareReply({
        reviewerName: 'Dana',
        starRating: 1,
        reviewComment: 'Bad',
        businessPhone: OFFICE,
      })
    ).toBe(
      "Dana, we're sorry to read this. We'd like to talk with you directly, so please call the office at (555) 010-4477."
    );
  });

  it('thanks a rating-only five-star review in one line', () => {
    expect(
      safeHealthcareReply({
        reviewerName: 'Dana',
        starRating: 5,
        reviewComment: null,
      })
    ).toBe('Thanks for the five stars, Dana. We appreciate it.');
  });
});
