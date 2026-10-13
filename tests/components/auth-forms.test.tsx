import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SignInForm } from "@/components/auth/sign-in-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("SignInForm", () => {
  it("submits with POST, so credentials never land in the URL before hydration", () => {
    const { container } = render(<SignInForm />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelector('input[type="password"]')).not.toBeNull();
  });
});
