// ----------------------------------------------------------------------------
// Remembered answers for demos: each field keeps its last few values in this
// browser, and each form its last full set, so a walkthrough is one click per
// step instead of retyping. A per-viewer convenience only — nothing is sent to
// the server, and every storage call is guarded (private windows, blocked
// storage) so the forms work the same without it.
// ----------------------------------------------------------------------------

const FIELD = (f: string) => `ccms-fill:${f}`;
const FORM = (f: string) => `ccms-form:${f}`;
const MAX = 5;

function read<T>(key: string): T | null {
  try { const v = window.localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable — prefill just doesn't persist */ }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inYears = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() + n); d.setDate(d.getDate() - 1); return iso(d); };

/** First-use values, from the demo run, so a fresh browser can still fill. */
const SEED_FIELDS: Record<string, string[]> = {
  sent_to: ["Farid Osman, farid@example.com"],
  our_signatory: ["Tan Wei Ming"],
  our_designation: ["Executive Director"],
  their_signatory: ["Farid Osman"],
  their_designation: ["Director"],
  stamp_certificate: ["STAMPS-2026-DEMO-0104"],
  stamp_duty: ["10"],
  resubmit_note: ["Counterparty accepted our template positions."],
  approve_note: ["Checked against the template; comments noted."],
  return_note: ["Revert to our template: anti-bribery clause, Malaysian law, no data reuse, no liability cap."],
  accepted_note: ["Confirmed by email."],
  renew_note: ["Relationship continues; vendor re-checked."],
  close_reason: ["Purpose completed."],
  change_description: ["Additional scope: temporary works design for Block C."],
  confirm_to: ["Project Director, client"],
  confirm_reply: ["Client agreed to our tendered terms in writing."],
};

export function recall(field: string): string[] {
  const mine = read<string[]>(FIELD(field)) ?? [];
  return [...new Set([...mine, ...(SEED_FIELDS[field] ?? [])])].filter(Boolean).slice(0, MAX);
}
export function remember(fields: Record<string, string | null | undefined>) {
  for (const [f, v] of Object.entries(fields)) {
    const val = (v ?? "").trim();
    if (!val) continue;
    const prev = read<string[]>(FIELD(f)) ?? [];
    write(FIELD(f), [val, ...prev.filter((x) => x !== val)].slice(0, MAX));
  }
}

/** Whole-form snapshots, keyed by form (e.g. "request:nda"). */
const SEED_FORMS: Record<string, () => Record<string, any>> = {
  "request:nda": () => ({
    f: { entity: "Lim Seong Hai Capital Berhad", vendor_name: "Awan Digital Solutions Sdn Bhd", title: "Mutual NDA — cloud ERP evaluation",
      start_date: iso(new Date()), end_date: inYears(2), requestor_department: "Group IT",
      scope_summary: "Share financial and project data so Awan Digital can scope a cloud ERP migration." },
    tf: { purpose: "Evaluation of a cloud ERP migration for the Group, including sharing of financial and project data." },
  }),
  "request:letter_of_award": () => ({
    f: { entity: "LSH BEST Builders Sdn Bhd", vendor_name: "Teguh Piling & Foundation Sdn Bhd", title: "Bored piling — Block C substructure",
      project: "LSH 33 Block C", award_reference: "AF-2026-031", value: "1850000", start_date: iso(new Date()), end_date: inYears(1),
      requestor_department: "Project Management",
      scope_summary: "Supply and install 600 mm and 900 mm bored piles for Block C, including testing and cut-off." },
  }),
};

/** A saved form with its dates moved to today: a request is dated the day it
 *  is raised, so yesterday's dates are never refilled. */
export function recallForm(form: string): Record<string, any> | null {
  const seed = SEED_FORMS[form]?.() ?? null;
  const saved = read<Record<string, any>>(FORM(form));
  if (!saved) return seed;
  const today = iso(new Date());
  return {
    ...saved,
    f: { ...saved.f, start_date: seed?.f?.start_date ?? today, end_date: seed?.f?.end_date ?? saved.f?.end_date ?? "" },
    ...(saved.tf ? { tf: { ...saved.tf, date: today } } : {}),
  };
}
export function rememberForm(form: string, values: Record<string, any>) {
  write(FORM(form), values);
}
