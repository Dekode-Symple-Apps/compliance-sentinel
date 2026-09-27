// ----------------------------------------------------------------------------
// Asset Monitoring (Module 3, AMS-01) — shared rules, client-safe, no I/O.
// The asset class decides the compliance checklist, the driver's licence and
// competency, and whether the asset may be deployed. From the Lim Seong Hai
// spec pages 26–30.
// ----------------------------------------------------------------------------

export const AMS_FEATURE = "asset_monitoring";

export interface Requirement {
  id: string; label: string; lead: number; owner: string;
  /** An expired or missing blocking item puts the asset on compliance hold. */
  blocking: boolean;
  /** No expiry: a verified reference number is enough (e.g. DOSH registration). */
  noExpiry?: boolean;
}
export const REQUIREMENTS: Record<string, Requirement> = {
  motor_insurance: { id: "motor_insurance", label: "Motor insurance", lead: 30, owner: "Finance / Operations", blocking: true },
  plant_insurance: { id: "plant_insurance", label: "Plant insurance", lead: 30, owner: "Finance / Operations", blocking: true },
  road_tax: { id: "road_tax", label: "Road tax", lead: 15, owner: "Finance", blocking: true },
  puspakom: { id: "puspakom", label: "PUSPAKOM inspection", lead: 14, owner: "Operations", blocking: true },
  cf_pma: { id: "cf_pma", label: "Certificate of fitness — lifting machinery (PMA)", lead: 30, owner: "Safety and Health", blocking: true },
  cf_pmt: { id: "cf_pmt", label: "Certificate of fitness — pressure vessel (PMT)", lead: 30, owner: "Safety and Health", blocking: true },
  cf_pmd: { id: "cf_pmd", label: "Certificate of fitness — steam boiler (PMD)", lead: 30, owner: "Safety and Health", blocking: true },
  cf_confirm: { id: "cf_confirm", label: "Certificate of fitness (confirm with Safety and Health)", lead: 30, owner: "Safety and Health", blocking: true },
  dosh_reg: { id: "dosh_reg", label: "DOSH registration number", lead: 0, owner: "Safety and Health", blocking: true, noExpiry: true },
  erection_records: { id: "erection_records", label: "Erection / dismantling records", lead: 0, owner: "Safety and Health", blocking: false, noExpiry: true },
  goods_permit: { id: "goods_permit", label: "Permit for the load carried", lead: 30, owner: "Operations", blocking: false },
  operating_licence: { id: "operating_licence", label: "Operating licence", lead: 30, owner: "Operations", blocking: false },
  site_register: { id: "site_register", label: "Site machinery register", lead: 0, owner: "Operations", blocking: false, noExpiry: true },
  energy_commission: { id: "energy_commission", label: "Energy Commission requirements", lead: 30, owner: "Operations", blocking: false },
  service: { id: "service", label: "Service", lead: 14, owner: "Operations", blocking: false },
  calibration: { id: "calibration", label: "Calibration certificate (reference standard, tolerance)", lead: 30, owner: "Quality", blocking: true },
  traceability: { id: "traceability", label: "Traceability to a recognised standard", lead: 30, owner: "Quality", blocking: false },
  software_licence: { id: "software_licence", label: "Licence agreement and renewal", lead: 30, owner: "IT", blocking: false },
};

