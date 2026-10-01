"""Demo material for Branding Compliance, with an answer key.

Writes to ~/Desktop/01. Demo Data/Branding Compliance/ (or the folder given):
  crest_placeholder.png                      stand-in for the state crest (not the real Jata)
  1 Brochure - Program Kampung Digital.pdf   compliant
  2 Poster - Open Day v1.png                 breaches: stretched crest, off-palette, Chief Minister, comic font, watermark, gmail
  2b Poster - Hari Terbuka v2.png            the corrected poster (upload as the revision)
  3 Slides - Rural Water Supply.pptx         breaches: crest stretched and in the corner, agency logo larger, no state mottos, teal/purple theme, unsourced figures, no date
  4 Proposal - Coal Power Plant.docx         breaches: contradicts the green energy direction, unsourced figures, Chief Minister, gmail, no date or classification
  answer_key.json                            the rules each file is expected to fail
"""
import json, os, sys, math
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/01. Demo Data/Branding Compliance")
os.makedirs(OUT, exist_ok=True)
FONTS = os.path.expanduser("~/Library/Fonts")
SUP = "/System/Library/Fonts/Supplemental"
MONT = f"{FONTS}/Montserrat-Regular.ttf"
OSANS = f"{FONTS}/OpenSans-Regular.ttf" if os.path.exists(f"{FONTS}/OpenSans-Regular.ttf") else f"{SUP}/Arial.ttf"
OSANS_B = f"{FONTS}/OpenSans-Bold.ttf"
COMIC = f"{SUP}/Comic Sans MS Bold.ttf"
RED, YEL, BLK, GREY, LIGHT = (206, 17, 38), (255, 209, 0), (26, 26, 26), (107, 107, 107), (242, 242, 242)

def font(path, size):
    return ImageFont.truetype(path, size)

