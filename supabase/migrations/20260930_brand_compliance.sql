-- Branding Compliance workspace (stage 1 of the Sarawak Policy Governance Platform).
-- No new tables: submissions are analysis_reports rows with workspace_id
-- 'brand_compliance' (as Credit Risk is). This only switches the product on.
update public.tenants set features = array_append(features, 'brand_compliance')
 where slug in ('default', 'acme') and not ('brand_compliance' = any(features));
