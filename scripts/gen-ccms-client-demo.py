"""Client-contract demo pair: our tender, and the client's award for the same job.

    python3 scripts/gen-ccms-client-demo.py [out_dir]

The award departs from the tender in known ways (the answer key, also written
into the award's document properties):
  scope     — adds external drainage and a guardhouse we did not price
  price     — RM4,650,000 against our RM4,820,000
  dates     — 10 months against our 12
  lad       — RM8,000/day uncapped against our RM3,000/day capped at 10%
  insurance — retention 10% (we tendered 5%); contractor to take out CAR (we assumed the employer)
  legal     — payment conditional on the employer being paid (void under CIPAA s.35)
  esh       — unchanged (should match)
"""
import os, sys
from importlib import util
PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/01. Demo Data/Commercial CMS")
spec = util.spec_from_file_location("gen", f"{PROJ}/scripts/gen-ccms-templates.py"); gen = util.module_from_spec(spec); spec.loader.exec_module(gen)
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

JOB = "Substructure and piling works, Block C, Taman Seri Mutiara (Job No. J-2026-047)"

def doc_with(title, paras, note=None):
    d = Document(); gen.base_styles(d)
    for p in paras:
        if isinstance(p, tuple): gen.para(d, p[0], bold=True, size=p[1] if len(p) > 1 else None, align=WD_ALIGN_PARAGRAPH.CENTER if len(p) > 2 else None)
        else: gen.para(d, p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    if note: d.core_properties.comments = note
    return d

tender = doc_with("tender", [
    ("LSH BEST BUILDERS SDN BHD", 12, True), ("TENDER SUBMISSION", 11, True),
    f"Project: {JOB}",
    "Employer: Mutiara Heights Development Sdn Bhd. Submitted 18 August 2026, valid for 90 days.",
    ("1. Scope of works",), "Bored piling (320 nos. 600mm), pile caps, ground beams and ground slab for Block C, as shown in drawings MH-C-ST-001 to 024. Excludes external works, drainage and guardhouse.",
    ("2. Tender sum",), "RM4,820,000.00 lump sum, exclusive of SST. Monthly progress claims, paid within 30 days of certification.",
    ("3. Programme",), "Twelve (12) months from site possession.",
    ("4. Liquidated damages",), "RM3,000 per day, capped at 10% of the contract sum.",
    ("5. Retention and securities",), "Retention 5% (2.5% released at CPC, 2.5% at CMGD). Performance bond 5%. Contractor's All Risks insurance by the Employer.",
    ("6. Safety, health and environment",), "Work under our QESH plan to ISO 45001 and ISO 14001; site safety officer full time; CIDB Green Card for all workers.",
    ("7. Contract conditions",), "PAM Contract 2018 (without quantities); disputes by adjudication under CIPAA 2012, then arbitration at AIAC.",
])
award = doc_with("award", [
    ("MUTIARA HEIGHTS DEVELOPMENT SDN BHD", 12, True),
    "Our ref: MHD/LOA/C/2026-011        Date: 25 September 2026",
    "LSH Best Builders Sdn Bhd, Wisma Lim Seong Hai, Kuala Lumpur",
    (f"LETTER OF AWARD — {JOB}",),
    "1. We are pleased to award you the Works on the terms below, which supersede your tender of 18 August 2026.",
    "2. Scope: bored piling (320 nos. 600mm), pile caps, ground beams and ground slab for Block C per drawings MH-C-ST-001 to 024, together with the external drainage and the guardhouse shown on drawing MH-C-EX-003.",
    "3. Contract sum: RM4,650,000.00 lump sum, exclusive of SST. Progress claims monthly; payment within 30 days of certification, provided that the Employer has itself been paid by the purchasers' end-financiers for the corresponding period.",
    "4. Completion: ten (10) months from site possession on 1 November 2026.",
    "5. Liquidated and ascertained damages: RM8,000 per day of delay.",
    "6. Retention: 10% of each certified amount, released in full upon the Certificate of Making Good Defects. Performance bond: 5% of the contract sum.",
    "7. Insurance: the Contractor shall effect Contractor's All Risks insurance in the joint names of the Employer and the Contractor for the full contract sum.",
    "8. Safety, health and environment: the Contractor shall comply with its QESH plan to ISO 45001 and ISO 14001, keep a full-time site safety officer and ensure every worker holds a CIDB Green Card.",
    "9. Conditions: PAM Contract 2018 (without quantities). Disputes: adjudication under CIPAA 2012, then arbitration at the AIAC.",
    "10. Kindly sign and return the duplicate within 7 days to confirm acceptance.",
    "Yours faithfully, for Mutiara Heights Development Sdn Bhd — Project Director",
], note="Answer key: scope adds drainage + guardhouse; RM4.65m vs 4.82m; 10 vs 12 months; LAD 8,000/day uncapped vs 3,000 capped 10%; retention 10% vs 5%; CAR by contractor vs employer; pay-when-paid (CIPAA s.35). ESH and conditions unchanged.")
os.makedirs(OUT, exist_ok=True)
tender.save(f"{OUT}/5 Our tender - Block C substructure.docx")
award.save(f"{OUT}/6 Client Letter of Award - Block C substructure.docx")
print("wrote client demo pair to", OUT)
