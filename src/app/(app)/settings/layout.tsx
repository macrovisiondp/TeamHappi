import type { ReactNode } from "react";

import { SettingsTabs } from "@/features/setup/settings-tabs";

export const instant = false;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold text-ink-muted">Settings</p>
        <SettingsTabs />
      </div>
      {children}
    </div>
  );
}
