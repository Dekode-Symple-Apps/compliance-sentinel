-- Contract owner: the person in the business who owns the contract (not only Legal).
-- The app reads it through contractOwner() and falls back to the repository record / requester until this runs.
alter table public.ccms_contracts add column if not exists owner_name text;