export interface AssetClass {
  id: string; label: string;
  /** requirement id → M (mandatory) or C (conditional: created as N/A until switched on). */
  items: Record<string, "M" | "C">;
  /** Driver licence classes that cover it; empty = no driving licence needed. */
  licence: string[];
  licenceConditional?: boolean;
  /** Competency the operator must hold; "C" suffix-free means mandatory. */
  competency?: { type: string; mandatory: boolean }[];
}
export const ASSET_CLASSES: AssetClass[] = [
  { id: "car", label: "Car, MPV or company vehicle", items: { motor_insurance: "M", road_tax: "M", puspakom: "C" }, licence: ["D"] },
  { id: "van", label: "Van or panel van", items: { motor_insurance: "M", road_tax: "M", puspakom: "M" }, licence: ["D", "E"], competency: [{ type: "Goods driver licence (GDL)", mandatory: false }] },
  { id: "lorry", label: "Lorry or commercial goods vehicle", items: { motor_insurance: "M", road_tax: "M", puspakom: "M", goods_permit: "C" }, licence: ["E", "E1", "E2"], competency: [{ type: "Goods driver licence (GDL)", mandatory: true }] },
  { id: "motorcycle", label: "Motorcycle", items: { motor_insurance: "M", road_tax: "M" }, licence: ["B", "B2", "B Full"] },
  { id: "bus", label: "Bus or passenger transport", items: { motor_insurance: "M", road_tax: "M", puspakom: "M", operating_licence: "C" }, licence: ["E"], competency: [{ type: "Public service vehicle (PSV) licence", mandatory: true }] },
  { id: "mobile_crane", label: "Mobile crane", items: { motor_insurance: "M", road_tax: "C", puspakom: "C", cf_pma: "M", dosh_reg: "M" }, licence: ["E"], licenceConditional: true, competency: [{ type: "Crane operator competency", mandatory: true }] },
  { id: "tower_crane", label: "Tower crane, passenger hoist or gondola", items: { plant_insurance: "C", cf_pma: "M", dosh_reg: "M", erection_records: "M" }, licence: [], competency: [{ type: "Operator competency", mandatory: true }] },
  { id: "excavator", label: "Excavator, backhoe or wheel loader", items: { plant_insurance: "M", road_tax: "C", puspakom: "C", cf_confirm: "C", site_register: "C" }, licence: [], competency: [{ type: "Operator competency", mandatory: true }] },
  { id: "forklift", label: "Forklift", items: { plant_insurance: "M", cf_pma: "M", dosh_reg: "M" }, licence: [], competency: [{ type: "Forklift operator competency", mandatory: true }] },
  { id: "air_receiver", label: "Air compressor or air receiver", items: { plant_insurance: "C", cf_pmt: "M", dosh_reg: "M" }, licence: [], competency: [{ type: "Competent person", mandatory: false }] },
  { id: "boiler", label: "Boiler or steam generating plant", items: { plant_insurance: "C", cf_pmd: "M", dosh_reg: "M" }, licence: [], competency: [{ type: "Certified boilerman or steam engineer", mandatory: true }] },
  { id: "genset", label: "Generator set", items: { plant_insurance: "C", service: "M", energy_commission: "C" }, licence: [], competency: [{ type: "Competent chargeman", mandatory: false }] },
  { id: "measuring", label: "Measuring and testing equipment", items: { calibration: "M", traceability: "C" }, licence: [] },
  { id: "it", label: "IT equipment and software", items: { software_licence: "M" }, licence: [] },
];
export const classById = (id: string) => ASSET_CLASSES.find((c) => c.id === id);
export const LICENCE_CLASSES = ["B", "B2", "B Full", "D", "E", "E1", "E2"];

/** Owned, over RM1,000 and at least two years' life: a fixed asset (AutoCount FA). */
export const isFixedAsset = (a: { ownership: string; cost?: number | null; useful_life_years?: number | null }) =>
  a.ownership === "owned" && (a.cost ?? 0) > 1000 && (a.useful_life_years ?? 0) >= 2;

export const daysTo = (iso: string, today = new Date()) =>
  Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);

// ── compliance item status ───────────────────────────────────────────────────
export type ItemStatus = "na" | "pending_evidence" | "pending_verification" | "compliant" | "expiring" | "expired";
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  na: "N/A", pending_evidence: "Pending evidence", pending_verification: "Pending verification",
  compliant: "Compliant", expiring: "Expiring", expired: "Expired",
};

