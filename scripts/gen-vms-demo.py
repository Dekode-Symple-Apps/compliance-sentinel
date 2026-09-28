"""Demo document sets for Vendor Management onboarding, one folder per company,
matching the demo companies the New Request form offers (src/lib/ccms-prefill.ts).
Every name, number and person is invented.

  python3 scripts/gen-vms-demo.py  → ~/Desktop/01. Demo Data/Vendor Management/<company>/
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT = os.path.expanduser("~/Desktop/01. Demo Data/Vendor Management")
W, H = A4

COMPANIES = {
    "Delima Mechanical & Electrical (New Vendor)": dict(
        name="DELIMA MECHANICAL & ELECTRICAL SDN BHD", reg="201901045678 (1334567-M)", incorporated="8 May 2019",
        address="No. 21, Jalan Pelukis U1/46, Temasya Industrial Park, 40150 Shah Alam, Selangor",
        business="Testing, commissioning and maintenance of mechanical and electrical (M&E) systems for commercial and residential buildings.",
        staff=36, directors=["Mohd Hafiz bin Ismail", "Chong Mei Ling"], clients="property developers, facility managers, hospitals",
        tin="C 2471 0935 08", ctos=712, contact=("Nurul Aina binti Hashim", "Business Development Manager", "03-5510 2288", "aina@delima-me.example"),
        bank=("CIMB BANK BERHAD", "8603 4471 2290", "Shah Alam Branch", "15 March 2019"),
        insurer=("Allianz General Insurance Company (Malaysia) Berhad", "PL-2026-310554", "RM3,000,000", "1 January 2026", "31 December 2026"),
        extras=["iso", "calibration", "competency"],
    ),
    "Kukuh Formwork & Scaffolding (Subcontractor)": dict(
        name="KUKUH FORMWORK & SCAFFOLDING SDN BHD", reg="201601023456 (1187654-P)", incorporated="22 June 2016",
        address="Lot 7, Jalan Perusahaan 2, Kawasan Perindustrian Beranang, 43700 Beranang, Selangor",
        business="Formwork, falsework and scaffolding for high-rise residential and commercial construction.",
        staff=120, directors=["Wong Chee Keong", "Siti Rahmah binti Abdullah"], clients="main contractors on high-rise projects in the Klang Valley",
        tin="C 2388 1164 02", ctos=655, contact=("Wong Chee Keong", "Managing Director", "03-8723 4410", "ckwong@kukuh.example"),
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
    os.makedirs(folder, exist_ok=True)
    f = lambda n: os.path.join(folder, n)
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
    # Finance's CTOS report — kept apart: Finance uploads it, not the vendor.
    fin = os.path.join(folder, "For Finance"); os.makedirs(fin, exist_ok=True)
    c = page(os.path.join(fin, "CTOS report.pdf"), "CTOS BUSINESS REPORT", "CTOS Data Systems Sdn Bhd · Confidential")
    y = lines(c, H - 110, [("Subject", n), ("Registration No.", d["reg"]), ("Report date", "25 September 2026"),
                           ("CTOS score", f'{d["ctos"]} (range 300–850)'), ("Litigation (as defendant)", "None found"),
                           ("Winding-up / bankruptcy", "None found"), ("Directors' adverse records", "None found"),
                           ("Trade references", "3 references, all prompt payers"), ("Banking facilities", "No arrears reported")])
    lines(c, y - 10, ["Summary: no adverse records found for the company or its directors."])
    footer(c, "Demo document — invented report."); c.save()
    return sorted(os.listdir(folder))


def renewal():
    """Bayu Kuasa's public liability policy runs to 31 Oct 2026 — its renewal,
    for the Monitoring "Upload Renewal" step."""
    fin = os.path.join(OUT, "Renewals"); os.makedirs(fin, exist_ok=True)
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