# ── the placeholder crest ────────────────────────────────────────────────────
def crest(size=420):
    im = Image.new("RGBA", (size, int(size * 1.15)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w, h = im.size
    shield = [(w * .1, h * .08), (w * .9, h * .08), (w * .9, h * .55), (w * .5, h * .95), (w * .1, h * .55)]
    d.polygon(shield, fill=YEL, outline=BLK, width=int(size * .025))
    d.polygon([(w * .1, h * .08), (w * .5, h * .08), (w * .5, h * .95), (w * .1, h * .55)], fill=BLK)
    d.polygon([(w * .5, h * .3), (w * .9, h * .08), (w * .9, h * .3), (w * .5, h * .52)], fill=RED)
    cx, cy, r = w * .5, h * .28, w * .09
    pts = [(cx + r * math.cos(math.radians(90 + i * 40)) * (1 if i % 2 == 0 else .45), cy - r * math.sin(math.radians(90 + i * 40)) * (1 if i % 2 == 0 else .45)) for i in range(9)]
    d.polygon(pts, fill=YEL)
    f = font(OSANS_B, int(size * .07))
    d.text((w / 2, h * .72), "JATA", fill=BLK, anchor="mm", font=f)
    d.text((w / 2, h * .8), "PLACEHOLDER", fill=BLK, anchor="mm", font=font(OSANS_B, int(size * .045)))
    return im

CREST = crest()
CREST.save(f"{OUT}/crest_placeholder.png")

def paste(bg, im, box):
    x, y, w, h = box
    bg.paste(im.resize((int(w), int(h))), (int(x), int(y)), im.resize((int(w), int(h))))

# ── 1. compliant brochure (PDF) ──────────────────────────────────────────────
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
pdfmetrics.registerFont(TTFont("Montserrat", MONT))
pdfmetrics.registerFont(TTFont("OpenSans", OSANS))
pdfmetrics.registerFont(TTFont("OpenSansBold", OSANS_B))
hexc = lambda c: "#%02x%02x%02x" % c

def brochure(path):
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    crest_png = f"{OUT}/crest_placeholder.png"
    def header(title_bm, title_en):
        c.setFillColor(hexc(RED)); c.rect(0, H - 150, W, 150, fill=1, stroke=0)
        c.setFillColor(hexc(YEL)); c.rect(0, H - 158, W, 8, fill=1, stroke=0)
        c.drawImage(ImageReader(crest_png), 36, H - 138, width=90, height=103, mask="auto")
        c.setFillColor("white"); c.setFont("OpenSansBold", 11); c.drawString(150, H - 60, "UNIT KOMUNIKASI AWAM SARAWAK (UKAS)")
        c.setFont("OpenSans", 9); c.drawString(150, H - 75, "Jabatan Premier Sarawak · Kerajaan Sarawak")
        c.setFont("Montserrat", 22); c.drawString(150, H - 108, title_bm)
        c.setFont("Montserrat", 13); c.drawString(150, H - 128, title_en)
    def para(y, text, size=11, font_name="OpenSans", color=BLK, width=90):
        c.setFillColor(hexc(color)); c.setFont(font_name, size)
        words, line = text.split(), ""
        for w in words:
            if len(line) + len(w) > width:
                c.drawString(48, y, line); y -= size + 5; line = w
            else:
                line = (line + " " + w).strip()
        c.drawString(48, y, line)
        return y - size - 12
    header("Program Kampung Digital Sarawak", "Sarawak Digital Village Programme")
    y = H - 200
    c.setFillColor(hexc(BLK)); c.setFont("Montserrat", 15); c.drawString(48, y, "Menghubungkan setiap kampung / Connecting every village"); y -= 30
    y = para(y, "Program Kampung Digital membawa capaian internet berkelajuan tinggi, latihan kemahiran digital dan perkhidmatan kerajaan dalam talian ke kawasan luar bandar Sarawak.")
    y = para(y, "The Digital Village Programme brings high-speed internet, digital skills training and online government services to rural Sarawak.", color=GREY)
    c.setFillColor(hexc(LIGHT)); c.rect(40, y - 90, W - 80, 95, fill=1, stroke=0)
    c.setFillColor(hexc(RED)); c.rect(40, y - 90, 6, 95, fill=1, stroke=0)
    c.setFillColor(hexc(BLK)); c.setFont("OpenSansBold", 10); c.drawString(58, y - 12, "Visi PCDS 2030 / PCDS 2030 Vision")
    c.setFont("OpenSans", 10)
    c.drawString(58, y - 30, "\"Sarawak to be a thriving society driven by data and innovation, where everyone")
    c.drawString(58, y - 44, "enjoys economic prosperity, social inclusivity and sustainable environment by 2030.\"")
    c.drawString(58, y - 66, "Teras / Pillars: Kemakmuran Ekonomi (Economic Prosperity) · Keterangkuman Sosial (Social Inclusivity)")
    y -= 120
    c.setFont("Montserrat", 14); c.drawString(48, y, "Apa yang anda dapat / What you get"); y -= 24
    for bm, en in [("Wi-Fi awam percuma di pusat komuniti", "Free public Wi-Fi at the community centre"),
                   ("Kelas literasi digital untuk semua peringkat umur", "Digital literacy classes for all ages"),
                   ("Kaunter bantuan perkhidmatan kerajaan dalam talian", "Help desk for online government services")]:
        c.setFillColor(hexc(RED)); c.circle(54, y + 4, 3, fill=1, stroke=0)
        c.setFillColor(hexc(BLK)); c.setFont("OpenSans", 11); c.drawString(64, y, bm)
        c.setFillColor(hexc(GREY)); c.setFont("OpenSans", 10); c.drawString(64, y - 14, en); y -= 34
    c.setFillColor(hexc(BLK)); c.rect(0, 0, W, 70, fill=1, stroke=0)
    c.setFillColor("white"); c.setFont("OpenSansBold", 10); c.drawString(48, 44, "Unit Komunikasi Awam Sarawak (UKAS)")
    c.setFont("OpenSans", 9); c.drawString(48, 30, "Tel: 082-000 000 · E-mel: ukas@sarawak.gov.my · ukas.sarawak.gov.my")
    c.drawString(48, 16, "Diterbitkan / Published: Oktober 2026 · Versi 1.0")
    c.showPage()
    header("Cara Menyertai", "How to Take Part")
    y = H - 200
    for n, (bm, en) in enumerate([("Daftar melalui ketua kampung atau pejabat daerah.", "Register through your village head or district office."),
                                  ("Hadiri sesi taklimat di pusat komuniti.", "Attend a briefing at the community centre."),
                                  ("Mula menggunakan perkhidmatan dan kelas.", "Start using the services and classes.")], 1):
        c.setFillColor(hexc(YEL)); c.circle(60, y + 4, 12, fill=1, stroke=0)
        c.setFillColor(hexc(BLK)); c.setFont("OpenSansBold", 12); c.drawCentredString(60, y, str(n))
        c.setFont("OpenSans", 11); c.drawString(84, y + 4, bm)
        c.setFillColor(hexc(GREY)); c.setFont("OpenSans", 10); c.drawString(84, y - 10, en); y -= 44
    c.setFillColor(hexc(BLK)); c.rect(0, 0, W, 70, fill=1, stroke=0)
    c.setFillColor("white"); c.setFont("OpenSansBold", 10); c.drawString(48, 44, "Unit Komunikasi Awam Sarawak (UKAS)")
    c.setFont("OpenSans", 9); c.drawString(48, 30, "Tel: 082-000 000 · E-mel: ukas@sarawak.gov.my · ukas.sarawak.gov.my")
    c.save()

brochure(f"{OUT}/1 Brochure - Program Kampung Digital.pdf")

# ── 2. poster v1 (breaches) and v2 (corrected) ───────────────────────────────
def poster_v1(path):
    W, H = 1080, 1350
    im = Image.new("RGB", (W, H))
    top, bot = (110, 40, 160), (0, 170, 170)
    for y in range(H):
        t = y / H
        ImageDraw.Draw(im).line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    d = ImageDraw.Draw(im)
    d.text((W / 2, 150), "OPEN DAY 2026!!", fill=(255, 255, 255), anchor="mm", font=font(COMIC, 110))
    d.text((W / 2, 260), "Officiated by the Chief Minister of Sarawak", fill=(255, 240, 120), anchor="mm", font=font(COMIC, 44))
    # a stock photo panel with a watermark
    ph = Image.new("RGB", (860, 480), (180, 200, 190))
    pd = ImageDraw.Draw(ph)
    for i in range(12):
        pd.ellipse([60 + i * 60, 200 + (i % 3) * 30, 140 + i * 60, 280 + (i % 3) * 30], fill=(120 + i * 8, 140, 120))
    wm = Image.new("RGBA", ph.size, (0, 0, 0, 0))
    wd = ImageDraw.Draw(wm)
    for k in range(-2, 5):
        wd.text((80 + k * 220, 60 + k * 110), "stockimages", fill=(255, 255, 255, 150), font=font(f"{SUP}/Arial Bold.ttf", 64))
    ph = Image.alpha_composite(ph.convert("RGBA"), wm.rotate(20)).convert("RGB")
    im.paste(ph, (110, 340))
    # low-contrast details panel
    d.rectangle([110, 860, 970, 1110], fill=(255, 255, 255))
    d.text((140, 890), "Date: 15 November 2026, 9am", fill=(255, 215, 0), font=font(COMIC, 40))
    d.text((140, 950), "Venue: Main Hall", fill=(255, 215, 0), font=font(COMIC, 40))
    d.text((140, 1010), "Free entry! Lucky draw worth RM50,000!!", fill=(255, 215, 0), font=font(COMIC, 40))
    d.text((W / 2, 1180), "Info: hariterbuka.sarawak@gmail.com", fill=(255, 255, 255), anchor="mm", font=font(COMIC, 36))
    # the crest, stretched and tucked into the bottom-right corner
    paste(im, CREST, (900, 1250, 170, 80))
    im.save(path)

def poster_v2(path):
    W, H = 1080, 1350
    im = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 230], fill=RED)
    d.rectangle([0, 230, W, 244], fill=YEL)
    paste(im, CREST, (50, 30, 150, 172))
    d.text((230, 70), "JABATAN KERJA RAYA SARAWAK", fill=(255, 255, 255), font=font(OSANS_B, 34))
    d.text((230, 120), "Kerajaan Sarawak · Sarawak Government", fill=(255, 255, 255), font=font(OSANS, 28))
    d.rounded_rectangle([860, 70, 1030, 170], radius=10, outline=(255, 255, 255), width=4)
    d.text((945, 120), "JKR", fill=(255, 255, 255), anchor="mm", font=font(OSANS_B, 44))
    d.text((70, 300), "HARI TERBUKA", fill=BLK, font=font(MONT, 96))
    d.text((70, 410), "JKR SARAWAK 2026", fill=RED, font=font(MONT, 72))
    d.text((70, 505), "Open Day · JKR Sarawak 2026", fill=GREY, font=font(OSANS, 36))
    # an illustration panel (drawn, not stock)
    d.rectangle([70, 580, 1010, 900], fill=LIGHT)
    d.polygon([(120, 880), (340, 640), (560, 880)], fill=RED)
    d.polygon([(420, 880), (640, 700), (860, 880)], fill=BLK)
    d.rectangle([620, 760, 960, 880], fill=YEL)
    d.text((80, 930), "Dirasmikan oleh YAB Premier Sarawak", fill=BLK, font=font(OSANS_B, 38))
    d.text((80, 985), "Officiated by the Premier of Sarawak", fill=GREY, font=font(OSANS, 32))
    d.text((80, 1050), "15 November 2026 · 9.00 pagi · Wisma JKR, Kuching", fill=BLK, font=font(OSANS, 30))
    d.text((80, 1095), "Selaras dengan PCDS 2030 — Kemakmuran Ekonomi", fill=BLK, font=font(OSANS, 30))
    d.rectangle([0, 1180, W, H], fill=BLK)
    d.text((80, 1215), "Jabatan Kerja Raya Sarawak (JKR)", fill=(255, 255, 255), font=font(OSANS_B, 32))
    d.text((80, 1265), "Tel: 082-000 000 · info@jkr.sarawak.gov.my · jkr.sarawak.gov.my", fill=(255, 255, 255), font=font(OSANS, 28))
    im.save(path)

