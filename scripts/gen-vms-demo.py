"""Demo document sets for Vendor Management, one scenario folder each, matching
the demo companies the New Request form offers (src/lib/ccms-prefill.ts).
Every name, number and person is invented.

  python3 scripts/gen-vms-demo.py  → ~/Desktop/01. Demo Data/Vendor Management/
    1 New vendor - Delima Mechanical & Electrical/
        Vendor uploads in the portal/01–08 …pdf     (dropped into Upload All at Once)
        Finance uploads - CTOS report/CTOS report.pdf
    2 Subcontractor - Kukuh Formwork & Scaffolding/
        Vendor uploads in the portal/01–08 …pdf     (no CTOS: subcontractors get the Accounts conflict check)
    3 Renewal - Bayu Kuasa insurance/Bayu Kuasa - insurance renewal 2026-27.pdf
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT = os.path.expanduser("~/Desktop/01. Demo Data/Vendor Management")
W, H = A4

COMPANIES = {
    "1 New vendor - Delima Mechanical & Electrical": dict(finance_ctos=True,
        name="DELIMA MECHANICAL & ELECTRICAL SDN BHD", reg="201901045678 (1334567-M)", incorporated="8 May 2019",
        address="No. 21, Jalan Pelukis U1/46, Temasya Industrial Park, 40150 Shah Alam, Selangor",
        business="Testing, commissioning and maintenance of mechanical and electrical (M&E) systems for commercial and residential buildings.",
        staff=36, directors=["Mohd Hafiz bin Ismail", "Chong Mei Ling"], clients="property developers, facility managers, hospitals",
        tin="C 2471 0935 08", ctos=712,
        afs=dict(cur=dict(revenue=12_400_000, cost=9_300_000, admin=1_650_000, finance=80_000, tax=370_000, ppe=4_800_000, receivables=2_900_000, cash=2_100_000, inventory=200_000,
                          payables=2_150_000, st_borrow=450_000, lt_borrow=500_000, share=1_000_000, ocf=1_400_000, icf=-620_000, fcf=-210_000),
                 pri=dict(revenue=10_800_000, cost=8_210_000, admin=1_500_000, finance=95_000, tax=260_000, ppe=4_450_000, receivables=2_500_000, cash=1_530_000, inventory=180_000,
                          payables=1_990_000, st_borrow=480_000, lt_borrow=640_000, share=1_000_000, ocf=1_050_000, icf=-540_000, fcf=-260_000)), contact=("Nurul Aina binti Hashim", "Business Development Manager", "03-5510 2288", "aina@delima-me.example"),
        bank=("CIMB BANK BERHAD", "8603 4471 2290", "Shah Alam Branch", "15 March 2019"),
        insurer=("Allianz General Insurance Company (Malaysia) Berhad", "PL-2026-310554", "RM3,000,000", "1 January 2026", "31 December 2026"),
        extras=["iso", "calibration", "competency"],
    ),
    "2 Subcontractor - Kukuh Formwork & Scaffolding": dict(finance_ctos=False,
        name="KUKUH FORMWORK & SCAFFOLDING SDN BHD", reg="201601023456 (1187654-P)", incorporated="22 June 2016",
        address="Lot 7, Jalan Perusahaan 2, Kawasan Perindustrian Beranang, 43700 Beranang, Selangor",
        business="Formwork, falsework and scaffolding for high-rise residential and commercial construction.",
        staff=120, directors=["Wong Chee Keong", "Siti Rahmah binti Abdullah"], clients="main contractors on high-rise projects in the Klang Valley",
        tin="C 2388 1164 02", ctos=688,
        afs=dict(cur=dict(revenue=48_600_000, cost=39_400_000, admin=3_700_000, finance=310_000, tax=1_290_000, ppe=17_200_000, receivables=11_800_000, cash=5_900_000, inventory=800_000,
                          payables=8_300_000, st_borrow=1_500_000, lt_borrow=4_400_000, share=5_000_000, ocf=4_600_000, icf=-2_900_000, fcf=-700_000),
                 pri=dict(revenue=42_100_000, cost=34_300_000, admin=3_300_000, finance=340_000, tax=1_000_000, ppe=16_100_000, receivables=10_300_000, cash=4_900_000, inventory=700_000,
                          payables=7_600_000, st_borrow=1_700_000, lt_borrow=5_300_000, share=5_000_000, ocf=3_800_000, icf=-2_500_000, fcf=-900_000)), contact=("Wong Chee Keong", "Managing Director", "03-8723 4410", "ckwong@kukuh.example"),
        bank=("PUBLIC BANK BERHAD", "3198 0056 7712", "Semenyih Branch", "4 July 2016"),
        insurer=("Etiqa General Insurance Berhad", "CAR-2026-882107", "RM5,000,000", "1 March 2026", "28 February 2027"),
        extras=["cidb", "competency", "iso"],
    ),
}


def page(path, title, sub=None):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFillColor(colors.HexColor("#1f2937")); c.rect(0, H - 70, W, 70, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 15); c.drawString(50, H - 42, title)
    if sub: c.setFont("Helvetica", 9); c.drawString(50, H - 58, sub)
    c.setFillColor(colors.black)
    return c


def lines(c, y, rows, size=10.5, gap=17):
    for r in rows:
        if isinstance(r, tuple):
            c.setFont("Helvetica-Bold", size); c.drawString(50, y, r[0]); c.setFont("Helvetica", size); c.drawString(210, y, r[1])
        else:
            c.setFont("Helvetica", size); c.drawString(50, y, r)
        y -= gap
    return y


def footer(c, text):
    c.setFont("Helvetica-Oblique", 7.5); c.setFillColor(colors.grey); c.drawString(50, 30, text); c.setFillColor(colors.black)


def build(folder, d):
    # What the vendor uploads in the portal, apart from what Finance uploads.
    uploads = os.path.join(folder, "Vendor uploads in the portal")
    os.makedirs(uploads, exist_ok=True)
    f = lambda n: os.path.join(uploads, n)
    n = d["name"]

    c = page(f("01 SSM certificate.pdf"), "SURUHANJAYA SYARIKAT MALAYSIA", "Companies Commission of Malaysia · Companies Act 2016")
    c.setFont("Helvetica-Bold", 13); c.drawCentredString(W / 2, H - 130, "CERTIFICATE OF INCORPORATION OF PRIVATE COMPANY")
    y = lines(c, H - 180, [f"This is to certify that", ""], 11)
    c.setFont("Helvetica-Bold", 14); c.drawCentredString(W / 2, y, n); y -= 30
    lines(c, y, [("Registration No.", d["reg"]), ("Incorporated on", d["incorporated"]), ("Company type", "Company limited by shares (Sdn Bhd)"),
                 ("Registered address", d["address"][:70]), ("", d["address"][70:])])
    footer(c, "Demo document — invented company and registration number."); c.save()

    c = page(f("02 Company profile.pdf"), "COMPANY PROFILE", n)
    ct = d["contact"]
    y = lines(c, H - 110, [("Registration No.", d["reg"]), ("Tax ID (TIN)", d["tin"]), ("Established", d["incorporated"]), ("Staff", str(d["staff"])),
                           ("Directors", ", ".join(d["directors"])), ("Key clients", d["clients"]),
                           ("Contact person", f"{ct[0]}, {ct[1]}"), ("Telephone", ct[2]), ("Email", ct[3]),
                           ("Office", d["address"][:70]), ("", d["address"][70:])])
    c.setFont("Helvetica-Bold", 11); c.drawString(50, y - 10, "Business"); c.setFont("Helvetica", 10.5)
    t = c.beginText(50, y - 28); t.setLeading(15)
    for chunk in [d["business"][i:i + 95] for i in range(0, len(d["business"]), 95)]: t.textLine(chunk)
    c.drawText(t)
    footer(c, "Demo document — invented company."); c.save()

    b = d["bank"]
    c = page(f("03 Bank account confirmation.pdf"), f"{b[0]} · ACCOUNT CONFIRMATION")
    lines(c, H - 120, ["To whom it may concern,", "",
                       f"We confirm that {n}", f"maintains current account no. {b[1]} with us,",
                       f"held in the company's own name, opened on {b[3]}.", "", "", f"Branch Manager, {b[2]}", "Date: 22 September 2026"])
    footer(c, "Demo document — invented account number."); c.save()

    i = d["insurer"]
    c = page(f("04 Insurance certificate.pdf"), "CERTIFICATE OF INSURANCE", i[0])
    lines(c, H - 120, [("Insured", n), ("Policy No.", i[1]), ("Cover", "Public liability" if i[1].startswith("PL") else "Contractor's all risks and third-party liability"),
                       ("Limit of liability", f"{i[2]} any one occurrence"), ("Period of insurance", f"{i[3]} to {i[4]}")])
    footer(c, "Demo document — invented policy."); c.save()

    k = 5
    if "iso" in d["extras"]:
        c = page(f(f"0{k} ISO 9001 certificate.pdf"), "CERTIFICATE OF REGISTRATION", "ISO 9001:2015 Quality Management System"); k += 1
        lines(c, H - 120, [("Certified organisation", n), ("Certificate No.", "QMS-" + d["reg"][:4] + "-0" + str(len(n))), ("Certification body", "SIRIM QAS International Sdn Bhd"),
                           ("Issued", "15 January 2025"), ("Valid until", "14 January 2028")])
        footer(c, "Demo document — invented certificate."); c.save()
    if "cidb" in d["extras"]:
        c = page(f(f"0{k} CIDB registration.pdf"), "LEMBAGA PEMBANGUNAN INDUSTRI PEMBINAAN MALAYSIA (CIDB)", "Perakuan Pendaftaran Kontraktor"); k += 1
        lines(c, H - 120, [("Contractor", n), ("CIDB registration no.", "0120160622-SL123456"), ("Grade", "G7 — no tender limit"),
                           ("Categories", "B (Building), CE (Civil Engineering)"), ("Issued", "1 July 2025"), ("Valid until", "30 June 2027")])
        footer(c, "Demo document — invented registration."); c.save()
    if "calibration" in d["extras"]:
        c = page(f(f"0{k} Calibration certificate.pdf"), "CALIBRATION CERTIFICATE", "SAMM accredited laboratory"); k += 1
        lines(c, H - 120, [("Customer", n), ("Certificate No.", "CAL-2026-04417"), ("Instrument", "Insulation resistance tester, 5 kV"),
                           ("Laboratory", "Metrologi Teknik Sdn Bhd (SAMM No. 0412)"), ("Calibrated", "3 February 2026"), ("Next due", "2 February 2027")])
        footer(c, "Demo document — invented certificate."); c.save()
    if "competency" in d["extras"]:
        who = d["directors"][0]
        me = "ELECTRICAL" in n
        c = page(f(f"0{k} Competency certificate.pdf"), "SURUHANJAYA TENAGA · ENERGY COMMISSION" if me else "CIDB MALAYSIA · SKILLED CONSTRUCTION WORKER",
                 "Certificate of Competency" if me else "Sijil Kemahiran Pembinaan (SKM)"); k += 1
        lines(c, H - 120, [("Holder", who), ("Employer", n), ("Competency", "Wireman, single and three phase (PW4)" if me else "Scaffolder, tubular and system scaffold"),
                           ("Certificate No.", "PW4-2021-18830" if me else "SKM-SCF-2022-07714"), ("Issued", "12 April 2021" if me else "9 August 2022"), ("Valid until", "11 April 2027" if me else "8 August 2027")])
        footer(c, "Demo document — invented certificate."); c.save()
    afs_pdf(f(f"0{k} Audited financial statements FY2025.pdf"), d); k += 1

    # Finance's CTOS report — kept apart: Finance uploads it, not the vendor.
    # Subcontractors get the Accounts conflict check instead, so no report.
    if not d.get("finance_ctos", True):
        return sorted(os.listdir(uploads))
    fin = os.path.join(folder, "Finance uploads - CTOS report"); os.makedirs(fin, exist_ok=True)
    c = page(os.path.join(fin, "CTOS report.pdf"), "CTOS BUSINESS REPORT", "CTOS Data Systems Sdn Bhd · Confidential")
    y = lines(c, H - 110, [("Subject", n), ("Registration No.", d["reg"]), ("Report date", "25 September 2026"),
                           ("CTOS score", f'{d["ctos"]} (range 300–850)'), ("Litigation (as defendant)", "None found"),
                           ("Winding-up / bankruptcy", "None found"), ("Directors' adverse records", "None found"),
                           ("Trade references", "3 references, all prompt payers"), ("Banking facilities", "No arrears reported")])
    lines(c, y - 10, ["Summary: no adverse records found for the company or its directors."])
    footer(c, "Demo document — invented report."); c.save()
    return sorted(os.listdir(uploads)) + ["Finance uploads - CTOS report/CTOS report.pdf"]


def afs_figures(y):
    gp = y["revenue"] - y["cost"]; pbt = gp - y["admin"] - y["finance"]; np_ = pbt - y["tax"]
    ca = y["receivables"] + y["cash"] + y["inventory"]; ta = y["ppe"] + ca
    cl = y["payables"] + y["st_borrow"]; tl = cl + y["lt_borrow"]; eq = ta - tl
    return dict(gp=gp, pbt=pbt, np=np_, ca=ca, ta=ta, cl=cl, tl=tl, eq=eq)


def afs_pdf(path, d):
    """Audited financial statements, FY ended 31 December 2025 — unqualified, profitable, growing."""
    n = d["name"]; c, p = d["afs"]["cur"], d["afs"]["pri"]; C, P = afs_figures(c), afs_figures(p)
    m = lambda v: f"{v:,.0f}" if v >= 0 else f"({-v:,.0f})"
    cv = canvas.Canvas(path, pagesize=A4)
    def head(title):
        cv.setFillColor(colors.HexColor("#1f2937")); cv.rect(0, H - 70, W, 70, stroke=0, fill=1)
        cv.setFillColor(colors.white); cv.setFont("Helvetica-Bold", 13); cv.drawString(50, H - 40, n)
        cv.setFont("Helvetica", 9); cv.drawString(50, H - 56, f"Registration No. {d['reg']} · {title}"); cv.setFillColor(colors.black)
    def table(y, rows):
        cv.setFont("Helvetica-Bold", 9.5); cv.drawString(50, y, "RM"); cv.drawRightString(430, y, "2025"); cv.drawRightString(530, y, "2024"); y -= 18
        for r in rows:
            if r is None: y -= 6; continue
            bold = r[0].startswith("*"); label = r[0].lstrip("*")
            cv.setFont("Helvetica-Bold" if bold else "Helvetica", 9.5)
            cv.drawString(50, y, label); cv.drawRightString(430, y, m(r[1])); cv.drawRightString(530, y, m(r[2])); y -= 15
        return y
    # 1. auditor's report
    head("Independent auditors' report")
    t = cv.beginText(50, H - 110); t.setFont("Helvetica", 10); t.setLeading(15)
    for line in [f"INDEPENDENT AUDITORS' REPORT TO THE MEMBERS OF {n}", "", "Opinion",
                 f"We have audited the financial statements of {n}, which comprise the statement of",
                 "financial position as at 31 December 2025, and the statements of profit or loss, changes in",
                 "equity and cash flows for the financial year then ended.",
                 "In our opinion, the financial statements give a true and fair view of the financial position",
                 "of the Company as at 31 December 2025 and of its financial performance and cash flows for",
                 "the year then ended in accordance with Malaysian Private Entities Reporting Standard and the",
                 "requirements of the Companies Act 2016 in Malaysia.", "",
                 "Basis for opinion",
                 "We conducted our audit in accordance with approved standards on auditing in Malaysia and",
                 "International Standards on Auditing. We believe that the audit evidence we have obtained is",
                 "sufficient and appropriate to provide a basis for our opinion.", "",
                 "Tan, Lee & Partners PLT (AF 001234) · Chartered Accountants", "Kuala Lumpur, 18 March 2026"]:
        t.textLine(line)
    cv.drawText(t); footer(cv, "Demo document — invented company, auditor and figures."); cv.showPage()
    # 2. statement of financial position
    head("Statement of financial position as at 31 December 2025")
    table(H - 110, [("Property, plant and equipment", c["ppe"], p["ppe"]), ("Inventories", c["inventory"], p["inventory"]),
                    ("Trade and other receivables", c["receivables"], p["receivables"]), ("Cash and bank balances", c["cash"], p["cash"]),
                    ("*Total current assets", C["ca"], P["ca"]), ("*Total assets", C["ta"], P["ta"]), None,
                    ("Trade and other payables", c["payables"], p["payables"]), ("Borrowings - current", c["st_borrow"], p["st_borrow"]),
                    ("*Total current liabilities", C["cl"], P["cl"]), ("Borrowings - non-current", c["lt_borrow"], p["lt_borrow"]),
                    ("*Total liabilities", C["tl"], P["tl"]), None,
                    ("Share capital", c["share"], p["share"]), ("Retained earnings", C["eq"] - c["share"], P["eq"] - p["share"]),
                    ("*Total equity", C["eq"], P["eq"]), ("*Total equity and liabilities", C["ta"], P["ta"])])
    footer(cv, "Demo document — invented figures."); cv.showPage()
    # 3. profit or loss
    head("Statement of profit or loss for the financial year ended 31 December 2025")
    table(H - 110, [("Revenue", c["revenue"], p["revenue"]), ("Cost of sales", -c["cost"], -p["cost"]), ("*Gross profit", C["gp"], P["gp"]),
                    ("Administrative expenses", -c["admin"], -p["admin"]), ("Finance costs", -c["finance"], -p["finance"]),
                    ("*Profit before tax", C["pbt"], P["pbt"]), ("Income tax expense", -c["tax"], -p["tax"]), ("*Profit for the financial year", C["np"], P["np"])])
    footer(cv, "Demo document — invented figures."); cv.showPage()
    # 4. cash flows
    head("Statement of cash flows for the financial year ended 31 December 2025")
    table(H - 110, [("*Net cash from operating activities", c["ocf"], p["ocf"]), ("Net cash used in investing activities", c["icf"], p["icf"]),
                    ("Net cash used in financing activities", c["fcf"], p["fcf"]), ("*Net increase in cash", c["ocf"] + c["icf"] + c["fcf"], p["ocf"] + p["icf"] + p["fcf"]),
                    ("*Cash and bank balances at end of year", c["cash"], p["cash"])])
    footer(cv, "Demo document — invented figures."); cv.save()


def renewal():
    """Bayu Kuasa's public liability policy runs to 31 Oct 2026 — its renewal,
    for the Monitoring "Upload Renewal" step."""
    fin = os.path.join(OUT, "3 Renewal - Bayu Kuasa insurance"); os.makedirs(fin, exist_ok=True)
    path = os.path.join(fin, "Bayu Kuasa - insurance renewal 2026-27.pdf")
    c = page(path, "CERTIFICATE OF INSURANCE · RENEWAL", "Tokio Marine Insurans (Malaysia) Berhad")
    lines(c, H - 120, [("Insured", "BAYU KUASA ENGINEERING SDN BHD"), ("Policy No.", "PL-2027-778412"), ("Cover", "Public liability"),
                       ("Limit of liability", "RM2,000,000 any one occurrence"), ("Period of insurance", "1 November 2026 to 31 October 2027"),
                       ("Renewal of", "PL-2026-778412")])
    footer(c, "Demo document — invented policy."); c.save()
    return path


if __name__ == "__main__":
    for folder, d in COMPANIES.items():
        print(folder, build(os.path.join(OUT, folder), d))
    print(renewal())
