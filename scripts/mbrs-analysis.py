"""The MBRS analysis: what SSM's form requires, and what we actually produce.

    python3 scripts/mbrs-analysis.py [out.xlsx]

Two questions that look alike and are not:

  1. Can we reproduce a filing SSM already accepted?  Measured fact by fact
     against the accepted XML for the same company.  Answers "is the output
     right", and is bounded by what those companies happened to report.

  2. Can we produce everything SSM's form allows and requires?  Measured
     against the FS-MPERS taxonomy, which is the authoritative statement of
     the field set.  Answers "is the form complete", and sees boxes no sample
     filing ever touched.

A system can score well on the first and badly on the second — that is exactly
the donor-derived template's failure mode, and the reason a company shaped
differently from the samples would hit boxes that do not exist.  This report
carries both, joined per concept, so a gap can be read as: in the taxonomy /
mandatory / used by a real filing / we have a box / we filled it correctly.

Inputs (paths are conventional, not arguments):
  scratch/ssmxt/tax/SSMxT_2022v1.0          unzipped SSMxT (free from SSM)
  scratch/ssmxt/Business_Rule_...xlsx        SSM's validation rules
  scratch/out/system_{qsk,ls,yee}.xml        our generated filings
  ~/Downloads/SSM_FS-MPERS_*.xml             the accepted filings
"""
import sys, os, re, html, glob, importlib.util
from datetime import date, timedelta
from collections import Counter, defaultdict

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser("~")
TAX = f"{PROJ}/scratch/ssmxt/tax/SSMxT_2022v1.0"
RULES = f"{PROJ}/scratch/ssmxt/Business_Rule_MBRS_v2_SSMxT_2022.xlsx"
OUT = f"{PROJ}/scratch/out"

CASES = [
    ("QSK Realty", "qsk", "SSM_FS-MPERS_200901038625_20241231.xml", "donor"),
    ("LS Contracts", "ls", "SSM_FS-MPERS_202101024478_20251231.xml", "held-out"),
    ("Yee Fatt", "yee", "SSM_FS-MPERS_200801009615_20260131.xml", "held-out"),
]
# Fields that are never in the accounts — the filer types them from the SSM
# register. Counted apart so they do not read as extraction failures.
USER_INPUT = ("MSIC", "DescriptionOfBusiness", "IdentificationNumberOf", "TypeOfIdentification")

# reuse the requirement-map parsers rather than restating them
_spec = importlib.util.spec_from_file_location("reqmap", f"{PROJ}/scripts/mbrs-requirement-map.py")
reqmap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reqmap)


# ── the accepted / generated filings ────────────────────────────────────────

def _dei(raw, t):
    m = re.search(rf"<ssmt-dei:{t}[^>]*>([^<]+)<", raw)
    return m.group(1).strip() if m else None


def tokeniser(raw):
    """Context ids carry real dates; tokenise them so two filings compare."""
    cs, ce = _dei(raw, "CompanyCurrentFinancialYearStartDate"), _dei(raw, "CompanyCurrentFinancialYearEndDate")
    ps, pe = _dei(raw, "CompanyPreviousFinancialYearStartDate"), _dei(raw, "CompanyPreviousFinancialYearEndDate")
    ppe = (date.fromisoformat(ps) - timedelta(days=1)).isoformat()
    M = {ce.replace("-", ""): "{CE}", cs.replace("-", ""): "{CS}", pe.replace("-", ""): "{PE}",
         ps.replace("-", ""): "{PS}", ppe.replace("-", ""): "{PPE}"}

    def t(c):
        for k, v in M.items():
            c = c.replace(k, v)
        return c
    return t


def keyed(raw):
    f = {}
    for tag, cr, v in re.findall(r'<((?:ssmt|ifrs-smes)[\w-]*:[\w.-]+)\s+contextRef="([^"]+)"[^>]*>([^<]*)</\1>', raw):
        f[(tag, cr)] = html.unescape(v.strip())
    return f


def isnum(v):
    try:
        float(v.replace(",", ""))
        return True
    except Exception:
        return False


