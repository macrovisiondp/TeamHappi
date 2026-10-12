// SYNTHETIC DEMO DATA — NOT REAL PEOPLE OR OPERATIONS.
//
// Used only by screens whose backend modules are not built yet. Every screen that
// renders this data shows a "Demo data" marker. Names are invented, contact details
// use reserved example domains / Ofcom drama numbers, and no record is ever written
// to the database. Replace with real, tenant-scoped queries as modules ship.

export const DEMO_REFERENCE_DATE = "2026-10-12T08:00:00Z";

export interface DemoSite {
  id: string;
  name: string;
  area: string;
  teams: string[];
}

export type EmploymentStatus = "active" | "onboarding" | "on_leave" | "left";
export type RtwStatus = "verified" | "expiring" | "action_needed";
export type TrainingStatus = "complete" | "due_soon" | "overdue";

export interface DemoEmployee {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  preferredName?: string;
  role: string;
  siteId: string;
  team: string;
  status: EmploymentStatus;
  startDate: string;
  email: string;
  phone: string;
  contract: "Full time" | "Part time" | "Zero hours";
  rightToWork: RtwStatus;
  rtwExpiresOn?: string;
  onboardingProgress?: number; // 0–100 while onboarding
  training: { name: string; status: TrainingStatus; expiresOn?: string }[];
  documents: {
    name: string;
    type: string;
    addedOn: string;
    expiresOn?: string;
  }[];
}

export const DEMO_ORGANISATION = { name: "Harbour & Hearth Group (demo)" };

export const DEMO_SITES: DemoSite[] = [
  {
    id: "site-quay",
    name: "The Quayside Kitchen",
    area: "Bristol",
    teams: ["Kitchen", "Front of house", "Bar"],
  },
  {
    id: "site-mill",
    name: "Millstone Brasserie",
    area: "Bath",
    teams: ["Kitchen", "Front of house"],
  },
  {
    id: "site-lane",
    name: "Lantern Lane Café",
    area: "Cheltenham",
    teams: ["Café floor", "Kitchen"],
  },
];

const T = (name: string, status: TrainingStatus, expiresOn?: string) => ({
  name,
  status,
  expiresOn,
});
const STD_TRAINING = (allergen: TrainingStatus, food: TrainingStatus) => [
  T("Food hygiene level 2", food, "2027-03-14"),
  T(
    "Allergen awareness",
    allergen,
    allergen === "complete" ? "2027-01-20" : "2026-10-28",
  ),
  T("Fire safety", "complete", "2027-06-01"),
];

let n = 0;
const emp = (
  givenName: string,
  familyName: string,
  role: string,
  siteId: string,
  team: string,
  status: EmploymentStatus,
  startDate: string,
  extra: Partial<DemoEmployee> = {},
): DemoEmployee => {
  n += 1;
  const id = `emp-${String(n).padStart(3, "0")}`;
  return {
    id,
    employeeNumber: `HH-${1000 + n}`,
    givenName,
    familyName,
    role,
    siteId,
    team,
    status,
    startDate,
    email:
      `${givenName}.${familyName}`.toLowerCase().replace(/[^a-z.]/g, "") +
      "@example.test",
    phone: `07700 900${String(100 + n).slice(-3)}`,
    contract: "Full time",
    rightToWork: "verified",
    training: STD_TRAINING("complete", "complete"),
    documents: [
      { name: "Contract of employment", type: "Contract", addedOn: startDate },
      {
        name: "Right-to-work evidence",
        type: "Right to work",
        addedOn: startDate,
      },
    ],
    ...extra,
  };
};

