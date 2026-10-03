"""The three NDA types (29 Sep review): mutual, the Company discloses, the
Counterparty discloses. The one-way templates are derived from the mutual one
so every shared clause stays identical; only who discloses changes. Also sets
the 3-year default term on all three.

    python3 scripts/gen-ccms-nda-variants.py && python3 scripts/gen-ccms-templates.py
"""
import copy, json, os

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "lib", "ccms-templates")
MUTUAL = os.path.join(SRC, "lsh-nda-mutual.json")


def three_years(t):
    for it in t["schedule"]["items"]:
        if it["number"] == "5":
            it["value"] = "[Three (3) years] from the Date of Agreement"
    for c in t["clauses"]:
        if c["number"] == "10":
            c["keyPosition"] = c["keyPosition"].replace("default 2 years", "default 3 years")


def one_way(base, *, id, code, title, discloser, recipient, direction, recital, usage, scrutiny):
    t = copy.deepcopy(base)
    t.update(id=id, code=code, title=title, usageNote=usage)
    t["recitals"][1] = recital
    t["assumptions"][1] = f"One-way: only the {discloser} discloses Confidential Information; the {recipient} is the Receiving Party. {scrutiny}"
    for c in t["clauses"]:
        if c["number"] == "1":
            c["paragraphs"] = [
                (f'"Disclosing Party" means the {discloser}, and "Receiving Party" means the {recipient}; only the {discloser} discloses Confidential Information under this Agreement.'
                 if p.startswith('"Disclosing Party"') else p) for p in c["paragraphs"]]
    for it in t["schedule"]["items"]:
        if it["number"] == "4":
            it["value"] = direction
    return t


base = json.load(open(MUTUAL, encoding="utf-8"))
three_years(base)
json.dump(base, open(MUTUAL, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

variants = [
    one_way(base, id="lsh-nda-company-discloses", code="LSH-CMS-T02", title="Non-Disclosure Agreement (Company Discloses)",
            discloser="Company", recipient="Counterparty", direction="Company to Counterparty only",
            recital="The Company wishes to disclose Confidential Information to the Counterparty for the Purpose described in Schedule 1, and the Counterparty is willing to receive it on the terms of this Agreement.",
            usage="Use when only the Lim Seong Hai group shares confidential information — e.g. tender documents, drawings or pricing given to a vendor, subcontractor or consultant to quote. Complete Schedule 1 only. Any change to a clause marked LOCKED, or removal of a MANDATORY clause, is a deviation and routes the draft to Legal vetting.",
            scrutiny="Review strictly: the Counterparty's duties as recipient must stay at least as strong as the template's."),
    one_way(base, id="lsh-nda-counterparty-discloses", code="LSH-CMS-T03", title="Non-Disclosure Agreement (Counterparty Discloses)",
            discloser="Counterparty", recipient="Company", direction="Counterparty to Company only",
            recital="The Counterparty wishes to disclose Confidential Information to the Company for the Purpose described in Schedule 1, and the Company is willing to receive it on the terms of this Agreement.",
            usage="Use when only the counterparty shares confidential information with the Lim Seong Hai group — e.g. a technology vendor's product details or a landowner's plans. Complete Schedule 1 only. Any change to a clause marked LOCKED, or removal of a MANDATORY clause, is a deviation and routes the draft to Legal vetting.",
            scrutiny="Review to limit the Company's own obligations as recipient: no wider duties, longer survival or uncapped remedies than the template."),
]
for v in variants:
    json.dump(v, open(os.path.join(SRC, f"{v['id']}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("wrote", v["id"])
