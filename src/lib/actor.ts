// Who is acting, for the workflow modules' server functions: the caller's
// organisation (handed on by requireProduct), their name — never an email
// address — and the demo "acting as" persona check.
import { getCallerTenant, requireFeature, type TenantFeature } from "@/lib/tenant.functions";
import { CCMS_ROLES, DEMO_SINGLE_USER, displayName, type CcmsRole } from "@/lib/ccms";

export async function actorOf(context: any, feature: TenantFeature) {
  const { tenantId, features } = context?.tenant ?? (await getCallerTenant(context.userId));
  requireFeature(features, feature);
  const meta = context?.claims?.user_metadata ?? {};
  const email = (context?.claims?.email as string | undefined) ?? "";
  return {
    sb: context.supabase as any,
    tenantId: tenantId as string,
    userId: (context?.userId as string | undefined) ?? null,
    userName: String(meta.full_name || meta.name || displayName(email) || "Unknown user"),
  };
}

export function requireRole(role: CcmsRole, allowed: CcmsRole[], action: string) {
  if (!allowed.includes(role)) {
    throw new Error(`${CCMS_ROLES[role]} cannot ${action}. Switch "Acting as" to ${allowed.map((r) => CCMS_ROLES[r]).join(" or ")}.`);
  }
}

/** Nobody approves their own submission. In the single-user demo the block is
 *  recorded instead of enforced, so one person can walk the flow. */
export function selfApproval(submitterId: string | null | undefined, userId: string | null): { blocked: boolean; note: string } {
  const same = !!submitterId && submitterId === userId;
  if (same && !DEMO_SINGLE_USER) return { blocked: true, note: "" };
  return { blocked: false, note: same ? " Self-approval — permitted only in single-user demo mode." : "" };
}

export function assertTenant(rowTenant: string | null | undefined, tenantId: string) {
  if (rowTenant && rowTenant !== tenantId) throw new Error("Not found");
}
