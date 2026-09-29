"""A complete Letter of Award — every one of the 12 LoA items, balanced terms —
for the in-review demo: the AI reads its obligations while Legal, Finance and
the approver work (payment, retention, bond, insurance, LADs, defects period).

  python3 scripts/gen-ccms-loa-demo.py →
    ~/Desktop/01. Demo Data/Commercial CMS/4 Letter of Award in review - Teguh Piling Block C/
      Upload Draft on New Request - Letter of Award, Block C.docx
Invented details; entity particulars are the demo values in src/lib/ccms.ts.
"""
import os
from docx import Document
from docx.shared import Pt

OUT = os.path.expanduser("~/Desktop/01. Demo Data/Commercial CMS/4 Letter of Award in review - Teguh Piling Block C/Upload Draft on New Request - Letter of Award, Block C.docx")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc = Document(); st = doc.styles["Normal"]; st.font.name = "Times New Roman"; st.font.size = Pt(11)
def p(t, bold=False):
    para = doc.add_paragraph(); r = para.add_run(t); r.bold = bold
p("LSH BEST BUILDERS SDN BHD (Registration No. 200501023456 (234567-A))", True)
p("Wisma Lim Seong Hai, Kuala Lumpur")
p("Our ref: LSHBB/LOA/2026/0158        Date: 28 September 2026        Award reference: AF-2026-031")
p("Teguh Piling & Foundation Sdn Bhd (Registration No. 200801023456)")
p("No. 12, Jalan Industri 3, Rawang, Selangor · Attention: Mr. Tan Kok Wai, Managing Director")
p("LETTER OF AWARD — BORED PILING WORKS, BLOCK C SUBSTRUCTURE, LSH 33 (JOB NO. J-2026-033)", True)
items = [
 "We are pleased to award you the above Works (the \"Works\") on the terms of this letter and your tender dated 12 September 2026. Where this letter and the tender differ, this letter prevails.",
 "Scope: supply of all labour, plant and materials to install 124 nos. 600 mm and 900 mm diameter bored piles for Block C, including pile integrity and maintained load tests and pile cut-off, as shown in drawings LSH33-ST-C-101 to 112.",
 "Contract sum: RM1,850,000.00 (Ringgit Malaysia One Million Eight Hundred and Fifty Thousand), lump sum, exclusive of SST.",
 "Commencement on 12 October 2026; completion within twenty (20) weeks, by 1 March 2027.",
 "Payment: monthly progress claims submitted by the 25th of each month, certified by our Project Quantity Surveyor within 14 days and paid within 30 days of certification.",
 "Retention: 10% of each certified amount, limited to 5% of the contract sum (RM92,500). Half is released on the Certificate of Practical Completion and half on the Certificate of Making Good Defects.",
 "Performance bond: an on-demand bank guarantee from a licensed Malaysian bank for 5% of the contract sum (RM92,500), delivered within 14 days of this letter and valid until 12 months after the end of the defects liability period.",
 "Liquidated and ascertained damages: RM1,850 per day of delay beyond the completion date, capped at 10% of the contract sum.",
 "Insurances: Contractor's All Risks is provided by the Main Contractor. You shall maintain workmen's compensation and SOCSO cover for all your workers and public liability insurance of at least RM2,000,000, and provide certificates before commencement.",
 "Defects liability period: twelve (12) months from practical completion; you shall make good defects notified within 14 days at your own cost.",
 "Anti-bribery: you shall comply with the Malaysian Anti-Corruption Commission Act 2009 (including section 17A) and our Anti-Bribery Management System (ABMS) policy. A breach entitles us to terminate this award immediately.",
 "Disputes: this award is governed by the laws of Malaysia. Payment disputes may be adjudicated under the Construction Industry Payment and Adjudication Act 2012; other disputes go to the courts of Malaysia.",
 "Please sign and return the duplicate of this letter within seven (7) days to confirm your acceptance.",
]
for i, t in enumerate(items, 1): p(f"{i}. {t}")
p("Yours faithfully, for LSH BEST BUILDERS SDN BHD")
p("______________________  Project Director")
p("ACCEPTANCE", True)
p("We accept the award on the terms above.   ______________________ for Teguh Piling & Foundation Sdn Bhd   Date:")
doc.save(OUT); print(OUT)
