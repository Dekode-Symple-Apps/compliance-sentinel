-- ============================================================================
-- 20260929_vms_ams.sql
-- Module 1 — Vendor Management (VMS-01 onboarding, VMS-02 subcontractor
-- pre-qualification, VMS-03 credential and conflict monitoring) and
-- Module 3 — Asset Monitoring (AMS-01), plus the rest of CMS-03 (change,
-- renewal, closure). Idempotent: safe to re-run.
--
-- Same pattern as Commercial CMS: tenant_id on root tables stamped on insert,
-- RLS admits approved users, tenant isolation enforced in server functions.
-- The vendor portal (an invited vendor, not signed in) reaches its own
-- request only through server functions that check the invitation token.
-- ============================================================================

-- ---- the vendor master grows up (it is ccms_vendors, shared with contracts) --
alter table ccms_vendors add column if not exists vendor_code text;
alter table ccms_vendors add column if not exists entity text;
alter table ccms_vendors add column if not exists tin text;
alter table ccms_vendors add column if not exists bank_name text;
alter table ccms_vendors add column if not exists bank_account text;
alter table ccms_vendors add column if not exists bank_verified boolean not null default false;
alter table ccms_vendors add column if not exists directors jsonb not null default '[]'::jsonb;   -- [{name, nric_last4}]
alter table ccms_vendors add column if not exists compliance_hold boolean not null default false;
alter table ccms_vendors add column if not exists hold_reason text;
alter table ccms_vendors add column if not exists conditions jsonb;                               -- {text, due}
alter table ccms_vendors add column if not exists safeguards text;
alter table ccms_vendors add column if not exists on_master_sub_list boolean not null default false;
alter table ccms_vendors add column if not exists list_review_date date;
alter table ccms_vendors add column if not exists approved_at timestamptz;
alter table ccms_vendors add column if not exists approved_by text;
alter table ccms_vendors drop constraint if exists ccms_vendors_status_check;
alter table ccms_vendors add constraint ccms_vendors_status_check check (status in ('approved','conditional','pending','on_hold','blacklisted','rejected'));

create sequence if not exists vms_request_seq start 1;
create sequence if not exists vms_vendor_seq start 1;

-- ---- onboarding and pre-qualification requests ------------------------------
create table if not exists vms_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  reference_number text unique,
  kind text not null default 'onboarding' check (kind in ('onboarding','subcontractor')),
  vendor_id uuid references ccms_vendors(id) on delete set null,
  company_name text not null,
  registration_no text,
  entity text,
  category text,
  goods_services text,
  justification text,
  annual_spend numeric,
  urgency text,
  project text,
  trade text,
  expected_value numeric,
  contact_name text,
  contact_email text,
  status text not null default 'submitted' check (status in (
    'submitted','invited','vendor_submitted','screening','assessment','compliance','manager',
    'approved','conditional','returned','rejected'
  )),
  invite_token text unique,
  invite_expires timestamptz,
  register jsonb,          -- supplier register form answers
  abms jsonb,              -- integrity questionnaire, declaration, pledge, CTOS consent
  screening jsonb,         -- {rating, reasons[], flags[]}
  ctos jsonb,              -- {score, litigation, winding_up, director_flags, doc_id, by, at}
  assessment jsonb,        -- {areas: {id: score}, total, pass, pe_declared_coi, by, at}
  conflict_check jsonb,    -- subcontractors: {accounts_decision, by, at, note}
  compliance jsonb,        -- {decision, conditions, due, rationale, by, at}
  decision jsonb,          -- {outcome, reason, by, at}
  return_reason text,
  requestor_id uuid,
  requestor_name text,
  submitted_by_vendor_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.vms_set_reference()
returns trigger language plpgsql as $$
begin
  if new.reference_number is null then
    new.reference_number := (case when new.kind = 'subcontractor' then 'SP-' else 'VR-' end)
      || to_char(now(), 'YYYY') || '-' || lpad(nextval('vms_request_seq')::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_vms_reference on vms_requests;
create trigger trg_vms_reference before insert on vms_requests
  for each row execute function public.vms_set_reference();

-- ---- vendor documents and credentials (versions kept) -----------------------
create table if not exists vms_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references ccms_vendors(id) on delete cascade,
  request_id uuid references vms_requests(id) on delete cascade,
  doc_type text not null,
  file_name text not null,
  file_url text not null,
  number text,
  issuer text,
  issued_date date,
  expiry_date date,
  status text not null default 'uploaded' check (status in ('uploaded','verified','superseded','rejected')),
  extracted jsonb,         -- what the AI read: {number, issuer, holder, issued, expiry}
  uploaded_by text,
  verified_by text,
  verified_at timestamptz,
  supersedes_id uuid references vms_documents(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---- annual conflict-of-interest declarations -------------------------------
create table if not exists vms_coi (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  vendor_id uuid not null references ccms_vendors(id) on delete cascade,
  year int not null,
  due_date date not null,
  status text not null default 'issued' check (status in ('issued','submitted','escalated')),
  declared boolean,
  details text,
  signatory text,
  submitted_at timestamptz,
  compliance_notified_at timestamptz,
  compliance_assessment text,
  safeguards text,
  assessed_by text,
  assessed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vendor_id, year)
);

create table if not exists vms_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references vms_requests(id) on delete cascade,
  vendor_id uuid references ccms_vendors(id) on delete cascade,
  event_type text not null,
  detail text,
  actor_name text,
  acting_role text,
  created_at timestamptz not null default now()
);

