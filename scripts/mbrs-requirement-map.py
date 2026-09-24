"""Map SSM's FS-MPERS taxonomy against what our system can actually produce.

    python3 scripts/mbrs-requirement-map.py <SSMxT_2022v1.0 dir> <business-rules.xlsx> [out.xlsx]

The taxonomy — not a sample filing — is the authoritative statement of what a
submission may and must contain. An mTool export only shows the fields that
company happened to use, which is how a template derived from three filings
ended up missing boxes SSM requires. This walks the FS-MPERS entry point's
presentation tree, marks each concept mandatory where a business rule names it,
and records whether our schema binds it, so the gap is a list rather than an
impression.

Outputs a workbook: one row per concept per section, plus a coverage summary.
"""
import sys, os, re, json, glob
from collections import defaultdict
import xml.etree.ElementTree as ET

XL = "{http://www.w3.org/1999/xlink}"
LK = "{http://www.xbrl.org/2003/linkbase}"
XS = "{http://www.w3.org/2001/XMLSchema}"
XB = "{http://www.xbrl.org/2003/instance}"
XBRLDT = "{http://xbrl.org/2005/xbrldt}"

NSP = {
    "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mpers-cor": "ssmt-mpers",
    "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-cor": "ssmt",
    "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-core": "ssmt-dei",
    "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-ee-mpers": "ssmt-dei-ee-mpers",
    "http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mfrs-cor": "ssmt-mfrs",
    "https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-smes": "ifrs-smes",
    "https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-full": "ifrs-full",
}

# The filing profile this system serves: by-function P&L, current/non-current
# balance sheet, indirect cash flow, separate (unconsolidated) entity. The
# alternative layouts are real taxonomy sections but out of scope, and counting
# them as gaps would overstate the shortfall.
PROFILE_ROLES = {
    "020000": "Scope of filing",
    "120000": "Directors report",
    "120100": "Statement by directors",
    "130000": "Auditors report",
    "200100": "Statement of financial position",
    "200200": "Sub-classification of assets, liabilities and equity",
    "210000": "Statement of financial position (current/non-current)",
    "210100": "Sub-classification (current/non-current)",
    "300100": "Statement of income and expenditure",
    "300200": "Analysis of income and expense",
    "310000": "Profit or loss, by function",
    "310100": "Analysis of profit or loss, by function",
    "500100": "Statement of cash flows",
    "520000": "Cash flows, indirect method",
    "610000": "Statement of changes in equity",
    "620000": "Statement of retained earnings",
    "710000": "Notes - Corporate information",
    "720000": "Notes - Accounting policies",
    "730000": "Notes - List of notes",
    "740000": "Notes - Issued capital",
    "750000": "Notes - Related party transactions",
}
OUT_OF_PROFILE = {
    "220000": "by liquidity", "220100": "by liquidity", "320000": "by nature",
    "320100": "by nature", "510000": "direct method", "400100": "OCI",
    "410000": "OCI net of tax", "420000": "OCI before tax", "300100a": "gross profit variant",
    "300100b": "operating profit variant", "300100c": "attributable variant",
}


def parse_elements(root):
    """Every concept in the DTS: qname -> type, period, abstract, balance."""
    elems = {}
    for xsd in glob.glob(f"{root}/**/*.xsd", recursive=True):
        try:
            r = ET.parse(xsd).getroot()
        except Exception:
            continue
        pfx = NSP.get(r.get("targetNamespace"))
        if not pfx:
            continue
        for e in r.iter(f"{XS}element"):
            n, i = e.get("name"), e.get("id")
            if not n or not i:
                continue
            elems[i] = {
                "q": f"{pfx}:{n}",
                "type": (e.get("type") or "").split(":")[-1],
                "period": e.get(f"{XB}periodType") or "",
                "abstract": e.get("abstract") == "true",
                "balance": e.get(f"{XB}balance") or "",
            }
    return elems


ALL_LABELS = defaultdict(set)  # concept -> every English label, any role


