"""Demo drafts for the Commercial CMS review, built from the approved template.

    python3 scripts/gen-ccms-demo-docs.py [out_dir]

  1. NDA-clean          — the template, Schedule 1 completed. Should match.
  2. NDA-counterparty   — the same NDA as a counterparty sends it back, with
                          known deviations (listed in the doc's properties):
                          ABMS clause deleted (locked), governing law moved to
                          Singapore, a pre-fixed sum for breach (penalty,
                          s.75), survival cut to 1 year, the offshore-transfer
                          bar removed, and a new "use to improve products"
                          clause added.
  3. LOA-piling         — a Letter of Award missing retention, the performance
                          bond, LAD and the ABMS clause.

The deviations are the answer key: a review that misses one is a finding.
"""
import copy, json, os, sys
from importlib import util

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/01. Demo Data/Commercial CMS")
spec = util.spec_from_file_location("gen", f"{PROJ}/scripts/gen-ccms-templates.py")
gen = util.module_from_spec(spec); spec.loader.exec_module(gen)
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

BASE = json.load(open(f"{PROJ}/src/lib/ccms-templates/lsh-nda-mutual.json", encoding="utf-8"))
SCHEDULE = {
    "1": "1 October 2026",
    "2": "Evaluation and preparation of a proposal for the supply, implementation and support of a project-management and document-control system for the Group's construction projects.",
    "3": "Lim Seong Hai Capital Berhad",
    "4": "Mutual",
    "5": "Two (2) years from the Date of Agreement",
    "6": "Head of Group IT, Wisma Lim Seong Hai, Kuala Lumpur, it.contracts@example.com",
    "7": "Chief Executive Officer, Awan Digital Solutions Sdn Bhd, Petaling Jaya, legal@awan-digital.example",
    "8": "Counterparty",
    "9": "Courts of Malaysia",
    "10": "No",
}


def fill(t, cp="AWAN DIGITAL SOLUTIONS SDN BHD (Registration No. 202001056789), a company incorporated in Malaysia with its registered address at Level 8, Menara Awan, Petaling Jaya, Selangor"):
    t = copy.deepcopy(t)
    t["parties"]["company"] = t["parties"]["company"].replace("(Registration No. [●])", "(Registration No. 202001012345)").replace("at [●]", "at Wisma Lim Seong Hai, Kuala Lumpur")
    t["parties"]["counterparty"] = cp + " (the \"Counterparty\")"
    for it in t["schedule"]["items"]:
        it["value"] = SCHEDULE.get(it["number"], it["value"])
    for c in t["clauses"]:
        c["paragraphs"] = [p.replace("[●]", "whistleblowing@limseonghai.example") for p in c["paragraphs"]]
    t["execution"]["blocks"][1]["party"] = "AWAN DIGITAL SOLUTIONS SDN BHD"
    return t


def render(t, path, drop_usage=True, core_note=""):
    doc = Document()
    gen.base_styles(doc)
    gen.header_footer(doc, t)
    gen.body(doc, t)
    gen.schedule(doc, t)
    gen.execution(doc, t)
    if core_note:
        doc.core_properties.comments = core_note
    doc.save(path)


