-- M19: contract templates (docs/architecture/m19-first-steps.md; requested by
-- the product owner on 21 November 2026).
--
-- Widens one CHECK, so the document library can hold a contract TEMPLATE (one
-- file for everyone with a job title, like a policy) as well as policies.
-- Starter packs can include it, and it is sent at hire as a contract that a
-- manager countersigns. Every existing row already satisfies the new rule; no
-- rows change.
--
-- Rollback (only while no contract templates exist):
--   ALTER TABLE sign_document DROP CONSTRAINT sign_document_kind;
--   ALTER TABLE sign_document ADD CONSTRAINT sign_document_kind CHECK (
--     ("kind" = 'policy' AND "employee_id" IS NULL)
--     OR ("kind" = 'contract' AND "employee_id" IS NOT NULL));

ALTER TABLE "sign_document" DROP CONSTRAINT "sign_document_kind";
ALTER TABLE "sign_document" ADD CONSTRAINT "sign_document_kind" CHECK (
  ("kind" IN ('policy', 'contract_template') AND "employee_id" IS NULL)
  OR ("kind" = 'contract' AND "employee_id" IS NOT NULL));