poster_v1(f"{OUT}/2 Poster - Open Day v1.png")
poster_v2(f"{OUT}/2b Poster - Hari Terbuka v2.png")

# ── 3. slide deck (PPTX) ─────────────────────────────────────────────────────
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

def deck(path):
    prs = Presentation(); prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    blank = prs.slide_layouts[6]
    TEAL, PURPLE = RGBColor(0, 150, 150), RGBColor(110, 40, 160)
    def slide(title, lines, logo=False):
        s = prs.slides.add_slide(blank)
        bg = s.shapes.add_shape(1, 0, 0, prs.slide_width, Inches(1.4)); bg.fill.solid(); bg.fill.fore_color.rgb = PURPLE; bg.line.fill.background()
        band = s.shapes.add_shape(1, 0, Inches(1.4), prs.slide_width, Inches(0.12)); band.fill.solid(); band.fill.fore_color.rgb = TEAL; band.line.fill.background()
        tb = s.shapes.add_textbox(Inches(0.6), Inches(0.3), Inches(10), Inches(0.9)).text_frame
        tb.text = title; p = tb.paragraphs[0]; p.runs[0].font.size = Pt(36); p.runs[0].font.name = "Comic Sans MS"; p.runs[0].font.color.rgb = RGBColor(255, 255, 255)
        body = s.shapes.add_textbox(Inches(0.8), Inches(1.9), Inches(11.5), Inches(4.8)).text_frame
        for i, line in enumerate(lines):
            para = body.paragraphs[0] if i == 0 else body.add_paragraph()
            para.text = "• " + line; para.runs[0].font.size = Pt(22); para.runs[0].font.name = "Comic Sans MS"; para.runs[0].font.color.rgb = TEAL
        if logo:
            # agency wordmark larger than the crest; crest stretched in the corner
            box = s.shapes.add_shape(1, Inches(9.4), Inches(4.6), Inches(3.4), Inches(1.6)); box.fill.solid(); box.fill.fore_color.rgb = TEAL; box.line.fill.background()
            box.text_frame.text = "MUT"; box.text_frame.paragraphs[0].runs[0].font.size = Pt(54)
            s.shapes.add_picture(f"{OUT}/crest_placeholder.png", Inches(11.9), Inches(6.55), width=Inches(1.3), height=Inches(0.55))
        return s
    slide("Rural Water Supply Project", ["Ministry of Utility and Telecommunication", "Briefing for community leaders", "Presenter: Project Team"], logo=True)
    slide("Why this project", ["Many longhouses still rely on rainwater tanks", "Treated water improves health and daily life", "Supports rural development"])
    slide("Targets", ["100% rural water coverage by 2027 — guaranteed", "RM3.9 billion allocation", "No disruption to any village during works"])
    slide("Timeline", ["Phase 1: Kapit and Belaga", "Phase 2: Baram", "Phase 3: remaining districts"])
    slide("Contact", ["projectteam.water@gmail.com", "WhatsApp: 012-345 6789"])
    prs.save(path)

