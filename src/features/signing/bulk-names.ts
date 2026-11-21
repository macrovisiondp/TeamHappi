// Titles and types for documents uploaded several at once (M21).

export type Kind = "policy" | "contract_template";

/** "PO14_Tips_Gratuities_Policy (1).pdf" -> "PO14 Tips Gratuities Policy". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export const kindFromFileName = (name: string): Kind =>
  /contract/i.test(name) ? "contract_template" : "policy";
