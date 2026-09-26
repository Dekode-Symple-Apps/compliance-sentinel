-- ============================================================================
-- 20260926_commercial_cms.sql
-- Commercial CMS — vendor and client contracts: request, review and flag,
-- comment threads tracked to closure, reviewer outcomes and approval routing.
-- Separate from Legal CMS by design (different lifecycle, different data).
--
-- Idempotent: safe to re-run. Source of truth for the column contract that
-- src/lib/ccms.functions.ts reads and writes — keep them in sync.
--
-- Tenant scoping follows the Legal CMS pattern: tenant_id on the two root
-- tables (stamped on insert by public.stamp_tenant_id), child rows scoped
-- through contract_id and checked in the server functions. RLS admits any
-- approved user (public.is_approved), as for the rest of the app.
-- ============================================================================

create sequence if not exists ccms_contract_seq start 1;

-- ---- vendors (interim master list until Vendor Management is built) --------
create table if not exists ccms_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  name text not null,
  registration_no text,
  category text,                      -- supplier_material | supplier_pme | services | subcontractor | consultant | agent | it_service
  status text not null default 'approved' check (status in ('approved','pending','on_hold','blacklisted')),
  dd_valid_until date,                -- due diligence (CTOS / integrity) validity
  risk_rating text default 'low' check (risk_rating in ('low','medium','high')),
  related_party boolean not null default false,
  related_party_note text,
  cidb_grade text,
  contact_name text,
  contact_email text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- contracts --------------------------------------------------------------
create table if not exists ccms_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  reference_number text unique,
  side text not null default 'vendor' check (side in ('vendor','client')),
  contract_type text not null,
  title text not null,
  entity text,
  vendor_id uuid references ccms_vendors(id) on delete set null,
  counterparty_name text,
  project text,
  job_number text,
  award_reference text,
  value numeric,
  currency text default 'MYR',
  value_myr numeric,
  start_date date,
  end_date date,
  scope_summary text,
  personal_data_cross_border boolean not null default false,
  template_id text,
  status text not null default 'submitted' check (status in (
    'submitted','in_review','pending_committee','pending_approval','approved',
    'returned','rejected','signing','stamping','active','closed'
  )),
  flags jsonb not null default '[]'::jsonb,       -- [{key, source, detail, at}]
  approval_route jsonb not null default '[]'::jsonb, -- [{key, label, approver, sla_days, status, decided_*}]
  current_stage int not null default 0,
  stage_started_at timestamptz,
  requestor_id uuid,
  requestor_name text,
  requestor_email text,
  requestor_department text,
  cost_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.ccms_set_reference()
returns trigger language plpgsql as $$
begin
  if new.reference_number is null then
    new.reference_number := 'CC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ccms_contract_seq')::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_ccms_reference on ccms_contracts;
create trigger trg_ccms_reference before insert on ccms_contracts
  for each row execute function public.ccms_set_reference();

-- ---- audit trail ------------------------------------------------------------
create table if not exists ccms_contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references ccms_contracts(id) on delete cascade,
  event_type text not null,
  detail text,
  meta jsonb,
  actor_id uuid,
  actor_name text,
  acting_role text,
  created_at timestamptz not null default now()
);

-- ---- documents --------------------------------------------------------------
create table if not exists ccms_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references ccms_contracts(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  mime_type text,
  size_bytes bigint,
  doc_role text not null default 'draft' check (doc_role in ('draft','counterparty','supporting','executed')),
  version int not null default 1,
  ai_review jsonb,                   -- {verdict, riskScore, summary, findings[], documentText}
  ai_review_status text default 'pending' check (ai_review_status in ('pending','running','done','failed')),
  deviation jsonb,                   -- {templateId, clauses[], added[], summary}
  loa_check jsonb,                   -- {items[]}
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

-- ---- comment threads (tracked to closure) -----------------------------------
create table if not exists ccms_comments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references ccms_contracts(id) on delete cascade,
  document_id uuid references ccms_documents(id) on delete cascade,
  parent_id uuid references ccms_comments(id) on delete cascade,
  anchor_type text not null default 'general' check (anchor_type in ('general','finding','clause','quote')),
  anchor_ref text,                   -- finding id / template clause id
  quote text,
  body text not null,
  author_id uuid,
  author_name text,
  acting_role text,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- reviewer outcomes and approval decisions -------------------------------
create table if not exists ccms_reviews (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references ccms_contracts(id) on delete cascade,
  document_id uuid references ccms_documents(id) on delete set null,
  stage text not null,               -- legal | finance | committee | approval
  outcome text not null check (outcome in (
    'cleared','cleared_with_comments','not_cleared','approved','returned','rejected'
  )),
  note text,
  reviewer_id uuid,
  reviewer_name text,
  acting_role text,
  created_at timestamptz not null default now()
);

-- ---- indexes ----------------------------------------------------------------
create index if not exists idx_ccms_contracts_tenant  on ccms_contracts(tenant_id, created_at desc);
create index if not exists idx_ccms_vendors_tenant    on ccms_vendors(tenant_id, name);
create index if not exists idx_ccms_events_contract   on ccms_contract_events(contract_id, created_at);
create index if not exists idx_ccms_docs_contract     on ccms_documents(contract_id, created_at);
create index if not exists idx_ccms_comments_contract on ccms_comments(contract_id, created_at);
create index if not exists idx_ccms_reviews_contract  on ccms_reviews(contract_id, created_at);

-- ---- tenant stamping --------------------------------------------------------
drop trigger if exists trg_stamp_tenant_ccms_c on ccms_contracts;
create trigger trg_stamp_tenant_ccms_c before insert on ccms_contracts
  for each row execute function public.stamp_tenant_id();
drop trigger if exists trg_stamp_tenant_ccms_v on ccms_vendors;
create trigger trg_stamp_tenant_ccms_v before insert on ccms_vendors
  for each row execute function public.stamp_tenant_id();

-- ---- RLS: approved users only (tenant isolation is enforced server-side) ----
do $$
declare t text;
begin
  foreach t in array array[
    'ccms_vendors','ccms_contracts','ccms_contract_events','ccms_documents','ccms_comments','ccms_reviews'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_approved()) with check (public.is_approved())', t || '_all', t);
  end loop;
end $$;

-- ---- switch it on for the sandbox tenants (others: Settings -> Tenants) ------
update public.tenants
   set features = array_append(features, 'commercial_cms')
 where slug in ('default', 'acme') and not ('commercial_cms' = any(features));

-- ---- make PostgREST see the new tables now ----------------------------------
notify pgrst, 'reload schema';
