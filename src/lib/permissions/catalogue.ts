// Permission catalogue (interim spec IS-03). The database table `permission`
// mirrors this list; a test fails if they drift apart. Module permissions are
// added when each module is built.

export const PERMISSIONS = {
  "tenant.settings.manage": "Manage organisation settings and modules",
  "site.view": "View sites",
  "site.manage": "Create, edit and archive sites",
  "team.manage": "Create and edit teams and their members",
  "member.invite": "Invite people and manage memberships",
  "role.assign": "Assign and remove roles for members",
  "role.manage": "Create and edit roles",
  "employee.view": "View employee records",
  "employee.manage": "Create and edit employee records",
  // M7.1 onboarding.
  "onboarding.view": "View onboarding and its progress",
  "onboarding.manage": "Start onboarding and work through tasks",
  "onboarding.template.manage": "Create and edit onboarding templates",
  "onboarding.signoff":
    "Give final onboarding sign-off and waive required tasks",
  // M7.2 right to work (restricted, IS-03). Never given to site managers (D1).
  "rtw.view": "View right-to-work check records (every view is audited)",
  "rtw.record": "Record right-to-work checks, follow-ups and corrections",
  // M8.1 training.
  "training.view": "View training requirements, status and records",
  "training.record": "Record and correct training completions",
  "training.manage": "Manage training courses and requirement rules",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionCode[];

// Default roles copied into every new tenant. `worker` has no staff permissions;
// access to a worker's own records is granted by ownership checks, not roles.
export const SYSTEM_ROLES: readonly {
  key: string;
  name: string;
  permissions: readonly PermissionCode[];
}[] = [
  { key: "owner", name: "Tenant owner", permissions: ALL },
  { key: "admin", name: "Tenant administrator", permissions: ALL },
  {
    key: "hr_manager",
    name: "HR manager",
    permissions: [
      "site.view",
      "employee.view",
      "employee.manage",
      "onboarding.view",
      "onboarding.manage",
      "onboarding.template.manage",
      "onboarding.signoff",
      "rtw.view",
      "rtw.record",
      "training.view",
      "training.record",
      "training.manage",
    ],
  },
  { key: "recruiter", name: "Recruiter", permissions: ["site.view"] },
  {
    key: "site_manager",
    name: "Site manager",
    permissions: [
      "site.view",
      "team.manage",
      "employee.view",
      "onboarding.view",
      "onboarding.manage",
      "training.view",
      "training.record",
    ],
  },
  { key: "worker", name: "Worker", permissions: [] },
];
