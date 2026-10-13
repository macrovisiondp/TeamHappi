import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NAV_ITEMS } from "@/components/layout/nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/people/emp-001" }));

describe("SidebarNav", () => {
  it("lists every module in a labelled navigation landmark", () => {
    render(<SidebarNav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeVisible();
    for (const item of NAV_ITEMS) {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${item.label}`) }),
      ).toHaveAttribute("href", item.href);
    }
  });

  it("marks the current section (including nested pages) with aria-current", () => {
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: /^People/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: /^Dashboard/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("labels modules that are not built yet as planned, in text", () => {
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: /^Rota.*Planned/ })).toBeVisible();
  });
});
