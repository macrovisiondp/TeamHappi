import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";

import {
  SCRIPT_SYSTEM_ROLES,
  slugify,
} from "../../scripts/create-organisation.mjs";

describe("scripts/create-organisation.mjs", () => {
  it("creates exactly the system roles and permissions that createTenant() does", () => {
    expect(SCRIPT_SYSTEM_ROLES).toEqual(
      SYSTEM_ROLES.map((r) => ({ ...r, permissions: [...r.permissions] })),
    );
  });

  it("derives a valid slug from the organisation name", () => {
    expect(slugify("Joemis Kitchen")).toBe("joemis-kitchen");
    expect(slugify("Café & Bar Ltd.")).toBe("cafe-and-bar-ltd");
  });
});
