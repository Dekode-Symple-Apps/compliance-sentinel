-- Vendor notice particulars, so contract drafts can be pre-filled from the
-- vendor record (Commercial CMS) and the vendor portal's address is kept.
alter table public.ccms_vendors add column if not exists address text;
alter table public.ccms_vendors add column if not exists contact_designation text;
alter table public.ccms_vendors add column if not exists contact_phone text;
