// Suggested UK hospitality onboarding templates (M7.1, decision D3).
// Added only when an authorised person asks; fully editable afterwards and
// labelled "suggested" in the app. These are prompts, not legal advice, and
// they deliberately contain no right-to-work step: that is recorded
// separately in M7.2 and never treated as an ordinary checklist item.

type Category = "task" | "document" | "induction" | "policy";
type Owner = "manager" | "hr" | "employee";

export interface SuggestedTask {
  title: string;
  guidance?: string;
  category: Category;
  owner: Owner;
  /** Days relative to the start date (negative = before). */
  due: number;
  required: boolean;
}

export interface SuggestedTemplate {
  name: string;
  description: string;
  tasks: readonly SuggestedTask[];
}

const common: readonly SuggestedTask[] = [
  {
    title: "Give the written statement of employment particulars",
    guidance:
      "Employees and workers are entitled to this from their first day. Check the current requirements with your adviser.",
    category: "document",
    owner: "hr",
    due: 0,
    required: true,
  },
  {
    title: "Contract signed and a copy given",
    category: "document",
    owner: "hr",
    due: 0,
    required: true,
  },
  {
    title: "Emergency contact recorded",
    category: "task",
    owner: "manager",
    due: 0,
    required: true,
  },
  {
    title: "Read the staff handbook and key policies",
    guidance:
      "The new starter reads it. Until they have a TeamHappi login, a manager records it on their behalf.",
    category: "policy",
    owner: "employee",
    due: 3,
    required: true,
  },
  {
    title: "Fire safety walk-round: exits, assembly point, alarms",
    category: "induction",
    owner: "manager",
    due: 0,
    required: true,
  },
  {
    title: "Health and safety induction",
    category: "induction",
    owner: "manager",
    due: 1,
    required: true,
  },
  {
    title: "Uniform and equipment issued",
    category: "task",
    owner: "manager",
    due: 0,
    required: false,
  },
  {
    title: "First-week check-in",
    category: "task",
    owner: "manager",
    due: 7,
    required: false,
  },
];

export const SUGGESTED_TEMPLATES: readonly SuggestedTemplate[] = [
  {
    name: "Kitchen team (suggested)",
    description:
      "Suggested starting point for chefs, cooks and kitchen porters. Edit it to match how your kitchen works.",
    tasks: [
      ...common,
      {
        title: "Food safety and hygiene training (for example Level 2)",
        guidance:
          "Record when it's completed. Certificates aren't uploaded yet.",
        category: "induction",
        owner: "manager",
        due: 14,
        required: true,
      },
      {
        title: "Allergen awareness briefing",
        category: "induction",
        owner: "manager",
        due: 1,
        required: true,
      },
      {
        title: "Knife, equipment and cleaning-chemical (COSHH) safety",
        category: "induction",
        owner: "manager",
        due: 1,
        required: true,
      },
    ],
  },
  {
    name: "Front of house (suggested)",
    description:
      "Suggested starting point for servers, hosts and runners. Edit it to match your service.",
    tasks: [
      ...common,
      {
        title: "Allergen awareness briefing",
        guidance:
          "How to answer allergen questions and where the allergen information is kept.",
        category: "induction",
        owner: "manager",
        due: 1,
        required: true,
      },
      {
        title: "Till, payments and service standards walkthrough",
        category: "induction",
        owner: "manager",
        due: 1,
        required: false,
      },
    ],
  },
  {
    name: "Bar team (suggested)",
    description:
      "Suggested starting point for bar staff in licensed premises. Edit it to match your licence conditions.",
    tasks: [
      ...common,
      {
        title:
          "Licensing briefing: Challenge 25, refusals log, licence conditions",
        category: "induction",
        owner: "manager",
        due: 0,
        required: true,
      },
      {
        title: "Allergen awareness briefing",
        category: "induction",
        owner: "manager",
        due: 1,
        required: true,
      },
      {
        title: "Cellar and gas-cylinder safety",
        category: "induction",
        owner: "manager",
        due: 7,
        required: false,
      },
    ],
  },
];