deck(f"{OUT}/3 Slides - Rural Water Supply.pptx")

# ── 4. proposal (DOCX) ───────────────────────────────────────────────────────
from docx import Document
from docx.shared import Pt as DPt

def proposal(path):
    doc = Document()
    doc.add_heading("KERTAS CADANGAN: LOJI JANAKUASA ARANG BATU BAHARU DI BINTULU", level=1)
    for t in [
        "1. Tujuan. Kertas ini mencadangkan pembinaan loji janakuasa arang batu berkapasiti 1,200 MW di Bintulu bagi menggantikan pelaburan tenaga hidro dan solar yang dianggap terlalu mahal.",
        "2. Latar belakang. Tenaga boleh baharu tidak lagi menjadi keutamaan; arang batu ialah pilihan paling murah untuk Sarawak dan harus diutamakan berbanding sasaran ekonomi hijau.",
        "3. Kos dan manfaat. Kos projek dianggarkan RM4.2 bilion dan dijamin menjimatkan 40% kos elektrik isi rumah menjelang 2027. Loji akan siap sepenuhnya pada Disember 2027.",
        "4. Sokongan. Cadangan ini telah mendapat restu Chief Minister dan akan diumumkan kepada media minggu hadapan.",
        "5. Keputusan yang dipohon. Kelulusan segera untuk memulakan perolehan.",
        "Untuk pertanyaan: pegawai.projek.tenaga@gmail.com",
    ]:
        p = doc.add_paragraph(t); p.runs[0].font.size = DPt(11)
    doc.save(path)

