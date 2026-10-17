import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { listMemberships } from "@/lib/workspace/resolve";

const USER = "01900000-0000-7000-8000-0000000000aa";
const failingClient = (message: string) =>
  ({
    $transaction: () => Promise.reject(new Error(message)),
  }) as unknown as DbClient;

describe("listMemberships before the M4.1 migration", () => {
  it("treats a missing app.my_memberships() as no organisations", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      listMemberships(
        failingClient("function app.my_memberships() does not exist (42883)"),
        USER,
      ),
    ).resolves.toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("re-throws every other database error", async () => {
    await expect(
      listMemberships(failingClient("connection terminated"), USER),
    ).rejects.toThrow("connection terminated");
  });
});
