// Suggested UK hospitality courses (M8.1), added on request and fully
// editable. They're examples, NOT legal requirements: nothing here says a
// course is mandatory (that's the business's own rule), and renewal periods
// are common practice to confirm with the business's adviser or provider.
// No requirement rules are created with them.

import type { Category } from "./policy";

export interface SuggestedCourse {
  name: string;
  description: string;
  category: Category;
  kind: "internal" | "external";
  completionMethod: "read_and_confirm" | "in_person" | "external_certificate";
  certificateExpected: boolean;
  validityMonths: number | null;
  content?: string;
}

const REPLACE =
  "Suggested outline: replace it with your own policy or briefing before anyone is asked to confirm it.";

export const SUGGESTED_COURSES: readonly SuggestedCourse[] = [
  {
    name: "Food safety and hygiene (Level 2) (suggested)",
    description:
      "For people who handle food. Usually taken with an external provider. Check the refresher period with your provider.",
    category: "food_safety",
    kind: "external",
    completionMethod: "external_certificate",
    certificateExpected: true,
    validityMonths: 36,
  },
  {
    name: "Allergen awareness (suggested)",
    description:
      "Understanding the 14 major allergens and how your business handles allergen information.",
    category: "allergens",
    kind: "external",
    completionMethod: "external_certificate",
    certificateExpected: true,
    validityMonths: 36,
  },
  {
    name: "Fire safety awareness (suggested)",
    description:
      "Your site's fire procedures, exits, alarms and assembly point. Usually given in person.",
    category: "fire_safety",
    kind: "internal",
    completionMethod: "in_person",
    certificateExpected: false,
    validityMonths: 12,
  },
  {
    name: "Health and safety induction (suggested)",
    description: "Your site's health and safety arrangements, given in person.",
    category: "health_safety",
    kind: "internal",
    completionMethod: "in_person",
    certificateExpected: false,
    validityMonths: null,
  },
  {
    name: "Manual handling (suggested)",
    description: "Safe lifting and carrying, given in person or by a provider.",
    category: "manual_handling",
    kind: "internal",
    completionMethod: "in_person",
    certificateExpected: false,
    validityMonths: 36,
  },
  {
    name: "First aid awareness (suggested)",
    description:
      "Awareness training from an external provider. Appointed first aiders may need a fuller course.",
    category: "first_aid",
    kind: "external",
    completionMethod: "external_certificate",
    certificateExpected: true,
    validityMonths: 36,
  },
  {
    name: "Personal licence holder qualification (suggested)",
    description:
      "For people applying for a personal licence to sell alcohol. Taken with an accredited provider.",
    category: "licensing",
    kind: "external",
    completionMethod: "external_certificate",
    certificateExpected: true,
    validityMonths: null,
  },
  {
    name: "Age verification and Challenge 25 (suggested)",
    description:
      "How your business checks age when selling alcohol and other age-restricted products.",
    category: "licensing",
    kind: "internal",
    completionMethod: "read_and_confirm",
    certificateExpected: false,
    validityMonths: 12,
    content: `${REPLACE}

- When we ask for ID, and which ID we accept.
- What to do if someone can't show acceptable ID.
- How to record a refusal, and who to tell.`,
  },
  {
    name: "Safeguarding awareness (suggested)",
    description:
      "Recognising vulnerability and knowing who to tell. Your own policy, read and confirmed.",
    category: "safeguarding",
    kind: "internal",
    completionMethod: "read_and_confirm",
    certificateExpected: false,
    validityMonths: 12,
    content: `${REPLACE}

- Signs that a customer or colleague may be vulnerable.
- Who to tell, and how, on every shift.
- What not to do.`,
  },
];
