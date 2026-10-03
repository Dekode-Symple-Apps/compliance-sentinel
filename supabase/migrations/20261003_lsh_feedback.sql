-- LSH feedback (29 Sep 2026 session): vendor onboarding, contracts, auditor access.
-- Safe to run more than once. The app tolerates these columns being absent until it runs.

-- (a) Vendor requests: business type (sole proprietors need a personal guarantee)
--     and the reviewer's confirmations of low-confidence fields.
do $$ begin
  if to_regclass('public.vms_requests') is not null then
    alter table public.vms_requests add column if not exists business_type text;
    alter table public.vms_requests add column if not exists validation_confirms jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- (b) Vendors: Finance payment override, AutoCount supplier creation, adverse-news scan.
do $$ begin
  if to_regclass('public.ccms_vendors') is not null then
    alter table public.ccms_vendors add column if not exists payment_override jsonb;
    alter table public.ccms_vendors add column if not exists autocount jsonb;
    alter table public.ccms_vendors add column if not exists adverse_news jsonb;
  end if;
end $$;

-- (c) Contracts: the business team's checklist before Legal, and retention.
do $$ begin
  if to_regclass('public.ccms_contracts') is not null then
    alter table public.ccms_contracts add column if not exists business_checklist jsonb;
    alter table public.ccms_contracts add column if not exists retention jsonb;
  end if;
end $$;

-- (d) Internal audit findings, tracked to closure.
create table if not exists public.ccms_audit_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  ref text not null,
  title text not null,
  description text,
  entity text,
  project text,
  owner_name text,
  hod_name text,
  action_plan text,
  due_date date,
  status text not null default 'open',          -- open | in_progress | resolved
  evidence jsonb not null default '[]'::jsonb,  -- [{name, url, at, by}]
  events jsonb not null default '[]'::jsonb,    -- [{at, by, type, detail}]
  escalated_at timestamptz,
  resolved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
do $$ begin
  if exists (select 1 from pg_proc where proname = 'stamp_tenant_id') then
    drop trigger if exists trg_stamp_tenant_ccms_af on public.ccms_audit_findings;
    create trigger trg_stamp_tenant_ccms_af before insert on public.ccms_audit_findings
      for each row execute function public.stamp_tenant_id();
  end if;
end $$;
alter table public.ccms_audit_findings enable row level security;
drop policy if exists ccms_audit_findings_all on public.ccms_audit_findings;
create policy ccms_audit_findings_all on public.ccms_audit_findings for all to authenticated
  using (public.is_approved()) with check (public.is_approved());

-- (e) Auditor: a read-only user level, and what each auditor may see.
alter type public.app_role add value if not exists 'auditor';
create table if not exists public.auditor_scopes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text,
  modules text[] not null default '{}',   -- e.g. {commercial_cms, vendor_management}
  entities text[] not null default '{}',  -- empty = every company
  projects text[] not null default '{}',  -- empty = every project
  period_from date,
  period_to date,
  updated_at timestamptz not null default now()
);
alter table public.auditor_scopes enable row level security;
-- Read and written by the server only (service role); no client policy.
