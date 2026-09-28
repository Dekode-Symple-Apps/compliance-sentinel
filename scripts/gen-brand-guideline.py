"""Renders the draft Sarawak brand guideline (src/lib/brand-guideline.ts) as a
Word document, so what agencies read and what the AI checks are the same rules.

  python3 scripts/gen-brand-guideline.py  → public/templates/brand/UKAS-BG-01-...docx
"""
import json, os, subprocess
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = subprocess.run(
    ["npx", "tsx", "-e", "import * as g from './src/lib/brand-guideline.ts'; console.log(JSON.stringify({ G: g.GUIDELINE, P: g.PALETTE, T: g.TYPEFACES, C: g.CATEGORIES, R: g.BRAND_RULES }))"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout
d = json.loads(src.strip().splitlines()[-1])
G, P, T, C, R = d["G"], d["P"], d["T"], d["C"], d["R"]
RED, BLACK = RGBColor(0xCE, 0x11, 0x26), RGBColor(0x1A, 0x1A, 0x1A)

doc = Document()
for s in doc.sections:
    s.left_margin = s.right_margin = Cm(2.2)
style = doc.styles["Normal"]; style.font.name = "Arial"; style.font.size = Pt(10.5)

def heading(text, size=14, color=BLACK, space=10):
    p = doc.add_paragraph(); r = p.add_run(text); r.bold = True; r.font.size = Pt(size); r.font.color.rgb = color
    p.paragraph_format.space_before = Pt(space); return p

t = doc.add_paragraph(); r = t.add_run("KERAJAAN SARAWAK · SARAWAK GOVERNMENT"); r.bold = True; r.font.size = Pt(9); r.font.color.rgb = RED
heading(G["title"], 20, BLACK, 4)
doc.add_paragraph(f'{G["code"]} · {G["version"]} · Effective {G["effective"]} · {G["owner"]}')
w = doc.add_paragraph(); wr = w.add_run(f'{G["status"].upper()} — placeholder values are marked for confirmation by UKAS.'); wr.italic = True; wr.font.color.rgb = RED

heading("1. Scope")
doc.add_paragraph(G["scope"])
heading("2. Vision and pillars")
doc.add_paragraph(f'State vision (PCDS 2030), quoted verbatim: "{G["vision"]}"')
doc.add_paragraph("Pillars: " + ", ".join(G["pillars"]) + ".")
heading("3. Colour palette (draft)")
tbl = doc.add_table(rows=1, cols=3); tbl.style = "Light Grid Accent 1"
for i, h in enumerate(["Colour", "Hex", "Role"]): tbl.rows[0].cells[i].text = h
for c in P:
    row = tbl.add_row().cells; row[0].text = c["name"]; row[1].text = c["hex"]; row[2].text = c["role"]
heading("4. Typography (draft)")
doc.add_paragraph(f'Headings: {T["headings"]}. Body: {T["body"]}. Fallback: {T["fallback"]}.')
heading("5. Rules")
doc.add_paragraph("Each rule has an ID used in review findings. Severity: critical (blocks clearance), major (must be fixed), minor (should be fixed).")
for cat in C:
    heading(cat, 12, RED, 8)
    tbl = doc.add_table(rows=1, cols=4); tbl.style = "Light Grid Accent 1"
    for i, h in enumerate(["ID", "Rule", "How it is checked", "Severity"]): tbl.rows[0].cells[i].text = h
    for r in [x for x in R if x["category"] == cat]:
        row = tbl.add_row().cells
        row[0].text, row[1].text, row[2].text, row[3].text = r["id"], r["rule"], r["check_how"], r["severity"].capitalize()
heading("6. Review and clearance")
for line in [
    "Agencies submit material through the Branding Compliance workspace before any public use.",
    "Each submission is reviewed against these rules; findings name the rule, the page and the place on the page.",
    "A UKAS brand officer clears the material for public use, issuing a clearance reference, or returns it with what must change.",
    "A returned submission is revised and resubmitted; every version and decision is kept.",
]:
    doc.add_paragraph(line, style="List Bullet")

out = os.path.join(ROOT, "public", "templates", "brand")
os.makedirs(out, exist_ok=True)
path = os.path.join(out, f'{G["code"]}-Sarawak-Government-Brand-Guideline-{G["version"].replace(" ", "-")}.docx')
doc.save(path)
print(path)