def counterparty_version(t):
    t = copy.deepcopy(t)
    cl = {c["id"]: c for c in t["clauses"]}
    # (a) locked ABMS clause deleted outright
    t["clauses"] = [c for c in t["clauses"] if c["id"] != "anti_corruption"]
    # (b) governing law and forum moved offshore
    cl["governing_law"]["paragraphs"] = [
        "19.1 This Agreement is governed by the laws of Singapore.",
        "19.2 Any dispute arising out of or in connection with this Agreement shall be referred to and finally resolved by arbitration administered by the Singapore International Arbitration Centre, seated in Singapore.",
    ]
    # (c) a pre-fixed sum for breach, and a liability cap
    cl["remedies"]["paragraphs"] = [
        "11.1 In the event of any breach of this Agreement, the Receiving Party shall pay the Disclosing Party the sum of RM500,000 for each breach as agreed damages, which the Parties agree is a genuine pre-estimate of loss.",
        "11.2 The total liability of the Counterparty under or in connection with this Agreement shall not exceed RM50,000 in aggregate.",
    ]
    # (d) survival cut to one year, no carve-outs
    cl["term"]["paragraphs"][1] = "10.2 The obligations in this Agreement continue for one (1) year after its termination or expiry, after which they cease entirely."
    # (e) the bar on transferring personal data abroad removed
    cl["personal_data"]["paragraphs"] = cl["personal_data"]["paragraphs"][:2]
    # (f) an added clause the template does not have
    idx = [c["id"] for c in t["clauses"]].index("no_licence") + 1
    t["clauses"].insert(idx, {
        "id": "x_use", "number": "8A", "title": "Use of aggregated information", "mandatory": False, "locked": False, "keyPosition": "",
        "paragraphs": ["8A.1 Notwithstanding clause 2, the Counterparty may use Confidential Information, in anonymised or aggregated form, to develop, train and improve its products and services, and may retain such information indefinitely."],
    })
    return t


def letter_of_award(path):
    doc = Document(); gen.base_styles(doc)
    P = lambda txt, **k: gen.para(doc, txt, **k)
    P("LSH BEST BUILDERS SDN BHD", bold=True, size=12, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0)
    P("Wisma Lim Seong Hai, Kuala Lumpur", size=9, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)
    P("Our ref: LSHBB/LOA/2026/0142        Date: 28 September 2026")
    P("Teguh Piling & Foundation Sdn Bhd (Registration No. 200801023456)\nNo. 12, Jalan Industri 3, Rawang, Selangor\nAttention: Mr. Tan Kok Wai, Managing Director")
    P("LETTER OF AWARD — BORED PILING WORKS, BLOCK B, LSH 33 (JOB NO. J-2026-033)", bold=True)
    P("1. We are pleased to award you the above Works on the terms of this letter and your tender dated 5 September 2026, as clarified in the tender interview minutes of 16 September 2026.")
    P("2. Scope: supply of all labour, plant and materials to install 186 nos. 900mm diameter bored piles, including pile integrity and maintained load tests, as shown in drawings LSH33-ST-B-101 to 118.")
    P("3. Contract sum: RM3,480,000.00 (Ringgit Malaysia Three Million Four Hundred and Eighty Thousand) on a remeasurement basis, exclusive of SST.")
    P("4. Commencement on 12 October 2026; completion within twenty (20) weeks, by 1 March 2027.")
    P("5. Payment: monthly progress claims, certified by our Project Quantity Surveyor within 21 days and paid within 30 days of certification, subject to our receiving payment from the Employer for the corresponding works.")
    P("6. Insurance: you shall maintain workmen's compensation and SOCSO cover for all your workers. Contractor's All Risks cover is provided by the Main Contractor.")
    P("7. Defects liability period: twelve (12) months from practical completion of the Works.")
    P("8. Please sign and return the duplicate of this letter to confirm your acceptance.")
    P("Yours faithfully,\nfor LSH BEST BUILDERS SDN BHD\n\n\n______________________\nProject Director", space_after=12)
    P("ACCEPTANCE\nWe accept the award on the terms above.\n\n______________________\nfor Teguh Piling & Foundation Sdn Bhd   Date:")
    doc.core_properties.comments = "Answer key: missing retention, performance bond / Director's Guarantee, LAD and the ABMS clause; clause 5 is a pay-when-paid term void under CIPAA 2012 s.35."
    doc.save(path)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    clean = fill(BASE)
    render(clean, f"{OUT}/1 NDA - Awan Digital - clean.docx")
    render(counterparty_version(clean), f"{OUT}/2 NDA - Awan Digital - counterparty markup.docx",
           core_note="Answer key: ABMS deleted; Singapore law and SIAC; RM500k per breach (s.75) and RM50k cap; survival 1 year; offshore-transfer bar removed; clause 8A added.")
    letter_of_award(f"{OUT}/3 Letter of Award - Teguh Piling - bored piling.docx")
    print("wrote 3 demo drafts to", OUT)