def norm(v):
    return f"{float(v.replace(',','')):.2f}" if isnum(v) else " ".join(v.split()).lower()


def is_narrative(v):
    return v.lstrip().startswith("<") or len(v) > 200


def compare():
    """Fact-level outcome per filing, plus per-concept evidence for the join."""
    facts, per = [], {}
    concept_seen = defaultdict(lambda: {"filings": set(), "right": 0, "wrong": 0, "blank": 0, "nobox": 0})
    tmpl = open(f"{PROJ}/src/lib/mbrs-template.ts", encoding="utf-8").read()
    slots = set(re.findall(r'"c":"([^"]+)","ctx":"([^"]+)"', tmpl))
    for name, tag, expf, kind in CASES:
        exp_raw = open(f"{HOME}/Downloads/{expf}", encoding="utf-8", errors="ignore").read()
        sys_raw = open(f"{OUT}/system_{tag}.xml", encoding="utf-8", errors="ignore").read()
        t = tokeniser(exp_raw)
        E, S = keyed(exp_raw), keyed(sys_raw)
        n_exp = n_right = 0
        for (c, cr), ev in E.items():
            if not ev.strip():
                continue
            n_exp += 1
            sv = S.get((c, cr))
            nm = c.split(":")[-1]
            box = (c, t(cr)) in slots or sv is not None
            if sv is not None and sv.strip() and norm(sv) == norm(ev):
                outcome, n_right = "right", n_right + 1
                concept_seen[c]["right"] += 1
            elif any(u in nm for u in USER_INPUT):
                outcome = "Needs a person to enter"
            elif is_narrative(ev):
                outcome = "Wording never matches exactly"
            elif not box:
                outcome = "No box in the form for it"
                concept_seen[c]["nobox"] += 1
            elif sv is None or not sv.strip():
                outcome = "Box exists, we left it empty"
                concept_seen[c]["blank"] += 1
            else:
                outcome = "Figure still differs"
                concept_seen[c]["wrong"] += 1
            concept_seen[c]["filings"].add(name)
            facts.append({"Filing": name, "Kind": kind, "Outcome": outcome, "Concept": c,
                          "Context": t(cr), "SSM value": ev[:200], "Our value": (sv or "")[:200]})
        per[name] = (kind, n_exp, n_right)
    return facts, per, concept_seen


# ── the taxonomy side ───────────────────────────────────────────────────────

def requirements():
    elems = reqmap.parse_elements(TAX)
    by_q = {v["q"]: v for v in elems.values()}

    def byid(h):
        return elems.get((h or "").split("#")[-1], {}).get("q", (h or "").split("#")[-1])

    labels = reqmap.parse_labels(TAX, byid)
    pres = reqmap.parse_presentation(f"{TAX}/rep/ssm/ca-2016/fs/mpers", byid)
    rules, items = reqmap.mandatory_concepts(RULES)
    req, unmatched = reqmap.match_requirements(items, pres, labels)

    tmpl = open(f"{PROJ}/src/lib/mbrs-template.ts", encoding="utf-8").read()
    slots, bound, literal, narrative = set(), {}, set(), set()
    for line in tmpl.splitlines():
        line = line.strip()
        cm = re.match(r'^\{"c":"([^"]+)"', line)
        if not cm:
            continue
        q = cm.group(1)
        slots.add(q)
        fm = re.search(r'"field":"(\w+)"', line)
        if fm:
            bound.setdefault(q, fm.group(1))
        if re.search(r'"v":"[^"]*"', line):
            literal.add(q)
        if '"narrative":true' in line:
            narrative.add(q)

    def mandatory(q):
        """"required" / "required if …" / "" — from the parsed business rules."""
        r = req.get(q)
        if not r or r["alternative"]:
            return "", ""
        return ("required if " + r["condition"][:90]) if r["conditional"] else "required", r["rule"]

    out = []
    for role, label in reqmap.PROFILE_ROLES.items():
        for q, depth, _p in pres.get(role) or []:
            e = by_q.get(q, {})
            if e.get("abstract") or not e.get("type"):
                continue
            status = ("bound to " + bound[q]) if q in bound else \
                     ("fixed value" if q in literal else
                      ("narrative" if q in narrative else
                       ("box only, unbound" if q in slots else "NOT IN TEMPLATE")))
            mand, rule = mandatory(q)
            out.append({"role": role, "section": f"[{role}] {label}", "q": q,
                        "label": labels.get(q, ""), "type": e["type"].replace("ItemType", ""),
                        "period": e.get("period", ""), "mandatory": mand, "rule": rule,
                        "status": status, "field": bound.get(q, ""),
                        "have": status.startswith(("bound", "fixed", "narrative"))})
    return out, rules, unmatched


