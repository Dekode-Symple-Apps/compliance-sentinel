// ----------------------------------------------------------------------------
// Sarawak Government Brand & Communication Guideline — DRAFT v0.1
//
// A working draft for the Branding Compliance demo, written from Sarawak's
// public identity (the state crest, the flag's red, yellow and black, the
// PCDS 2030 vision and its three pillars) and common government brand
// practice. Every value marked ASSUMPTION is a placeholder until UKAS (Unit
// Komunikasi Awam Sarawak) issues its own guideline; replacing a rule is one
// edit here, and the AI review reads the rules from this list.
// ----------------------------------------------------------------------------

export type RuleSeverity = "critical" | "major" | "minor";
export type RuleCheck = "visual" | "text" | "both";

export interface BrandRule {
  id: string;
  category: string;
  rule: string;
  /** What the reviewer (AI or person) looks for. */
  check_how: string;
  severity: RuleSeverity;
  check: RuleCheck;
}

export const GUIDELINE = {
  code: "UKAS-BG-01",
  title: "Sarawak Government Brand & Communication Guideline",
  version: "Draft v0.1",
  owner: "Unit Komunikasi Awam Sarawak (UKAS), Premier's Department",
  status: "Draft for UKAS adoption",
  effective: "2026-10-01",
  scope: "All material an agency, department or state-owned entity publishes or presents in the name of the Sarawak Government: slides, brochures, posters, banners, social media, proposals and papers.",
  vision: "Sarawak to be a thriving society driven by data and innovation, where everyone enjoys economic prosperity, social inclusivity and sustainable environment by 2030.",
  pillars: ["Economic Prosperity", "Social Inclusivity", "Environmental Sustainability"],
};

/** ASSUMPTION: draft palette from the Sarawak flag, pending UKAS values. */
export const PALETTE = [
  { name: "Sarawak Red", hex: "#CE1126", role: "primary" },
  { name: "Sarawak Yellow", hex: "#FFD100", role: "primary" },
  { name: "Sarawak Black", hex: "#1A1A1A", role: "primary" },
  { name: "White", hex: "#FFFFFF", role: "neutral" },
  { name: "Warm Grey", hex: "#6B6B6B", role: "neutral" },
  { name: "Light Grey", hex: "#F2F2F2", role: "neutral" },
] as const;

/** ASSUMPTION: draft typefaces, pending UKAS values. */
export const TYPEFACES = { headings: "Montserrat (Bold / SemiBold)", body: "Open Sans (Regular / SemiBold)", fallback: "Arial" };

export const CATEGORIES = [
  "State crest & logos", "Colour", "Typography", "Language & naming",
  "Policy & vision", "Imagery", "Accessibility", "Mandatory information",
] as const;

