-- ============================================================================
-- 20260928_ccms_execution_repository.sql
-- Commercial CMS, part 2: client contracts compared with our tender (CMS-02),
-- execution after approval (signing, stamping, bonds / insurance / CIDB —
-- CMS-01 steps 13–16), and the repository with expiry alerts (CMS-03).
-- Idempotent: safe to re-run.
-- ============================================================================

-- Contract: execution, securities, repository record, client confirmation.
alter table ccms_contracts add column if not exists signed_date date;
alter table ccms_contracts add column if not exists signatories jsonb not null default '[]'::jsonb;  -- [{name, designation, party}]
alter table ccms_contracts add column if not exists stamping jsonb;                                   -- {sent_date, stamped_date, duty, certificate_no}
alter table ccms_contracts add column if not exists securities jsonb not null default '[]'::jsonb;   -- [{type, required, amount, reference, valid_until}]
alter table ccms_contracts add column if not exists repository jsonb;                                 -- confirmed key terms
alter table ccms_contracts add column if not exists expiry_date date;
alter table ccms_contracts add column if not exists confirmation jsonb;                               -- client letter: {sent_date, sent_to, reply_date, reply_note}

-- Statuses after approval: signed → stamped → active.
alter table ccms_contracts drop constraint if exists ccms_contracts_status_check;
alter table ccms_contracts add constraint ccms_contracts_status_check check (status in (
  'submitted','in_review','pending_committee','pending_approval','approved',
  'returned','rejected','signing','signed','stamping','stamped','active','closed'
));

-- Documents: our tender submission (the client-side baseline), and the tender comparison.
alter table ccms_documents drop constraint if exists ccms_documents_doc_role_check;
alter table ccms_documents add constraint ccms_documents_doc_role_check check (doc_role in (
  'draft','counterparty','supporting','executed','tender'
));
alter table ccms_documents add column if not exists comparison jsonb;  -- {items: [{area, status, tender, award, excerpt, decision, ...}]}

-- Comments: severity kept as data, so the body can stay short.
alter table ccms_comments add column if not exists severity text;

create index if not exists idx_ccms_contracts_expiry on ccms_contracts(tenant_id, expiry_date);

notify pgrst, 'reload schema';
