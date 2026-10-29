import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { grantsFrom } from "@/lib/workspace/policy";
import {
  SUGGESTED_COURSES,
  addMonths,
  currentRecord,
  personUpToDate,
  referralUrl,
  requirementsFor,
  ruleApplies,
  ruleDueOn,
  statusOf,
  type Person,
  type RecordFacts,
  type Rule,
} from "@/modules/training";

const T = "2026-10-20";
const person = (over: Partial<Person> = {}): Person => ({
  id: "p1",
  primarySiteId: "s1",
  jobTitle: "Bartender",
  startDate: "2026-11-01",
  status: "pending",
  ...over,
});
let n = 0;
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: `r${++n}`,
  courseId: "c1",
  scope: "organisation",
  siteId: null,
  jobTitle: null,
  employeeId: null,
  mandatory: true,
  dueDays: 14,
  effectiveFrom: "2026-10-01",
  ...over,
});
const rec = (over: Partial<RecordFacts> = {}): RecordFacts => ({
  id: `x${++n}`,
  courseId: "c1",
  completedOn: "2026-01-10",
  expiresOn: null,
  recordedAt: new Date("2026-01-10T12:00:00Z"),
  voided: false,
  ...over,
});
const ACTIVE = new Set(["c1", "c2"]);

describe("which rules apply (D1: organisation, site, job title, named person)", () => {
  it("matches each kind of target, never by access role", () => {
    const p = person();
    expect(ruleApplies(rule(), p)).toBe(true);
    expect(ruleApplies(rule({ scope: "site", siteId: "s1" }), p)).toBe(true);
    expect(ruleApplies(rule({ scope: "site", siteId: "s2" }), p)).toBe(false);
    expect(
      ruleApplies(rule({ scope: "job_title", jobTitle: "  bartender " }), p),
    ).toBe(true);
    expect(ruleApplies(rule({ scope: "job_title", jobTitle: "Chef" }), p)).toBe(
      false,
    );
    expect(ruleApplies(rule({ scope: "employee", employeeId: "p1" }), p)).toBe(
      true,
    );
    expect(ruleApplies(rule({ scope: "employee", employeeId: "p2" }), p)).toBe(
      false,
    );
    // No job title or site: only organisation and named rules can apply.
    const bare = person({ jobTitle: null, primarySiteId: null });
    expect(ruleApplies(rule({ scope: "job_title", jobTitle: "x" }), bare)).toBe(
      false,
    );
    expect(ruleApplies(rule({ scope: "site", siteId: "s1" }), bare)).toBe(
      false,
    );
  });

  it("people who have left need nothing (records kept elsewhere)", () => {
    expect(ruleApplies(rule(), person({ status: "left" }))).toBe(false);
  });

  it("recalculates from the person as they are now: site moves and job-title changes", () => {
    const rules = [
      rule({ scope: "site", siteId: "s1", courseId: "c1" }),
      rule({ scope: "job_title", jobTitle: "Chef", courseId: "c2" }),
    ];
    expect(
      requirementsFor(person(), rules, ACTIVE).map((r) => r.courseId),
    ).toEqual(["c1"]);
    expect(
      requirementsFor(
        person({ primarySiteId: "s2", jobTitle: "Chef" }),
        rules,
        ACTIVE,
      ).map((r) => r.courseId),
    ).toEqual(["c2"]);
  });
});

describe("due dates and overlapping rules (D2)", () => {
  it("is due N days after the later of the start date and the rule's date", () => {
    // New starter after the rule: from their start date.
    expect(ruleDueOn(rule(), person())).toBe("2026-11-15");
    // Existing staff: from when the rule took effect, so not instantly overdue.
    expect(ruleDueOn(rule(), person({ startDate: "2020-05-01" }))).toBe(
      "2026-10-15",
    );
    // No start date recorded: from the rule.
    expect(ruleDueOn(rule(), person({ startDate: null }))).toBe("2026-10-15");
  });

  it("several rules for one course make one requirement: mandatory if any is, due on the earliest", () => {
    const reqs = requirementsFor(
      person(),
      [
        rule({ mandatory: false, dueDays: 0 }), // recommended, earliest
        rule({ scope: "site", siteId: "s1", dueDays: 30 }),
        rule({ scope: "job_title", jobTitle: "Bartender", dueDays: 7 }),
      ],
      ACTIVE,
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      courseId: "c1",
      mandatory: true,
      dueOn: "2026-11-08", // earliest MANDATORY rule; the recommended one doesn't set it
    });
    expect(reqs[0]!.ruleIds).toHaveLength(3);
  });

  it("only recommended rules: recommended, earliest of them", () => {
    const [r] = requirementsFor(
      person(),
      [
        rule({ mandatory: false, dueDays: 20 }),
        rule({ mandatory: false, scope: "site", siteId: "s1", dueDays: 5 }),
      ],
      ACTIVE,
    );
    expect(r).toMatchObject({ mandatory: false, dueOn: "2026-11-06" });
  });

  it("rules for archived courses don't apply", () => {
    expect(
      requirementsFor(person(), [rule({ courseId: "gone" })], ACTIVE),
    ).toEqual([]);
  });
});