def parse_labels(root, byid):
    """English labels from the core and entry-point label files.

    Returns the standard label per concept, and records every other role
    (total, net, and the "Reporting…" labels mTool shows on screen) in
    ALL_LABELS — SSM's business rules are written in mTool's wording, so
    matching them needs those roles, not just the standard label."""
    labels = {}
    files = (glob.glob(f"{root}/def/**/lab_en*.xml", recursive=True)
             + glob.glob(f"{root}/def/**/lab_*-en_*.xml", recursive=True)
             + glob.glob(f"{root}/rep/**/lab_en-*.xml", recursive=True))
    for lf in files:
        try:
            r = ET.parse(lf).getroot()
        except Exception:
            continue
        for ext in r.iter(f"{LK}labelLink"):
            loc = {l.get(f"{XL}label"): byid(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
            lab = defaultdict(list)
            for l in ext.iter(f"{LK}label"):
                lab[l.get(f"{XL}label")].append((l.get(f"{XL}role", "").split("/")[-1], (l.text or "").strip()))
            for a in ext.iter(f"{LK}labelArc"):
                q = loc.get(a.get(f"{XL}from"))
                for role, txt in lab.get(a.get(f"{XL}to"), []):
                    if not q or not txt:
                        continue
                    ALL_LABELS[q].add(txt)
                    if role == "label" and q not in labels:
                        labels[q] = txt
    return labels


def parse_presentation(mp, byid):
    """role -> ordered [(concept, depth, parent)] from the presentation tree."""
    out = {}
    for f in sorted(glob.glob(f"{mp}/pre_*role-*.xml")):
        role = re.search(r"role-(\w+)\.xml", f).group(1)
        try:
            r = ET.parse(f).getroot()
        except Exception:
            continue
        for ext in r.iter(f"{LK}presentationLink"):
            loc = {l.get(f"{XL}label"): byid(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
            kids = defaultdict(list)
            children = set()
            for a in ext.iter(f"{LK}presentationArc"):
                p, c = loc.get(a.get(f"{XL}from")), loc.get(a.get(f"{XL}to"))
                if not p or not c:
                    continue
                kids[p].append((float(a.get("order", "0")), c))
                children.add(c)
            roots = [p for p in kids if p not in children]
            seq = []
            seen = set()

            def walk(node, depth, parent):
                if (node, depth) in seen or depth > 12:
                    return
                seen.add((node, depth))
                seq.append((node, depth, parent))
                for _o, c in sorted(kids.get(node, [])):
                    walk(c, depth + 1, node)

            for rt in sorted(roots):
                walk(rt, 0, "")
            out.setdefault(role, []).extend(seq)
    return out


def parse_dimensions(mp, byid):
    """concept -> set of axes it is reported across (from the definition linkbases)."""
    dims = defaultdict(set)
    for f in sorted(glob.glob(f"{mp}/def_*role-*.xml")):
        try:
            r = ET.parse(f).getroot()
        except Exception:
            continue
        for ext in r.iter(f"{LK}definitionLink"):
            loc = {l.get(f"{XL}label"): byid(l.get(f"{XL}href")) for l in ext.iter(f"{LK}loc")}
            hyper, axes = [], []
            for a in ext.iter(f"{LK}definitionArc"):
                role = (a.get(f"{XL}arcrole") or "").split("/")[-1]
                frm, to = loc.get(a.get(f"{XL}from")), loc.get(a.get(f"{XL}to"))
                if role == "hypercube-dimension" and to:
                    axes.append(to)
                elif role == "all" and frm:
                    hyper.append(frm)
            if axes:
                for h in hyper:
                    dims[h].update(axes)
    return dims


# Which presentation roles a business rule's section ("ELR name") refers to.
# A rule's named items are matched only against concepts in these roles, so a
# rule about the face of the income statement cannot claim a note text block
# that merely shares a word with it.
ELR_ROLES = {
    "filing information": None,  # DEI concepts — matched across the whole DTS
    "scope of filing": {"020000"},
    "directors report": {"120000"},
    "statement by directors": {"120100"},
    "director business review": {"120200"},
    "auditors report to members": {"130000"},
    "statement of financial position": {"200100", "200200", "210000", "210100"},
    "statement of profit or loss": {"300100", "300200", "310000", "310100"},
    "statement of cash flows": {"500100", "520000"},
    "statement of changes in equity": {"610000"},
    "statement of retained earnings": {"620000"},
    "corporate information": {"710000"},
    "summary of significant accounting policies": {"720000"},
    "issued capital": {"740000"},
    "related party transactions": {"750000"},
}
# MPERS lets a company present a statement of retained earnings INSTEAD of a
# statement of changes in equity; this system files the latter, so the former's
# rules do not bind it.
ALTERNATIVE_STATEMENTS = {"statement of retained earnings"}


_STOP = {"the", "a", "an"}


def _norm(t):
    """Normalise wording so mTool's phrasing and the taxonomy's labels compare
    equal when they name the same thing: case, quotes, apostrophes, articles,
    "(text block)" vs "[text block]", and a trailing plural s. Matching stays
    exact after this — no substring or similarity scoring."""
    t = (t or "").lower()
    t = re.sub(r"[\u2018\u2019'`]", "", t)
    t = re.sub(r"\(text block\)|\[text block\]", " text block ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    words = [w for w in t.split() if w not in _STOP]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words]
    return " ".join(words)


_ORD = r"(?:first|second|third|fourth|fifth)"


def mandatory_concepts(xlsx):
    """The FS-MPERS business rules, each parsed into the items it requires.

    Returns (rules, items): every rule, and for the presence rules the list of
    {rule, elr, item, conditional, condition} to be matched to concepts by
    exact label. Rules that compare values ("must be greater than") are
    validation, not presence, and name no required item.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return [], []
    wb = load_workbook(xlsx, read_only=True, data_only=True)
    if "FS-MPERS - CA2016" not in wb.sheetnames:
        return [], []
    rules, items = [], []
    for r in wb["FS-MPERS - CA2016"].iter_rows(min_row=3, values_only=True):
        if not r or not r[2]:
            continue
        cells = list(r) + [None] * 8
        elr, rid, en, sev = str(cells[1] or ""), str(cells[2]), str(cells[4] or ""), str(cells[6] or "")
        if not en:
            continue
        rules.append({"id": rid, "elr": elr, "sev": sev, "text": en})
        txt = en.replace("\u201c", '"').replace("\u201d", '"')
        if not re.search(r"must\s+be\s+reported|mandatory\s+to\s+be\s+reported|is\s+mandatory", txt, re.I):
            continue
        # Group-only obligations do not bind a separate-entity filing.
        if re.search(r'selects\s+"?group"?', txt, re.I):
            continue
        cond = re.match(r"^\s*(?:when|if)\b(.*?)\bthen\b(.*)$", txt, re.I | re.S)
        # "X must be reported if Y" — the condition trails the obligation.
        trail = re.search(r"(?:must\s+be\s+reported|mandatory\s+to\s+be\s+reported)\s+(?:if|when)\b(.*)$", txt, re.I | re.S)
        if cond:
            condition, body = cond.group(1).strip(), cond.group(2)
        elif trail:
            condition, body = trail.group(1).strip(), txt[: trail.start()] + " MUST be reported"
        else:
            condition, body = "", txt
        body = re.split(r"(?:->)?\s*(?:must|is)\s+(?:be\s+reported|mandatory)", body, flags=re.I)[0]
        body = re.sub(r"^\s*error:\s*", "", body, flags=re.I)
        # "… for first, second and third director" names which directors the
        # generic items apply to; lift it out before splitting the list.
        ords = []
        tail = re.search(rf"\bfor\s+((?:{_ORD}[\s,]*(?:and\s+)?)+)director\b", body, re.I)
        if tail:
            ords = re.findall(_ORD, tail.group(1), re.I)
            body = body[: tail.start()] + body[tail.end():]
        whole = re.sub(r'["\u201c\u201d]', "", body).strip().strip(".").strip()
        parts = [p.strip().strip(".").strip() for p in re.split(r'["\u201c\u201d]|,', body)]
        parts = [p for p in parts if len(p) > 3 and not re.fullmatch(rf"(?:and\s+)?(?:{_ORD}|and|for|director|\s)+", p, re.I)]

        def expand(text):
            if not ords or "director" not in text.lower():
                return [text]
            g = re.sub(r"\b(?:of\s+)?(?:the\s+)?(?:first\s+)?director\b", lambda m: ("of " if m.group(0).lower().startswith("of") else "") + "{ORD} director", text, count=1, flags=re.I)
            return [g.replace("{ORD}", o.lower()) for o in dict.fromkeys(x.lower() for x in ords)]

        items.append({"rule": rid, "elr": elr, "whole": expand(whole), "parts": [e for p in parts for e in expand(p)],
                      "conditional": bool(condition), "condition": condition})
    return rules, items


def match_requirements(items, pres, labels):
    """Exact (normalised) label match against every label role, scoped to each
    rule's own section. A rule's whole phrase is tried first — "Disclosure of
    occurrence of any substantial, material or unusual…" is one item that
    happens to contain commas — and only if that fails is it split into a list.

    Returns concept -> {rule, conditional, condition, alternative}, plus the
    items that matched nothing, for a person to map by hand."""
    by_role = defaultdict(dict)
    every = {}
    for role, seq in pres.items():
        for q, _d, _p in seq:
            for lab in ALL_LABELS.get(q, set()) | {labels.get(q, "")}:
                k = _norm(lab)
                if k:
                    by_role[role].setdefault(k, q)
    # Filing-information (DEI) concepts are presented outside the FS-MPERS
    # roles, so an unscoped rule is matched against every labelled concept.
    for q, labs in ALL_LABELS.items():
        for lab in labs:
            k = _norm(lab)
            if k:
                every.setdefault(k, q)
    req, unmatched = {}, []

    def put(q, it, elr):
        entry = {"rule": it["rule"], "conditional": it["conditional"], "condition": it["condition"],
                 "alternative": elr in ALTERNATIVE_STATEMENTS}
        prev = req.get(q)
        if not prev or (prev["conditional"] and not entry["conditional"]):
            req[q] = entry

    for it in items:
        elr = it["elr"].strip().lower()
        roles = ELR_ROLES.get(elr, "unknown")
        cands = every if roles is None or roles == "unknown" else \
            {k: v for r in roles for k, v in by_role.get(r, {}).items()}
        hits = [cands.get(_norm(w)) for w in it["whole"]]
        if all(hits):
            for q in hits:
                put(q, it, elr)
            continue
        for p in it["parts"]:
            q = cands.get(_norm(p))
            if q:
                put(q, it, elr)
            else:
                unmatched.append({"rule": it["rule"], "elr": it["elr"], "item": p,
                                  "conditional": it["conditional"], "condition": it["condition"]})
    return req, unmatched


def main(root, rules_xlsx, out_path="MBRS_Requirement_Map.xlsx"):
    root = root.rstrip("/")
    mp = f"{root}/rep/ssm/ca-2016/fs/mpers"
    elems = parse_elements(root)
    by_q = {v["q"]: v for v in elems.values()}

    def byid(href):
        i = (href or "").split("#")[-1]
        return elems.get(i, {}).get("q", i)

    labels = parse_labels(root, byid)
    pres = parse_presentation(mp, byid)
    dims = parse_dimensions(mp, byid)
    rules, items = mandatory_concepts(rules_xlsx)
    req, unmatched = match_requirements(items, pres, labels)

    # our side
    proj = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # Parsed line by line: context tokens contain braces ({CE}, {PS}), so a
    # regex bounded by "[^}]" silently matches nothing.
    tmpl = open(f"{proj}/src/lib/mbrs-template.ts", encoding="utf-8").read()
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

    def is_mandatory(q):
        r = req.get(q)
        if not r or r["alternative"]:
            return ""
        return r["rule"] + (" (if " + r["condition"][:60] + ")" if r["conditional"] else "")

    rows, summary = [], []
    for role, label in PROFILE_ROLES.items():
        seq = pres.get(role) or []
        if not seq:
            continue
        n_total = n_report = n_have = n_mand = n_mand_have = 0
        for q, depth, parent in seq:
            e = by_q.get(q, {})
            if e.get("abstract"):
                continue
            t = e.get("type", "")
            reportable = bool(t) and not e.get("abstract")
            mand = is_mandatory(q)
            have = q in bound or q in literal or q in narrative
            status = ("bound to " + bound[q]) if q in bound else \
                     ("fixed value" if q in literal else
                      ("narrative" if q in narrative else
                       ("box only, unbound" if q in slots else "NOT IN TEMPLATE")))
            n_total += 1
            if reportable:
                n_report += 1
            if have:
                n_have += 1
            if mand and "(if " not in mand:
                n_mand += 1
                if have:
                    n_mand_have += 1
            rows.append({
                "Section": f"[{role}] {label}",
                "Concept": q,
                "Label": labels.get(q, ""),
                "Depth": depth,
                "Type": t.replace("ItemType", ""),
                "Period": e.get("period", ""),
                "Dimensions": ", ".join(sorted(a.split(":")[-1] for a in dims.get(q, set())))[:80],
                "Mandatory (rule)": mand,
                "Our status": status,
                "Field": bound.get(q, ""),
            })
        summary.append({
            "Section": f"[{role}] {label}", "Concepts": n_total, "Reportable": n_report,
            "We produce": n_have, "Coverage": round(100 * n_have / n_report, 1) if n_report else 0,
            "Mandatory": n_mand, "Mandatory covered": n_mand_have,
        })

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        wb = Workbook()
        ws = wb.active
        ws.title = "Coverage by section"
        ws.append(list(summary[0].keys()) if summary else ["Section"])
        for s in summary:
            ws.append(list(s.values()))
        tot_r = sum(s["Reportable"] for s in summary)
        tot_h = sum(s["We produce"] for s in summary)
        tot_m = sum(s["Mandatory"] for s in summary)
        tot_mh = sum(s["Mandatory covered"] for s in summary)
        ws.append(["TOTAL", "", tot_r, tot_h, round(100 * tot_h / tot_r, 1) if tot_r else 0, tot_m, tot_mh])
        ws2 = wb.create_sheet("All concepts")
        ws2.append(list(rows[0].keys()) if rows else ["Concept"])
        for r in rows:
            ws2.append(list(r.values()))
        red = PatternFill("solid", fgColor="FADBD8")
        grn = PatternFill("solid", fgColor="D5F0DC")
        amb = PatternFill("solid", fgColor="FDF2D0")
        for row in ws2.iter_rows(min_row=2):
            st = row[8].value or ""
            row[8].fill = grn if st.startswith(("bound", "fixed", "narrative")) else (amb if "box only" in st else red)
        for w in (ws, ws2):
            for c in w[1]:
                c.font = Font(bold=True)
        ws2.auto_filter.ref = ws2.dimensions
        ws2.freeze_panes = "A2"
        ws3 = wb.create_sheet("Business rules")
        ws3.append(["Rule ID", "Section", "Severity", "Requirement"])
        for ru in rules:
            ws3.append([ru["id"], ru["elr"], ru["sev"], ru["text"]])
        for c in ws3[1]:
            c.font = Font(bold=True)
        ws3.auto_filter.ref = ws3.dimensions
        wb.save(out_path)
        print(f"wrote {out_path}")
    except ImportError:
        print("openpyxl not available — summary only")

    print(f"\n{'section':58} {'report':>6} {'ours':>5} {'cov':>6} {'mand':>5} {'m.cov':>6}")
    for s in summary:
        print(f"{s['Section'][:58]:58} {s['Reportable']:>6} {s['We produce']:>5} {s['Coverage']:>5}% {s['Mandatory']:>5} {s['Mandatory covered']:>6}")
    print(f"{'TOTAL':58} {tot_r:>6} {tot_h:>5} {round(100*tot_h/tot_r,1) if tot_r else 0:>5}% {tot_m:>5} {tot_mh:>6}")
    print(f"\nOut-of-profile sections not counted: {', '.join(sorted(OUT_OF_PROFILE))}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