-- ---- Asset Monitoring ------------------------------------------------------
create sequence if not exists ams_asset_seq start 1;

create table if not exists ams_drivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  name text not null,
  staff_id text,
  department text,
  contact text,
  licence_no text,
  licence_classes text[] not null default '{}',
  licence_expiry date,
  competencies jsonb not null default '[]'::jsonb,   -- [{type, number, expiry}]
  created_at timestamptz not null default now()
);

create table if not exists ams_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  asset_code text unique,
  asset_class text not null,
  name text not null,
  entity text,
  department text,
  location text,
  make text, model text, year int,
  registration_no text,
  serial_no text,
  ownership text not null default 'owned' check (ownership in ('owned','rented')),
  source_ref text,                 -- approved purchase / rental contract / AutoCount FA reference
  purchase_date date,
  cost numeric,
  useful_life_years numeric,
  vendor_id uuid references ccms_vendors(id) on delete set null,
  on_hire date, off_hire date,
  fixed_asset boolean not null default false,
  dosh_reg_no text,
  status text not null default 'active' check (status in ('active','disposed')),
  created_by text,
  created_at timestamptz not null default now()
);
create or replace function public.ams_set_code()
returns trigger language plpgsql as $$
begin
  if new.asset_code is null then
    new.asset_code := 'AST-' || lpad(nextval('ams_asset_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_ams_code on ams_assets;
create trigger trg_ams_code before insert on ams_assets for each row execute function public.ams_set_code();

create table if not exists ams_items (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references ams_assets(id) on delete cascade,
  requirement text not null,
  label text not null,
  mandatory boolean not null default true,
  blocking boolean not null default false,
  lead_days int not null default 30,
  owner_dept text,
  applicable boolean not null default true,
  reference text, issuer text,
  effective_date date, expiry_date date,
  amount numeric,
  file_name text, file_url text,
  uploaded_by text, uploaded_at timestamptz,
  verified_by text, verified_at timestamptz,
  pending jsonb,                   -- a renewal uploaded and awaiting verification
  escalation jsonb,                -- {reason, recovery_date, by, at}
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ams_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references ams_assets(id) on delete cascade,
  driver_id uuid not null references ams_drivers(id) on delete cascade,
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active','returned','blocked')),
  handover jsonb,                  -- {date, reading, checklist[], photos[], accessories}
  return_record jsonb,
  blocked_reason text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists ams_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references ams_assets(id) on delete cascade,
  driver_id uuid references ams_drivers(id) on delete cascade,
  event_type text not null,
  detail text,
  actor_name text,
  acting_role text,
  created_at timestamptz not null default now()
);

-- ---- CMS-03: change requests, renewal decisions, closure --------------------
alter table ccms_contracts add column if not exists changes jsonb not null default '[]'::jsonb;  -- [{id, kind, description, value_impact, status, legal, decided_*}]
alter table ccms_contracts add column if not exists renewal jsonb;                               -- {decision, note, new_end, by, at}
alter table ccms_contracts add column if not exists closure jsonb;                               -- {checklist, override_reason, closed_at, by, retain_until, legal_hold}

-- ---- indexes ---------------------------------------------------------------
create index if not exists idx_vms_requests_tenant on vms_requests(tenant_id, created_at desc);
create index if not exists idx_vms_documents_vendor on vms_documents(vendor_id, doc_type);
create index if not exists idx_vms_documents_request on vms_documents(request_id);
create index if not exists idx_vms_events_request on vms_events(request_id, created_at);
create index if not exists idx_vms_events_vendor on vms_events(vendor_id, created_at);
create index if not exists idx_ams_assets_tenant on ams_assets(tenant_id, asset_class);
create index if not exists idx_ams_items_asset on ams_items(asset_id);
create index if not exists idx_ams_assign_asset on ams_assignments(asset_id, status);

-- ---- tenant stamping --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vms_requests','vms_coi','ams_drivers','ams_assets'] loop
    execute format('drop trigger if exists %I on %I', 'trg_stamp_tenant_' || t, t);
    execute format('create trigger %I before insert on %I for each row execute function public.stamp_tenant_id()', 'trg_stamp_tenant_' || t, t);
  end loop;
end $$;

-- ---- RLS --------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vms_requests','vms_documents','vms_coi','vms_events','ams_drivers','ams_assets','ams_items','ams_assignments','ams_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_approved()) with check (public.is_approved())', t || '_all', t);
  end loop;
end $$;

-- ---- switch the two modules on for the sandbox tenants ----------------------
update public.tenants set features = array_append(features, 'vendor_management')
 where slug in ('default','acme') and not ('vendor_management' = any(features));
update public.tenants set features = array_append(features, 'asset_monitoring')
 where slug in ('default','acme') and not ('asset_monitoring' = any(features));

notify pgrst, 'reload schema';