export function itemStatus(i: any, today = new Date()): ItemStatus {
  if (!i.applicable) return "na";
  const req = REQUIREMENTS[i.requirement];
  const verified = !!i.verified_at;
  if (!verified) return i.uploaded_at || i.pending ? "pending_verification" : "pending_evidence";
  if (req?.noExpiry || !i.expiry_date) return i.pending ? "pending_verification" : "compliant";
  const d = daysTo(i.expiry_date, today);
  if (d < 0) return "expired";
  if (d <= (i.lead_days ?? req?.lead ?? 30)) return "expiring";
  return "compliant";
}

/** An asset may be deployed or newly assigned only while every applicable
 *  blocking item is verified and in date. */
export function assetCompliance(items: any[], today = new Date()): { state: "compliant" | "due_soon" | "overdue" | "hold"; reasons: string[] } {
  const reasons: string[] = [];
  let state: "compliant" | "due_soon" | "overdue" | "hold" = "compliant";
  for (const i of items) {
    const s = itemStatus(i, today);
    if (s === "na" || s === "compliant") continue;
    if (i.blocking && (s === "expired" || s === "pending_evidence" || s === "pending_verification")) {
      state = "hold"; reasons.push(`${i.label}: ${ITEM_STATUS_LABEL[s].toLowerCase()}`);
    } else if (s === "expired" && state !== "hold") { state = "overdue"; reasons.push(`${i.label}: expired`); }
    else if (s === "expiring" && state === "compliant") { state = "due_soon"; reasons.push(`${i.label}: expires ${i.expiry_date}`); }
  }
  return { state, reasons };
}
export const ASSET_STATE_LABEL = { compliant: "Compliant", due_soon: "Due soon", overdue: "Overdue", hold: "Compliance hold" } as const;

// ── assignment: a hard block, no override (steps 4–6, 8) ─────────────────────
export function assignmentBlocks(asset: any, items: any[], driver: any, startIso: string): string[] {
  const cls = classById(asset.asset_class);
  const out: string[] = [];
  const hold = assetCompliance(items, new Date(startIso));
  if (hold.state === "hold") out.push(`Asset on compliance hold — ${hold.reasons.join("; ")}`);
  if (cls?.licence.length && !cls.licenceConditional) {
    const has = (driver.licence_classes ?? []).some((c: string) => cls.licence.includes(c));
    if (!has) out.push(`Licence class does not cover a ${cls.label.toLowerCase()} (needs ${cls.licence.join(" or ")})`);
    if (!driver.licence_expiry) out.push("No driving licence expiry recorded");
    else if (daysTo(driver.licence_expiry, new Date(startIso)) < 0) out.push(`Driving licence expired ${driver.licence_expiry}`);
  }
  for (const req of cls?.competency ?? []) {
    if (!req.mandatory) continue;
    const c = (driver.competencies ?? []).find((x: any) => x.type === req.type);
    if (!c) out.push(`Missing ${req.type}`);
    else if (c.expiry && daysTo(c.expiry, new Date(startIso)) < 0) out.push(`${req.type} expired ${c.expiry}`);
  }
  return out;
}

// ── alerts (steps 11–12, 16) ──────────────────────────────────────────────────
export interface AssetAlert { asset_id: string; asset: string; item: string; owner: string; days: number; overdue: boolean; escalate: boolean; escalated: boolean }

/** Items inside their lead time or past expiry; overdue more than 3 days
 *  escalates to the Head of Department. */
export function assetAlerts(assets: any[], items: any[], today = new Date()): AssetAlert[] {
  const out: AssetAlert[] = [];
  for (const i of items) {
    if (!i.applicable || !i.expiry_date || !i.verified_at) continue;
    const d = daysTo(i.expiry_date, today);
    if (d > (i.lead_days ?? 30)) continue;
    const a = assets.find((x) => x.id === i.asset_id);
    if (!a) continue;
    out.push({ asset_id: a.id, asset: `${a.asset_code} ${a.name}`, item: i.label, owner: i.owner_dept ?? "", days: d, overdue: d < 0, escalate: d < -3, escalated: !!i.escalation });
  }
  return out.sort((a, b) => a.days - b.days);
}
