-- M15 step 1: interactive courses (docs/architecture/m15-training-courses.md, T1;
-- approved by the product owner on 20 November 2026).
--
-- Additive. Two new enum values only; no rows change. They're in their own
-- migration because PostgreSQL can't use a new enum value in the transaction
-- that adds it; 20261116130000_course_packages uses them.
--
-- Rollback: enum values can't be dropped in place. While no course or record
-- uses them, recreate the types without them (a separately approved run).

ALTER TYPE "training_completion_method" ADD VALUE IF NOT EXISTS 'interactive';
ALTER TYPE "training_record_method" ADD VALUE IF NOT EXISTS 'assessment';
