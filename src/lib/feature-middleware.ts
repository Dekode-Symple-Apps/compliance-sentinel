import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCallerTenant, requireFeature, type TenantFeature } from "@/lib/tenant.functions";

/**
 * Signed in AND the product switched on for the caller's organisation.
 * Hiding a product's menu is not enough — its pages and server functions still
 * answer a typed-in address — so a product's server functions use this in
 * place of requireSupabaseAuth.
 */
export function requireProduct(key: TenantFeature) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      const tenant = await getCallerTenant((context as any).userId);
      requireFeature(tenant.features, key);
      // Handed on so the function does not look the organisation up again.
      return next({ context: { tenant } });
    });
}
