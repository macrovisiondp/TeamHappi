import type { Metadata } from "next";

import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    <Card className="gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
        <p className="text-sm text-muted-foreground">
          Open the link we sent to your email address. Links expire after one
          hour. Need a new one? Enter your email address below.
        </p>
      </div>
      <ResendVerificationForm />
    </Card>
  );
}
