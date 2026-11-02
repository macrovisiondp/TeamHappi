"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintRotaButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer aria-hidden="true" />
      Print rota
    </Button>
  );
}
