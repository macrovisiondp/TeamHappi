import type { ServiceCategory } from "@/integrations/core/types";

// Display labels for the Platform Admin console. Since M5.3 integration state
// comes from the platform database; no synthetic provider data remains here.

export const PLATFORM_ORGANISATION = "Macrovision platform";

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  email: "Email",
  storage: "File and document storage",
  payments: "Payments",
  ai: "AI",
};

export const CATEGORY_DESCRIPTION: Record<ServiceCategory, string> = {
  email:
    "Verification, invitation and notification email. The development mailer only prints to the server console.",
  storage:
    "Private, tenant-isolated storage for documents and media. Each file remembers which provider holds it.",
  payments:
    "TeamHappi's own subscription billing through provider-hosted checkout. Not payroll.",
  ai: "Optional drafting and summarising help. A person always reviews the output. Switched off by default.",
};
