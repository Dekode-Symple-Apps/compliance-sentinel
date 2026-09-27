// Vendor Management and Asset Monitoring rules.
import { screen, needsCompliance, prequalScore, docsFor, credentialAlerts, ddMonths, requestMilestones } from "../src/lib/vms";
import { assetCompliance, assignmentBlocks, itemStatus, isFixedAsset, assetAlerts } from "../src/lib/ams";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ── VMS screening and routing
const clean = screen({ abms: { answers: { public_official: "no" } }, blacklisted: false, relatedPartyMatch: false, duplicates: [] });
check("clean vendor: low risk, no Compliance", clean.rating === "low" && !needsCompliance(clean));
const oneYes = screen({ abms: { answers: { third_party_bank: "yes" } }, blacklisted: false, relatedPartyMatch: false, duplicates: [] });
check("one Yes: Medium and to Compliance", oneYes.rating === "medium" && needsCompliance(oneYes));
check("investigation Yes: High", screen({ abms: { answers: { investigation: "yes" } }, blacklisted: false, relatedPartyMatch: false, duplicates: [] }).rating === "high");
check("winding-up on CTOS: High", screen({ abms: {}, ctos: { winding_up: true }, blacklisted: false, relatedPartyMatch: false, duplicates: [] }).rating === "high");
check("related-party match goes to Compliance", needsCompliance(screen({ abms: {}, blacklisted: false, relatedPartyMatch: true, duplicates: [] })));
check("due diligence 12 months for High, 24 otherwise", ddMonths("high") === 12 && ddMonths("low") === 24);
check("pass mark: 27/45 = 60%", prequalScore({ legal: 3, financial: 3, technical: 3, experience: 3, quality: 3, safety: 3, environment: 3, resources: 3, integrity: 3 }) === 60);
check("subcontractor needs CIDB (mandatory)", docsFor("subcontractor").find((d) => d.id === "cidb")?.level === "M");
check("consultant has no CIDB requirement", !docsFor("consultant").some((d) => d.id === "cidb"));
const vendors = [{ id: "v1", name: "A", category: "subcontractor", status: "approved", dd_valid_until: day(20) }];
const docs = [{ vendor_id: "v1", doc_type: "cidb", status: "verified", expiry_date: day(-2) }, { vendor_id: "v1", doc_type: "insurance", status: "verified", expiry_date: day(90) }];
const al = credentialAlerts(vendors, docs);
check("lapsed CIDB flagged overdue and mandatory", al.some((a) => a.item.startsWith("CIDB") && a.stage === "overdue" && a.mandatory));
check("due diligence at 20 days in the 30-day band", al.some((a) => a.item === "Due diligence" && a.stage === "30"));
check("insurance at 90 days not alerted", !al.some((a) => a.item.startsWith("Insurance")));
const ms = requestMilestones({ kind: "onboarding", status: "invited", invite_token: "x" }, []);
check("invited request waits on the vendor", ms.next?.role === "vendor", JSON.stringify(ms.next));

// ── AMS
const verified = (req: string, exp: string | null, blocking = true, extra: any = {}) => ({ requirement: req, label: req, applicable: true, blocking, verified_at: "2026-01-01", expiry_date: exp, lead_days: 30, ...extra });
check("fixed asset over RM1,000 and 2 years", isFixedAsset({ ownership: "owned", cost: 5000, useful_life_years: 5 }) && !isFixedAsset({ ownership: "rented", cost: 5000, useful_life_years: 5 }));
check("item in date is compliant", itemStatus(verified("road_tax", day(90))) === "compliant");
check("item within lead time is expiring", itemStatus(verified("road_tax", day(10))) === "expiring");
check("unverified upload is pending verification", itemStatus({ requirement: "road_tax", applicable: true, uploaded_at: "x" }) === "pending_verification");
check("DOSH registration has no expiry", itemStatus(verified("dosh_reg", null)) === "compliant");
const lorryItems = [verified("motor_insurance", day(200)), verified("road_tax", day(-1)), verified("puspakom", day(100))];
check("expired road tax puts the asset on hold", assetCompliance(lorryItems).state === "hold");
const okItems = [verified("motor_insurance", day(200)), verified("road_tax", day(200)), verified("puspakom", day(100))];
check("all in date: compliant", assetCompliance(okItems).state === "compliant");
const lorry = { asset_class: "lorry" };
const driverD = { licence_classes: ["D"], licence_expiry: day(300), competencies: [] };
const b1 = assignmentBlocks(lorry, okItems, driverD, day(0));
check("class D licence cannot drive a lorry", b1.some((x) => x.startsWith("Licence class")), b1.join(" | "));
check("…and a lorry needs a GDL", b1.some((x) => x.includes("GDL")));
const driverE = { licence_classes: ["E"], licence_expiry: day(300), competencies: [{ type: "Goods driver licence (GDL)", expiry: day(200) }] };
check("class E with GDL: no blocks", assignmentBlocks(lorry, okItems, driverE, day(0)).length === 0, assignmentBlocks(lorry, okItems, driverE, day(0)).join(" | "));
check("expired licence blocks", assignmentBlocks(lorry, okItems, { ...driverE, licence_expiry: day(-3) }, day(0)).some((x) => x.includes("expired")));
check("asset on hold blocks even a qualified driver", assignmentBlocks(lorry, lorryItems, driverE, day(0)).some((x) => x.startsWith("Asset on compliance hold")));
const forklift = { asset_class: "forklift" };
check("forklift needs operator competency, not a driving licence", assignmentBlocks(forklift, [], { licence_classes: [], competencies: [] }, day(0)).every((x) => !x.startsWith("Licence class")) && assignmentBlocks(forklift, [], { licence_classes: [], competencies: [] }, day(0)).some((x) => x.includes("Forklift operator")));
const aa = assetAlerts([{ id: "a", asset_code: "AST-1", name: "L" }], [{ asset_id: "a", ...verified("road_tax", day(-5)), label: "Road tax", owner_dept: "Finance" }]);
check("5 days overdue escalates to the Head of Department", aa[0]?.escalate === true);
console.log(`\n${pass}/${pass + fail} VMS / AMS rule checks passed`);
process.exit(fail ? 1 : 0);