describe("status (D6)", () => {
  const req = {
    courseId: "c1",
    mandatory: true,
    dueOn: "2026-10-25",
    ruleIds: [],
  };

  it("due, due today, then overdue", () => {
    expect(statusOf(req, [], 60, T).status).toBe("due");
    expect(statusOf(req, [], 60, "2026-10-25").status).toBe("due");
    expect(statusOf(req, [], 60, "2026-10-26").status).toBe("overdue");
  });

  it("up to date, expiring within the course's warning window, expiry day still valid, then expired", () => {
    const valid = rec({ expiresOn: "2027-06-01" });
    expect(statusOf(req, [valid], 60, T).status).toBe("up_to_date");
    expect(
      statusOf(req, [rec({ expiresOn: "2026-12-19" })], 60, T).status,
    ).toBe("expiring"); // exactly 60 days
    expect(
      statusOf(req, [rec({ expiresOn: "2026-12-20" })], 60, T).status,
    ).toBe("up_to_date");
    expect(
      statusOf(req, [rec({ expiresOn: "2026-12-20" })], 90, T).status,
    ).toBe("expiring"); // per-course window
    expect(statusOf(req, [rec({ expiresOn: T })], 0, T).status).toBe(
      "expiring",
    );
    expect(
      statusOf(req, [rec({ expiresOn: "2026-10-19" })], 60, T).status,
    ).toBe("expired");
  });

  it("an expired record never counts because it was once completed; a renewal does", () => {
    const old = rec({ completedOn: "2023-01-01", expiresOn: "2026-01-01" });
    expect(statusOf(req, [old], 60, T).status).toBe("expired");
    const renewed = rec({ completedOn: "2026-09-01", expiresOn: "2029-09-01" });
    expect(statusOf(req, [old, renewed], 60, T).status).toBe("up_to_date");
  });

  it("voided records don't count, and the latest completion wins", () => {
    const voided = rec({ completedOn: "2026-10-01", voided: true });
    expect(statusOf(req, [voided], 60, T).status).toBe("due");
    const a = rec({ completedOn: "2026-01-01", expiresOn: "2026-02-01" });
    const b = rec({ completedOn: "2026-05-01", expiresOn: null });
    expect(currentRecord([a, b])).toBe(b);
  });

  it("not required: a record but no rule", () => {
    expect(statusOf(null, [rec()], 60, T)).toMatchObject({
      status: "not_required",
      mandatory: false,
    });
  });

  it("up to date means no MANDATORY training overdue or expired", () => {
    const s = (status: string, mandatory: boolean) =>
      ({ status, mandatory }) as Parameters<typeof personUpToDate>[0][number];
    expect(personUpToDate([s("due", true), s("expiring", true)])).toBe(true);
    expect(personUpToDate([s("overdue", false)])).toBe(true);
    expect(personUpToDate([s("expired", true)])).toBe(false);
    expect(personUpToDate([s("overdue", true)])).toBe(false);
  });
});

describe("expiry from a renewal period", () => {
  it("adds calendar months, clamping to the month's end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-20", 36)).toBe("2029-10-20");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("suggested courses", () => {
  it("are labelled suggested, never claim to be legally required, and read-and-confirm ones have content", () => {
    for (const c of SUGGESTED_COURSES) {
      expect(c.name, c.name).toMatch(/\(suggested\)$/);
      expect(`${c.name} ${c.description}`, c.name).not.toMatch(
        /\b(legal(ly)? (required|requirement)|mandatory by law|you must)\b/i,
      );
      if (c.completionMethod === "read_and_confirm")
        expect(c.content, c.name).toBeTruthy();
      expect(c.kind === "external", c.name).toBe(
        c.completionMethod === "external_certificate",
      );
    }
  });
});

describe("permissions on built-in roles", () => {
  const grants = (key: string, site: string | null = null) =>
    grantsFrom([
      {
        siteId: site,
        permissions: SYSTEM_ROLES.find((r) => r.key === key)!.permissions,
      },
    ]);
  it("owners, admins and HR do everything; site managers view and record at their sites; nobody else", () => {
    for (const key of ["owner", "admin", "hr_manager"])
      for (const code of [
        "training.view",
        "training.record",
        "training.manage",
      ] as const)
        expect(grants(key).get(code), `${key} ${code}`).toBe("all");
    const sm = grants("site_manager", "s1");
    expect(sm.has("training.view")).toBe(true);
    expect(sm.has("training.record")).toBe(true);
    expect(sm.has("training.manage")).toBe(false);
    for (const key of ["recruiter", "worker"])
      expect(grants(key).has("training.view"), key).toBe(false);
  });
});

describe("referral links (future partners): safe and free of personal data", () => {
  it("accepts an https partner URL and adds only the approved referral id", () => {
    expect(
      referralUrl(
        "https://courses.example.co.uk/food-l2?utm_source=th",
        "TH-123",
      ),
    ).toBe("https://courses.example.co.uk/food-l2?utm_source=th&ref=TH-123");
  });

  it("refuses unsafe or identifying links", () => {
    for (const [base, id] of [
      ["http://courses.example.co.uk/x", "TH1"], // not https
      ["javascript:alert(1)", "TH1"],
      ["https://user:pw@courses.example.co.uk/", "TH1"], // credentials
      ["https://localhost/x", "TH1"],
      ["https://127.0.0.1/x", "TH1"],
      ["https://intranet/x", "TH1"], // no public host name
      ["https://courses.example.co.uk/x?email=a@b.c", "TH1"], // personal data
      ["https://courses.example.co.uk/x?employee_id=1", "TH1"],
      ["https://courses.example.co.uk/x?tenant=1", "TH1"],
      ["https://courses.example.co.uk/x", "a b"], // bad referral id
      ["https://courses.example.co.uk/x", "x".repeat(65)],
      ["not a url", "TH1"],
    ] as const)
      expect(referralUrl(base, id), `${base} ${id}`).toBeNull();
  });
});
