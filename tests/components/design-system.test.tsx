import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DemoBadge, PageHeader } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { DEMO_EMPLOYEES, DEMO_SITES } from "@/features/demo/fixtures";
import { DEMO_STATUSES } from "@/features/people/directory";
import { PeopleDirectory } from "@/features/people/people-directory";

vi.mock("next/navigation", () => ({ usePathname: () => "/people/emp-001" }));

describe("Badge", () => {
  it.each(["neutral", "success", "warning", "danger", "info"] as const)(
    "%s status shows an icon and text, never colour alone",
    (tone) => {
      const { container } = render(<Badge tone={tone}>Label {tone}</Badge>);
      expect(screen.getByText(`Label ${tone}`)).toBeVisible();
      expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    },
  );
});

describe("Button", () => {
  it("explains why a disabled action is unavailable", () => {
    render(
      <Button disabled disabledReason="Available when the Rota module is live">
        Publish rota
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Publish rota" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Available when the Rota module is live",
    );
    expect(button).toHaveAccessibleDescription(
      "Available when the Rota module is live",
    );
  });
});

describe("Field", () => {
  it("labels its control and announces errors", () => {
    render(
      <Field
        id="email"
        label="Email address"
        error="Enter a valid email address"
      >
        <Input id="email" aria-invalid aria-describedby="email-error" />
      </Field>,
    );
    expect(screen.getByLabelText("Email address")).toHaveAccessibleDescription(
      "Enter a valid email address",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid email address",
    );
  });
});

describe("Demo labelling", () => {
  it("page header shows the demo marker when asked", () => {
    render(<PageHeader title="Dashboard" demo />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
    expect(screen.getByText("Demo data")).toBeVisible();
  });

  it("demo alert has a visible title", () => {
    render(<Alert tone="demo" title="You're looking at demo data" />);
    expect(screen.getByText("You're looking at demo data")).toBeVisible();
    render(<DemoBadge />);
  });
});

describe("Progress", () => {
  it("exposes its value to assistive technology and as text", () => {
    render(<Progress value={62.4} label="Onboarding progress" />);
    const bar = screen.getByRole("progressbar", {
      name: "Onboarding progress",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("62%")).toBeVisible();
  });
});

describe("PeopleDirectory", () => {
  it("filters as you type and announces the result count", async () => {
    const user = userEvent.setup();
    render(
      <PeopleDirectory
        employees={DEMO_EMPLOYEES}
        sites={DEMO_SITES}
        statuses={DEMO_STATUSES}
        hrefBase="/demo/people"
        caption="Staff directory (demo data)"
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      `Showing ${DEMO_EMPLOYEES.length} of ${DEMO_EMPLOYEES.length} people`,
    );

    await user.type(screen.getByLabelText("Search"), "barista");
    expect(status).toHaveTextContent(`of ${DEMO_EMPLOYEES.length} people`);
    const table = screen.getByRole("table", { name: /staff directory/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveTextContent(/barista/i);
  });

  it("shows a helpful empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <PeopleDirectory
        employees={DEMO_EMPLOYEES}
        sites={DEMO_SITES}
        statuses={DEMO_STATUSES}
        hrefBase="/demo/people"
        caption="Staff directory (demo data)"
      />,
    );
    await user.type(screen.getByLabelText("Search"), "no such person zzz");
    expect(
      screen.getByRole("heading", { name: "No one matches these filters" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 of");
  });

  it("filters by site with a labelled select", async () => {
    const user = userEvent.setup();
    render(
      <PeopleDirectory
        employees={DEMO_EMPLOYEES}
        sites={DEMO_SITES}
        statuses={DEMO_STATUSES}
        hrefBase="/demo/people"
        caption="Staff directory (demo data)"
      />,
    );
    await user.selectOptions(screen.getByLabelText("Site"), "site-mill");
    const expected = DEMO_EMPLOYEES.filter(
      (e) => e.siteId === "site-mill",
    ).length;
    expect(screen.getByRole("status")).toHaveTextContent(
      `Showing ${expected} of`,
    );
  });
});