export const BRAND_RULES: BrandRule[] = [
  // 1. State crest & logos
  { id: "BC-1.1", category: "State crest & logos", severity: "critical", check: "visual",
    rule: "Material for public use carries the Sarawak state crest (Jata Negeri Sarawak).",
    check_how: "The crest is present on the cover or first page/slide and on every standalone poster or post." },
  { id: "BC-1.2", category: "State crest & logos", severity: "major", check: "visual",
    rule: "The crest sits top-left or top-centre with clear space of at least a quarter of its height on every side.",
    check_how: "Nothing (text, image edge, other logo) intrudes into the clear space; the crest is not tucked into a corner or footer." },
  { id: "BC-1.3", category: "State crest & logos", severity: "critical", check: "visual",
    rule: "The crest is never stretched, squashed, cropped, rotated, recoloured, outlined or placed on a busy background.",
    check_how: "Proportions look natural; colours are the crest's own; the background behind it is plain." },
  { id: "BC-1.4", category: "State crest & logos", severity: "major", check: "visual",
    rule: "An agency logo sits to the right of the crest, no taller than the crest.",
    check_how: "Agency or partner logos are never larger than, or placed above, the state crest." },
  { id: "BC-1.5", category: "State crest & logos", severity: "critical", check: "both",
    rule: "No party-political logos, slogans, symbols or party colours on government material.",
    check_how: "Any party emblem, campaign slogan or candidate branding is a breach." },
  { id: "BC-1.6", category: "State crest & logos", severity: "major", check: "both",
    rule: "No superseded agency names or logos.",
    check_how: "Old ministry or agency names and retired logos are flagged; the current official name is used." },

  // 2. Colour
  { id: "BC-2.1", category: "Colour", severity: "major", check: "visual",
    rule: "The Sarawak palette leads: Sarawak Red #CE1126, Sarawak Yellow #FFD100, Sarawak Black #1A1A1A.",
    check_how: "Brand colour areas (headers, bands, buttons, titles) use the primary palette." },
  { id: "BC-2.2", category: "Colour", severity: "major", check: "visual",
    rule: "Neutrals support only (White, Warm Grey #6B6B6B, Light Grey #F2F2F2); no off-palette dominant colours.",
    check_how: "Purple, teal, lime, neon or pastel schemes as the main colour are breaches." },
  { id: "BC-2.3", category: "Colour", severity: "minor", check: "visual",
    rule: "Brand colours are flat; no gradients, glows or filters over brand colours or the crest.",
    check_how: "Rainbow gradients, neon glows and heavy filters on brand elements." },

  // 3. Typography
  { id: "BC-3.1", category: "Typography", severity: "major", check: "visual",
    rule: "Headings in Montserrat, body in Open Sans (Arial where these are not available).",
    check_how: "Compare letterforms: geometric sans headings, humanist sans body." },
  { id: "BC-3.2", category: "Typography", severity: "major", check: "visual",
    rule: "No more than two typeface families; no novelty, comic or script typefaces.",
    check_how: "Comic Sans, Papyrus, brush scripts and decorative display fonts are breaches." },
  { id: "BC-3.3", category: "Typography", severity: "minor", check: "visual",
    rule: "Body text is legible: at least 10 pt in print, 24 px on slides, 16 px on screens.",
    check_how: "Dense small print, footnote-sized body text on slides." },

  // 4. Language & naming
  { id: "BC-4.1", category: "Language & naming", severity: "major", check: "text",
    rule: "Bahasa Melayu is the primary language of public material; English may accompany it with equal or lesser prominence.",
    check_how: "English-only public material, or BM placed as a smaller afterthought." },
  { id: "BC-4.2", category: "Language & naming", severity: "critical", check: "text",
    rule: "Official titles are used: Premier of Sarawak / Premier Sarawak, Deputy Premier, Kerajaan Sarawak / Sarawak Government.",
    check_how: "\"Chief Minister\", \"Ketua Menteri\" or \"Sarawak State Government\" used for the current office is a breach." },
  { id: "BC-4.3", category: "Language & naming", severity: "minor", check: "text",
    rule: "The agency's full official name appears at first mention; the acronym after.",
    check_how: "An acronym used alone with no full name anywhere in the material." },
  { id: "BC-4.4", category: "Language & naming", severity: "minor", check: "text",
    rule: "Spelling, grammar and place names are correct (e.g. Sarawak, Kuching, Miri, Bintulu).",
    check_how: "Typos in headings, misspelt place names, mixed spelling of the same term." },
  { id: "BC-4.5", category: "Language & naming", severity: "major", check: "text",
    rule: "Honorifics and order of precedence are correct when dignitaries are listed.",
    check_how: "Missing honorifics, or officials listed out of precedence." },

  // 5. Policy & vision
  { id: "BC-5.1", category: "Policy & vision", severity: "minor", check: "text",
    rule: "Development, economic, social or environmental material links to PCDS 2030 and its pillar(s).",
    check_how: "A programme presented with no link to Economic Prosperity, Social Inclusivity or Environmental Sustainability where one applies." },
  { id: "BC-5.2", category: "Policy & vision", severity: "critical", check: "text",
    rule: "No statement contradicts published state policy or the PCDS 2030 direction.",
    check_how: "E.g. promoting expansion of coal or open burning against the green economy and renewable energy direction; dismissing digital transformation." },
  { id: "BC-5.3", category: "Policy & vision", severity: "major", check: "text",
    rule: "Figures, targets, budgets and dates are sourced or marked for verification; no commitments beyond what has been approved.",
    check_how: "Specific RM amounts, percentages or completion dates with no source or approval reference." },
  { id: "BC-5.4", category: "Policy & vision", severity: "minor", check: "text",
    rule: "The state vision is quoted verbatim when quoted.",
    check_how: "Paraphrased or altered wording presented as the official vision." },

  // 6. Imagery
  { id: "BC-6.1", category: "Imagery", severity: "major", check: "visual",
    rule: "Imagery represents Sarawak's communities inclusively and respectfully, in authentic Sarawak settings.",
    check_how: "Generic foreign stock scenes standing in for Sarawak; one community shown as representing all." },
  { id: "BC-6.2", category: "Imagery", severity: "major", check: "visual",
    rule: "No low-resolution, pixelated or watermarked images.",
    check_how: "Visible stock watermarks, blocky compression, stretched photos." },
  { id: "BC-6.3", category: "Imagery", severity: "minor", check: "visual",
    rule: "Identifiable people, especially children, need recorded consent.",
    check_how: "Close-up of identifiable individuals: flag for consent confirmation." },
  { id: "BC-6.4", category: "Imagery", severity: "major", check: "visual",
    rule: "Cultural motifs are used respectfully, not distorted or used as filler decoration.",
    check_how: "Recoloured, cropped or mixed motifs from different communities used as background filler." },
  { id: "BC-6.5", category: "Imagery", severity: "critical", check: "visual",
    rule: "Maps show Sarawak's boundaries correctly.",
    check_how: "Missing districts, wrong borders, or Sarawak drawn inaccurately." },

  // 7. Accessibility
  { id: "BC-7.1", category: "Accessibility", severity: "major", check: "visual",
    rule: "Text has enough contrast with its background (at least 4.5:1 for body text).",
    check_how: "Yellow text on white, grey on grey, text over photos without a panel." },
  { id: "BC-7.2", category: "Accessibility", severity: "minor", check: "visual",
    rule: "Meaning is not carried by colour alone.",
    check_how: "Charts or statuses distinguished only by red versus green." },

  // 8. Mandatory information
  { id: "BC-8.1", category: "Mandatory information", severity: "major", check: "both",
    rule: "The issuing agency is named, with a contact (phone, email or website).",
    check_how: "No agency name or no way to contact it." },
  { id: "BC-8.2", category: "Mandatory information", severity: "major", check: "text",
    rule: "Official channels only: a sarawak.gov.my (or agency .gov.my) website and official email; no personal or free webmail addresses.",
    check_how: "gmail.com, yahoo.com, hotmail.com, personal phone numbers as the official contact." },
  { id: "BC-8.3", category: "Mandatory information", severity: "minor", check: "text",
    rule: "Proposals and presentations show a date or version.",
    check_how: "No date or version anywhere on a proposal, paper or slide deck." },
  { id: "BC-8.4", category: "Mandatory information", severity: "minor", check: "text",
    rule: "Proposals and papers carry a classification where applicable (e.g. TERHAD, Untuk Kegunaan Dalaman).",
    check_how: "Internal papers with budgets or plans and no classification marking." },
];

export const ruleById = (id: string) => BRAND_RULES.find((r) => r.id === id);