export const DEMO_EMPLOYEES: DemoEmployee[] = [
  emp(
    "Amara",
    "Okafor",
    "Head chef",
    "site-quay",
    "Kitchen",
    "active",
    "2023-04-03",
  ),
  emp(
    "Tomasz",
    "Nowak",
    "Sous chef",
    "site-quay",
    "Kitchen",
    "active",
    "2024-01-15",
    {
      training: STD_TRAINING("due_soon", "complete"),
    },
  ),
  emp(
    "Priya",
    "Shah",
    "Restaurant manager",
    "site-quay",
    "Front of house",
    "active",
    "2022-09-12",
  ),
  emp(
    "Callum",
    "Reid",
    "Bar supervisor",
    "site-quay",
    "Bar",
    "active",
    "2024-06-01",
    {
      contract: "Part time",
    },
  ),
  emp(
    "Sofia",
    "Marques",
    "Chef de partie",
    "site-quay",
    "Kitchen",
    "on_leave",
    "2023-11-20",
  ),
  emp(
    "Kwame",
    "Mensah",
    "Kitchen porter",
    "site-quay",
    "Kitchen",
    "onboarding",
    "2026-10-19",
    {
      contract: "Zero hours",
      onboardingProgress: 60,
      rightToWork: "action_needed",
      training: STD_TRAINING("overdue", "overdue"),
      documents: [
        {
          name: "Contract of employment",
          type: "Contract",
          addedOn: "2026-10-06",
        },
      ],
    },
  ),
  emp(
    "Ellie",
    "Hughes",
    "Waiting staff",
    "site-quay",
    "Front of house",
    "active",
    "2025-03-08",
    {
      contract: "Part time",
    },
  ),
  emp("Jun", "Park", "Bartender", "site-quay", "Bar", "active", "2025-07-14", {
    contract: "Zero hours",
    rightToWork: "expiring",
    rtwExpiresOn: "2026-11-30",
  }),
  emp(
    "Hannah",
    "Clarke",
    "General manager",
    "site-mill",
    "Front of house",
    "active",
    "2021-05-17",
  ),
  emp(
    "Mohammed",
    "Iqbal",
    "Head chef",
    "site-mill",
    "Kitchen",
    "active",
    "2022-02-07",
    {
      training: STD_TRAINING("complete", "due_soon"),
    },
  ),
  emp(
    "Grace",
    "Adeyemi",
    "Chef de partie",
    "site-mill",
    "Kitchen",
    "active",
    "2024-08-19",
  ),
  emp(
    "Luca",
    "Bianchi",
    "Commis chef",
    "site-mill",
    "Kitchen",
    "onboarding",
    "2026-10-13",
    {
      onboardingProgress: 85,
      training: STD_TRAINING("due_soon", "complete"),
    },
  ),
  emp(
    "Niamh",
    "O'Brien",
    "Assistant manager",
    "site-mill",
    "Front of house",
    "active",
    "2023-10-02",
  ),
  emp(
    "Oliver",
    "Bennett",
    "Waiting staff",
    "site-mill",
    "Front of house",
    "active",
    "2025-05-26",
    {
      contract: "Part time",
    },
  ),
  emp(
    "Zainab",
    "Hussain",
    "Waiting staff",
    "site-mill",
    "Front of house",
    "active",
    "2025-09-01",
    {
      contract: "Zero hours",
      rightToWork: "expiring",
      rtwExpiresOn: "2026-12-15",
    },
  ),
  emp(
    "Rhys",
    "Morgan",
    "Kitchen porter",
    "site-mill",
    "Kitchen",
    "left",
    "2024-02-12",
  ),
  emp(
    "Chloe",
    "Evans",
    "Café manager",
    "site-lane",
    "Café floor",
    "active",
    "2022-11-14",
  ),
  emp(
    "Daniel",
    "Kim",
    "Barista",
    "site-lane",
    "Café floor",
    "active",
    "2024-04-22",
    {
      contract: "Part time",
    },
  ),
  emp(
    "Aisha",
    "Rahman",
    "Barista",
    "site-lane",
    "Café floor",
    "active",
    "2025-01-06",
    {
      training: STD_TRAINING("overdue", "complete"),
    },
  ),
  emp(
    "Ben",
    "Fletcher",
    "Cook",
    "site-lane",
    "Kitchen",
    "active",
    "2023-07-31",
  ),
  emp(
    "Maya",
    "Patel",
    "Café assistant",
    "site-lane",
    "Café floor",
    "onboarding",
    "2026-10-20",
    {
      contract: "Zero hours",
      onboardingProgress: 30,
      training: STD_TRAINING("overdue", "overdue"),
    },
  ),
  emp(
    "Joseph",
    "Walsh",
    "Cook",
    "site-lane",
    "Kitchen",
    "on_leave",
    "2024-09-09",
  ),
  emp(
    "Isla",
    "Fraser",
    "Café assistant",
    "site-lane",
    "Café floor",
    "active",
    "2025-06-16",
    {
      contract: "Part time",
    },
  ),
  emp(
    "Samuel",
    "Osei",
    "Kitchen porter",
    "site-quay",
    "Kitchen",
    "active",
    "2025-08-04",
    {
      contract: "Zero hours",
    },
  ),
];

export interface DemoShiftSummary {
  siteId: string;
  scheduled: number;
  clockedIn: number;
  openShifts: number;
}

export const DEMO_TODAY: DemoShiftSummary[] = [
  { siteId: "site-quay", scheduled: 14, clockedIn: 9, openShifts: 2 },
  { siteId: "site-mill", scheduled: 11, clockedIn: 7, openShifts: 1 },
  { siteId: "site-lane", scheduled: 6, clockedIn: 4, openShifts: 0 },
];

export interface DemoActivity {
  at: string;
  text: string;
}

export const DEMO_ACTIVITY: DemoActivity[] = [
  {
    at: "2026-10-12T07:52:00Z",
    text: "Rota for week commencing 19 Oct published at The Quayside Kitchen",
  },
  {
    at: "2026-10-12T07:31:00Z",
    text: "Luca Bianchi completed the allergen awareness module",
  },
  {
    at: "2026-10-11T16:05:00Z",
    text: "Offer accepted for Kitchen porter at Millstone Brasserie",
  },
  {
    at: "2026-10-11T12:40:00Z",
    text: "Right-to-work check recorded for Maya Patel",
  },
];

export const DEMO_NOTIFICATIONS = [
  {
    id: "n1",
    text: "2 open shifts at The Quayside Kitchen tonight",
    at: "2026-10-12T07:45:00Z",
  },
  {
    id: "n2",
    text: "Jun Park's right-to-work evidence expires on 30 Nov 2026",
    at: "2026-10-11T09:00:00Z",
  },
  {
    id: "n3",
    text: "Kwame Mensah's onboarding needs a right-to-work check",
    at: "2026-10-10T14:20:00Z",
  },
];

export function demoSite(id: string): DemoSite | undefined {
  return DEMO_SITES.find((s) => s.id === id);
}

export function demoEmployee(id: string): DemoEmployee | undefined {
  return DEMO_EMPLOYEES.find((e) => e.id === id);
}
