// M21: titles and types worked out from document file names.

import { describe, expect, it } from "vitest";

import {
  kindFromFileName,
  titleFromFileName,
} from "@/features/signing/bulk-names";

describe("bulk upload names", () => {
  it("makes a readable title from a file name", () => {
    expect(
      titleFromFileName("PO14_Tips_Gratuities_and_Service_Charge_Policy.pdf"),
    ).toBe("PO14 Tips Gratuities and Service Charge Policy");
    expect(
      titleFromFileName("HotRock_Hove_Zero_Hours_Contract_FOH (1).PDF"),
    ).toBe("HotRock Hove Zero Hours Contract FOH");
  });

  it("treats files named as contracts as contract templates", () => {
    expect(
      kindFromFileName("HotRock_Hove_Zero_Hours_Contract_Kitchen.pdf"),
    ).toBe("contract_template");
    expect(kindFromFileName("PO02_Staff_Privacy_Notice.pdf")).toBe("policy");
  });
});