proposal(f"{OUT}/4 Proposal - Coal Power Plant.docx")

key = {
    "1 Brochure - Program Kampung Digital.pdf": {"expect": "compliant", "must_not_fail": ["BC-1.1", "BC-1.3", "BC-4.2", "BC-5.2", "BC-8.1", "BC-8.2"]},
    "2 Poster - Open Day v1.png": {"expect": "red_flag", "must_fail": ["BC-1.2", "BC-1.3", "BC-2.2", "BC-3.2", "BC-4.2", "BC-6.2", "BC-7.1", "BC-8.1", "BC-8.2"]},
    "2b Poster - Hari Terbuka v2.png": {"expect": "compliant", "must_not_fail": ["BC-1.1", "BC-1.3", "BC-4.2", "BC-8.1", "BC-8.2"]},
    "3 Slides - Rural Water Supply.pptx": {"expect": "red_flag", "must_fail": ["BC-1.2", "BC-1.3", "BC-1.4", "BC-1.7", "BC-2.2", "BC-5.3", "BC-8.2", "BC-8.3"]},
    "4 Proposal - Coal Power Plant.docx": {"expect": "red_flag", "must_fail": ["BC-4.2", "BC-5.2", "BC-5.3", "BC-8.2", "BC-8.3", "BC-8.4"]},
}
json.dump(key, open(f"{OUT}/answer_key.json", "w"), indent=1)
print("written to", OUT)
for f in sorted(os.listdir(OUT)): print(" ", f)