# ── report ──────────────────────────────────────────────────────────────────

def main(out_path=None):
    out_path = out_path or os.path.expanduser("~/Desktop/01. Demo Data/MBRS Gap Analysis/MBRS_Analysis.xlsx")
    facts, per, seen = compare()
    reqs, rules, unmatched = requirements()

    tot_exp = sum(a for _, a, _ in per.values())
    tot_right = sum(r for _, _, r in per.values())
    outcomes = Counter(f["Outcome"] for f in facts if f["Outcome"] != "right")
    n_report = len(reqs)
    n_have = sum(1 for r in reqs if r["have"])
    mand = [r for r in reqs if r["mandatory"] == "required"]
    cond = [r for r in reqs if r["mandatory"].startswith("required if")]
    n_mand_have = sum(1 for r in mand if r["have"])

    # join: what the taxonomy says × what the filings showed
    for r in reqs:
        ev = seen.get(r["q"])
        r["used_by"] = ", ".join(sorted(ev["filings"])) if ev else ""
        r["evidence"] = ("correct in every filing that used it" if ev and ev["right"] and not (ev["wrong"] or ev["blank"] or ev["nobox"])
                         else "figure differs" if ev and ev["wrong"]
                         else "left empty" if ev and ev["blank"]
                         else "no box when a filing used it" if ev and ev["nobox"]
                         else "" if ev else "never used by a sample filing")

    latent = [r for r in reqs if not r["have"] and not r["used_by"]]
    latent_mand = [r for r in latent if r["mandatory"] == "required"]

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise SystemExit("openpyxl required")
    wb = Workbook()
    B = Font(bold=True)
    grn, amb, red, grey = (PatternFill("solid", fgColor=c) for c in ("D5F0DC", "FDF2D0", "FADBD8", "EFEFF2"))

    # 1 — summary
    ws = wb.active
    ws.title = "Summary"
    ws.append(["MBRS analysis — SSM FS-MPERS"]); ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    ws.append(["1. Can we reproduce a filing SSM already accepted?"]); ws["A3"].font = B
    ws.append(["Measured fact by fact against the accepted XML for the same company."])
    ws.append(["Filing", "Kind", "Boxes in SSM's filing", "We match", "Accuracy"])
    for n, (k, a, r) in per.items():
        ws.append([n, k, a, r, round(100 * r / a, 1)])
    ws.append(["TOTAL", "", tot_exp, tot_right, round(100 * tot_right / tot_exp, 1)])
    ws.append([])
    ws.append(["Remaining differences", "Count", "Whose problem"]); ws[f"A{ws.max_row}"].font = B
    whose = {"Wording never matches exactly": "nobody — right in meaning",
             "No box in the form for it": "the template (see question 2)",
             "Figure still differs": "extraction",
             "Box exists, we left it empty": "extraction",
             "Needs a person to enter": "the filer — never in the accounts"}
    for k, v in outcomes.most_common():
        ws.append([k, v, whose.get(k, "")])
    ws.append([])
    ws.append(["2. Can we produce everything SSM's form allows and requires?"]); ws[f"A{ws.max_row}"].font = B
    ws.append(["Measured against the FS-MPERS taxonomy — the authoritative field set."])
    ws.append(["Reportable concepts in our filing profile", n_report])
    ws.append(["…we can produce", n_have, f"{round(100*n_have/n_report,1)}%"])
    ws.append(["Required unconditionally (a business rule names it)", len(mand)])
    ws.append(["…we can produce", n_mand_have, f"{round(100*n_mand_have/len(mand),1) if mand else 0}%"])
    ws.append(["Required only when a condition holds (e.g. a third director signed)", len(cond)])
    ws.append(["…we can produce", sum(1 for r in cond if r["have"])])
    ws.append(["Rule items that matched no concept exactly — see 'Unmatched rule items'", len(unmatched)])
    ws.append([])
    ws.append(["Latent gap: in the taxonomy, no box, no sample filing used it", len(latent)])
    ws.append(["…of which mandatory", len(latent_mand)])
    ws.append([])
    ws.append(["Why the two numbers differ"]); ws[f"A{ws.max_row}"].font = B
    for line in [
        "Question 1 is bounded by what three companies happened to report; question 2 is not.",
        "A template derived from sample filings scores well on the first and badly on the second,",
        "because it only ever contained the boxes those filers used. The concepts in the latent gap",
        "are invisible to question 1 and would surface the first time a differently-shaped company files.",
    ]:
        ws.append([line])
    ws.column_dimensions["A"].width = 62
    for c in ("B", "C", "D", "E"):
        ws.column_dimensions[c].width = 16

    # 2 — coverage by section, both dimensions
    ws2 = wb.create_sheet("Coverage by section")
    ws2.append(["Section", "Reportable", "We produce", "Coverage", "Mandatory", "Mandatory covered",
                "Used by a sample filing", "Latent (no box, unseen)"])
    bysec = defaultdict(list)
    for r in reqs:
        bysec[r["section"]].append(r)
    for sec, rs in bysec.items():
        n = len(rs)
        h = sum(1 for r in rs if r["have"])
        m = [r for r in rs if r["mandatory"] == "required"]
        ws2.append([sec, n, h, round(100 * h / n, 1) if n else 0, len(m),
                    sum(1 for r in m if r["have"]), sum(1 for r in rs if r["used_by"]),
                    sum(1 for r in rs if not r["have"] and not r["used_by"])])
    for c in ws2[1]:
        c.font = B
    ws2.column_dimensions["A"].width = 52
    for row in ws2.iter_rows(min_row=2):
        cov = row[3].value or 0
        row[3].fill = grn if cov >= 80 else (amb if cov >= 50 else red)

    # 3 — every concept, joined
    ws3 = wb.create_sheet("Requirements")
    ws3.append(["Section", "Concept", "Label", "Type", "Period", "Requirement", "Rule",
                "Our status", "Field", "Used by", "Evidence from filings"])
    for r in reqs:
        ws3.append([r["section"], r["q"], r["label"], r["type"], r["period"], r["mandatory"], r["rule"],
                    r["status"], r["field"], r["used_by"], r["evidence"]])
    for c in ws3[1]:
        c.font = B
    for row in ws3.iter_rows(min_row=2):
        st = row[7].value or ""
        row[7].fill = grn if st.startswith(("bound", "fixed", "narrative")) else (amb if "box only" in st else red)
        if row[5].value:
            row[5].fill = amb
    ws3.auto_filter.ref = ws3.dimensions
    ws3.freeze_panes = "A2"
    for col, w in (("A", 40), ("B", 46), ("C", 46), ("G", 26), ("H", 22), ("I", 26), ("J", 30)):
        ws3.column_dimensions[col].width = w

    # 4 — priority: what to build next
    ws4 = wb.create_sheet("Priority")
    ws4.append(["Priority", "Section", "Label", "Concept", "Why"])
    for r in mand:
        if not r["have"]:
            ws4.append(["1 — required, missing", r["section"], r["label"], r["q"],
                        f"Business rule {r['rule']} requires it; no box in our template"])
    for r in cond:
        if not r["have"]:
            ws4.append(["1b — required when applicable", r["section"], r["label"], r["q"],
                        f"Rule {r['rule']}: {r['mandatory']}"])
    for r in reqs:
        if not r["have"] and r["used_by"]:
            ws4.append(["2 — a real filing used it", r["section"], r["label"], r["q"],
                        f"Used by {r['used_by']}; no box in our template"])
    for r in latent:
        if not r["mandatory"]:
            ws4.append(["3 — latent", r["section"], r["label"], r["q"],
                        "In the form; no sample filing used it, so untested"])
    for c in ws4[1]:
        c.font = B
    ws4.auto_filter.ref = ws4.dimensions
    ws4.freeze_panes = "A2"
    for col, w in (("A", 24), ("B", 40), ("C", 50), ("D", 46), ("E", 56)):
        ws4.column_dimensions[col].width = w
    for row in ws4.iter_rows(min_row=2):
        p = str(row[0].value)
        row[0].fill = red if p.startswith("1 ") else (amb if p.startswith(("1b", "2")) else grey)

    # 5 — box by box
    ws5 = wb.create_sheet("Box by box")
    ws5.append(["Filing", "Kind", "Result", "Concept", "Context", "SSM value", "Our value"])
    for f in facts:
        ws5.append([f["Filing"], f["Kind"], f["Outcome"], f["Concept"], f["Context"], f["SSM value"], f["Our value"]])
    for c in ws5[1]:
        c.font = B
    for row in ws5.iter_rows(min_row=2):
        row[2].fill = grn if row[2].value == "right" else red
    ws5.auto_filter.ref = ws5.dimensions
    ws5.freeze_panes = "A2"
    for col, w in (("D", 46), ("E", 34), ("F", 40), ("G", 40)):
        ws5.column_dimensions[col].width = w

    # 6 — rule items with no exact concept match: map by hand, never guessed
    wsu = wb.create_sheet("Unmatched rule items")
    wsu.append(["Rule", "Section", "Item as written", "Conditional", "Condition"])
    for it in unmatched:
        wsu.append([it["rule"], it["elr"], it["item"], "yes" if it["conditional"] else "", it["condition"][:120]])
    for c in wsu[1]:
        c.font = B
    wsu.auto_filter.ref = wsu.dimensions
    for col, w in (("A", 26), ("B", 30), ("C", 80), ("E", 80)):
        wsu.column_dimensions[col].width = w

    # 7 — business rules
    ws6 = wb.create_sheet("Business rules")
    ws6.append(["Rule ID", "Section", "Severity", "Requirement"])
    for ru in rules:
        ws6.append([ru["id"], ru["elr"], ru["sev"], ru["text"]])
    for c in ws6[1]:
        c.font = B
    ws6.auto_filter.ref = ws6.dimensions
    for col, w in (("A", 28), ("B", 32), ("D", 110)):
        ws6.column_dimensions[col].width = w
    for row in ws6.iter_rows(min_row=2):
        row[3].alignment = Alignment(wrap_text=False)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)

    print(f"wrote {out_path}\n")
    print("1. Reproducing accepted filings")
    for n, (k, a, r) in per.items():
        print(f"   {n:14} {k:9} {r:>5}/{a:<5} {100*r/a:5.1f}%")
    print(f"   {'TOTAL':14} {'':9} {tot_right:>5}/{tot_exp:<5} {100*tot_right/tot_exp:5.1f}%")
    for k, v in outcomes.most_common():
        print(f"      {v:>4}  {k}")
    print(f"\n2. Taxonomy coverage (FS-MPERS, our filing profile)")
    print(f"   reportable concepts {n_report:>5}   we produce {n_have:>5}  {100*n_have/n_report:5.1f}%")
    print(f"   required            {len(mand):>5}   we produce {n_mand_have:>5}  {100*n_mand_have/len(mand) if mand else 0:5.1f}%")
    print(f"   required-if         {len(cond):>5}   we produce {sum(1 for r in cond if r['have']):>5}")
    print(f"   rule items with no exact concept match: {len(unmatched)}")
    print(f"   latent (no box, never seen in a sample) {len(latent):>5}   of which mandatory {len(latent_mand)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
