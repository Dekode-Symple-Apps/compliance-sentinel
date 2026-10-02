// ----------------------------------------------------------------------------
// Sarawak Government Brand Guide — DRAFT v0.2
//
// No complete Sarawak brand book is published. The rules marked "official" come
// from the State Secretary's circulars on eCircular (ecircular.sarawak.gov.my)
// and the State Anthem and Emblems Ordinance 2002; each cites its source. The
// rest is good government practice, marked "practice", until UKAS (Unit
// Komunikasi Awam Sarawak) issues a full guideline. No official colour codes or
// fonts are published: the palette is taken from the flag, the fonts are a
// placeholder. Replacing a rule is one edit here; the AI reads the rules from
// this list. Source scans: scratch/sarawak-brand/.
// ----------------------------------------------------------------------------

export type RuleSeverity = "critical" | "major" | "minor";
export type RuleCheck = "visual" | "text" | "both";

export interface BrandRule {
  id: string;
  category: string;
  /** Plain words for anyone: a short heading and one instruction. Shown on screen. */
  title: string;
  plain: string;
  /** The guideline's own wording. Shown to the brand officer on request, and given to the AI. */
  rule: string;
  /** What the reviewer (AI or person) looks for. */
  check_how: string;
  severity: RuleSeverity;
  check: RuleCheck;
  /** Where the rule comes from: a published state rule, or good practice until UKAS sets one. */
  source: RuleSourceRef;
}
export interface RuleSourceRef { kind: "official" | "practice"; ref?: string; url?: string; note?: string }

/** The published sources the official rules come from. */
export const SOURCES = [
  { id: "pp3-2011", ref: "Surat Pekeliling Perj. Bil. 3/2011", title: "Penggunaan Logo Kenyalang, Motto \"An Honour To Serve\" bersama-sama \"Bersatu Berusaha Berbakti\" dan Logo \"One Government At Your Service\"", issuer: "Setiausaha Kerajaan Sarawak", date: "21 Jan 2011", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8490" },
  { id: "sp11-2022", ref: "Surat Pekeliling Bil. 11/2022", title: "Penggunaan Logo dan Nama Jabatan Premier Sarawak bagi Urusan Rasmi Kerajaan", issuer: "Setiausaha Kerajaan Sarawak (Jabatan Premier Sarawak)", date: "21 Nov 2022", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=9217" },
  { id: "pp3-2020", ref: "Pekeliling Perjawatan Bil. 3/2020", title: "Renamed units to be referred to by their new names", issuer: "Setiausaha Kerajaan Sarawak", date: "3 Feb 2020", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8981" },
  { id: "cm47-75", ref: "Circular Memorandum No. 47/75", title: "Use of State Crest", issuer: "State Secretary", date: "29 Nov 1975", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=5335" },
  { id: "cap53", ref: "State Anthem and Emblems Ordinance 2002 (Cap. 53)", title: "Protects the State Flag and State Crest; use needs the State Secretary's written permission", issuer: "Laws of Sarawak", date: "2002", url: "https://lawnet.sarawak.gov.my/lawnet_file/Ordinance/ORD_CAP.%2053%20LawNet%202024.pdf" },
] as const;

/** Facts from the sources that are not checked on a design, shown on the guide page. */
export const OFFICIAL_FACTS = [
  { text: "Only ministries and government departments may use the State Crest freely. Statutory bodies and other organisations need the State Secretary's written permission first.", ref: "Circular Memorandum 47/75; Cap. 53, s.6" },
  { text: "Crest sizes: 2.5 cm wide × 3 cm high on official letters and forms; 4 × 4 cm on file covers; 4.5 × 5 cm on the right side of a corporate shirt; 25.4 × 20 cm on official vehicle stickers.", ref: "Surat Pekeliling Bil. 11/2022, para 3.2" },
  { text: "The department is Jabatan Premier Sarawak (JPS), no longer Jabatan Ketua Menteri (JKM).", ref: "Surat Pekeliling Bil. 11/2022" },
];

export const GUIDELINE = {
  /** What users see: no codes. */
  shortName: "Sarawak brand guide",
  code: "UKAS-BG-01",
  title: "Sarawak Government Brand Guide",
  version: "Draft v0.2",
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

/** Plain names for the categories, as shown on screen. */
export const CATEGORY_LABEL: Record<string, string> = {
  "State crest & logos": "Crest and logos", "Colour": "Colours", "Typography": "Fonts", "Language & naming": "Words and names",
  "Policy & vision": "State policy", "Imagery": "Photos and images", "Accessibility": "Easy to read", "Mandatory information": "Contact details",
};

export const CATEGORIES = [
  "State crest & logos", "Colour", "Typography", "Language & naming",
  "Policy & vision", "Imagery", "Accessibility", "Mandatory information",
] as const;

export const BRAND_RULES: BrandRule[] = [
  // 1. State crest & logos
  { id: "BC-1.1", category: "State crest & logos", severity: "critical", check: "visual",
    source: { kind: "official", ref: "Perj. Bil. 3/2011, para 3", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8490", note: "Statutory bodies need the State Secretary's written permission to use the crest (Circular Memorandum 47/75)." },
    title: "Crest is on it", plain: "Ministries and departments: put the Sarawak crest on the cover or first page.",
    rule: "Public material from ministries and government departments carries the Sarawak state crest (Jata Negeri Sarawak). Statutory bodies and councils use their own logo; they may use the crest only with the State Secretary's written permission.",
    check_how: "The crest is present on the cover or first page/slide and on every standalone poster or post." },
  { id: "BC-1.2", category: "State crest & logos", severity: "major", check: "visual",
    source: { kind: "official", ref: "Perj. Bil. 3/2011, para 2", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8490", note: "Top left is set for official letters. The clear space is good practice." },
    title: "Crest has space around it", plain: "Place the crest at the top, with empty space around it.",
    rule: "On official letters the crest sits at the top left. On other material it sits top-left or top-centre, with clear space of at least a quarter of its height on every side.",
    check_how: "Nothing (text, image edge, other logo) intrudes into the clear space; the crest is not tucked into a corner or footer." },
  { id: "BC-1.3", category: "State crest & logos", severity: "critical", check: "visual",
    source: { kind: "practice", note: "No state rule on changing the crest is published. This is standard logo practice." },
    title: "Crest is not changed", plain: "Don't stretch, crop, turn or recolour the crest.",
    rule: "The crest is never stretched, squashed, cropped, rotated, recoloured, outlined or placed on a busy background.",
    check_how: "Proportions look natural; colours are the crest's own; the background behind it is plain." },
  { id: "BC-1.4", category: "State crest & logos", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Agency logo is not bigger", plain: "Put your agency logo to the right of the crest, no bigger than it.",
    rule: "An agency logo sits to the right of the crest, no taller than the crest.",
    check_how: "Agency or partner logos are never larger than, or placed above, the state crest." },
  { id: "BC-1.5", category: "State crest & logos", severity: "critical", check: "both",
    source: { kind: "practice" },
    title: "No political party material", plain: "Leave out party logos, slogans and party colours.",
    rule: "No party-political logos, slogans, symbols or party colours on government material.",
    check_how: "Any party emblem, campaign slogan or candidate branding is a breach." },
  { id: "BC-1.6", category: "State crest & logos", severity: "major", check: "both",
    source: { kind: "official", ref: "Surat Pekeliling Bil. 11/2022; Pekeliling Perjawatan Bil. 3/2020", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=9217" },
    title: "Current names and logos", plain: "Use current names and logos, e.g. \"Jabatan Premier Sarawak\", not \"Jabatan Ketua Menteri\".",
    rule: "No superseded agency names or logos: renamed departments and units are referred to by their new names (e.g. Jabatan Premier Sarawak, not Jabatan Ketua Menteri).",
    check_how: "Old ministry or agency names and retired logos are flagged, including \"Jabatan Ketua Menteri\" / \"JKM\" for the Premier's department; the current official name is used." },

  { id: "BC-1.7", category: "State crest & logos", severity: "major", check: "both",
    source: { kind: "official", ref: "Perj. Bil. 3/2011, paras 2–3", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8490" },
    title: "State mottos are shown", plain: "Show \"Bersatu Berusaha Berbakti\" with \"An Honour To Serve\" below it on slides, backdrops and official papers.",
    rule: "The crest is used with the state mottos \"Bersatu Berusaha Berbakti\" and, below it, \"An Honour To Serve\" in official correspondence, slide presentations, official websites and backdrops.",
    check_how: "Applies to slide decks, letters, proposals and papers, and event backdrops or stage banners. Posters, brochures and social media posts are not_applicable unless they are a backdrop. Missing mottos, or \"An Honour To Serve\" placed above \"Bersatu Berusaha Berbakti\", is a breach." },
  { id: "BC-1.8", category: "State crest & logos", severity: "major", check: "visual",
    source: { kind: "official", ref: "Perj. Bil. 3/2011, para 4", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=8490" },
    title: "\"One Government\" logo only at counters", plain: "Use the \"One Government At Your Service\" logo only on service counter signs.",
    rule: "The \"One Government At Your Service\" logo is used at service counters only.",
    check_how: "The \"One Government At Your Service\" logo on slides, brochures, posters, social media posts or papers is a breach. Counter signage passes." },

  // 2. Colour
  { id: "BC-2.1", category: "Colour", severity: "major", check: "visual",
    source: { kind: "practice", note: "No official colour codes are published. The colours are taken from the state flag." },
    title: "State colours lead", plain: "Use red, yellow and black as the main colours.",
    rule: "The Sarawak palette leads: Sarawak Red #CE1126, Sarawak Yellow #FFD100, Sarawak Black #1A1A1A.",
    check_how: "Brand colour areas (headers, bands, buttons, titles) use the primary palette." },
  { id: "BC-2.2", category: "Colour", severity: "major", check: "visual",
    source: { kind: "practice", note: "No official colour codes are published." },
    title: "No other main colour", plain: "Use white and greys to support. Don't make another colour the main one.",
    rule: "Neutrals support only (White, Warm Grey #6B6B6B, Light Grey #F2F2F2); no off-palette dominant colours.",
    check_how: "Purple, teal, lime, neon or pastel schemes as the main colour are breaches." },
  { id: "BC-2.3", category: "Colour", severity: "minor", check: "visual",
    source: { kind: "practice" },
    title: "Flat colours", plain: "Keep colours flat. No gradients, glows or filters.",
    rule: "Brand colours are flat; no gradients, glows or filters over brand colours or the crest.",
    check_how: "Rainbow gradients, neon glows and heavy filters on brand elements." },

  // 3. Typography
  { id: "BC-3.1", category: "Typography", severity: "major", check: "visual",
    source: { kind: "practice", note: "No official fonts are published. These are placeholders." },
    title: "Right fonts", plain: "Use Montserrat for headings and Open Sans for text. Use Arial if you don't have them.",
    rule: "Headings in Montserrat, body in Open Sans (Arial where these are not available).",
    check_how: "Compare letterforms: geometric sans headings, humanist sans body." },
  { id: "BC-3.2", category: "Typography", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Two fonts at most", plain: "Use two fonts at most. No comic, handwriting or fancy fonts.",
    rule: "No more than two typeface families; no novelty, comic or script typefaces.",
    check_how: "Comic Sans, Papyrus, brush scripts and decorative display fonts are breaches." },
  { id: "BC-3.3", category: "Typography", severity: "minor", check: "visual",
    source: { kind: "practice" },
    title: "Text is big enough", plain: "Make text big enough to read: 10 pt in print, 24 px on slides, 16 px on screens.",
    rule: "Body text is legible: at least 10 pt in print, 24 px on slides, 16 px on screens.",
    check_how: "Dense small print, footnote-sized body text on slides." },

  // 4. Language & naming
  { id: "BC-4.1", category: "Language & naming", severity: "minor", check: "text",
    source: { kind: "practice", note: "No circular sets a language rule. Sarawak uses both Bahasa Melayu and English officially." },
    title: "Language is consistent", plain: "Use Bahasa Melayu, English or both. If both, keep them equal and the translation correct.",
    rule: "Public material uses Bahasa Melayu, English or both. Where both are used they carry equal weight and the translation is accurate.",
    check_how: "Material in Bahasa Melayu only, English only, or both passes. A breach is a mistranslation, one language cut short or garbled, or random switching between languages within the same heading." },
  { id: "BC-4.2", category: "Language & naming", severity: "critical", check: "text",
    source: { kind: "official", ref: "Surat Pekeliling Bil. 11/2022", url: "https://ecircular.sarawak.gov.my/view_circular.php?id=9217", note: "The head of government has been the Premier of Sarawak since 2022; the department was renamed to match." },
    title: "Correct official titles", plain: "Say \"Premier of Sarawak\" (Premier Sarawak), not \"Chief Minister\" or \"Ketua Menteri\".",
    rule: "The current head of government is titled Premier of Sarawak / Premier Sarawak, and the deputy Deputy Premier.",
    check_how: "\"Chief Minister\" or \"Ketua Menteri\" used for the current office holder is a breach. A clearly historical reference (an event before 2022) passes. An old department name such as \"Jabatan Ketua Menteri\" or \"JKM\" is BC-1.6, not this rule: do not fail both for the same words. How the government itself is named is BC-4.6." },
  { id: "BC-4.3", category: "Language & naming", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Full name before short form", plain: "Write your agency's full name before using its short form.",
    rule: "The agency's full official name appears at first mention; the acronym after.",
    check_how: "An acronym used alone with no full name anywhere in the material." },
  { id: "BC-4.4", category: "Language & naming", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Spelling is right", plain: "Check spelling, grammar and place names.",
    rule: "Spelling, grammar and place names are correct (e.g. Sarawak, Kuching, Miri, Bintulu).",
    check_how: "Typos in headings, misspelt place names, mixed spelling of the same term." },
  { id: "BC-4.5", category: "Language & naming", severity: "major", check: "text",
    source: { kind: "practice" },
    title: "VIP titles and order", plain: "Give VIPs their proper titles and list them in the right order.",
    rule: "Honorifics and order of precedence are correct when dignitaries are listed.",
    check_how: "Missing honorifics, or officials listed out of precedence." },
  { id: "BC-4.6", category: "Language & naming", severity: "minor", check: "text",
    source: { kind: "practice", note: "The state leadership's stated preference (2024), not a circular." },
    title: "Say \"Sarawak Government\"", plain: "Prefer \"Sarawak Government\" or \"Kerajaan Sarawak\" to \"State Government\".",
    rule: "The government is named Sarawak Government / Kerajaan Sarawak rather than State Government / Kerajaan Negeri.",
    check_how: "\"Sarawak State Government\" or \"State Government\" used for the government today is a tip, never more. A clearly historical reference passes." },

  // 5. Policy & vision
  { id: "BC-5.1", category: "Policy & vision", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Linked to the state plan", plain: "Show which goal of the state's 2030 plan (PCDS 2030) this supports.",
    rule: "Development, economic, social or environmental material links to PCDS 2030 and its pillar(s).",
    check_how: "A programme presented with no link to Economic Prosperity, Social Inclusivity or Environmental Sustainability where one applies." },
  { id: "BC-5.2", category: "Policy & vision", severity: "critical", check: "text",
    source: { kind: "practice" },
    title: "Agrees with state policy", plain: "Don't say anything that goes against state policy.",
    rule: "No statement contradicts published state policy or the PCDS 2030 direction.",
    check_how: "E.g. promoting expansion of coal or open burning against the green economy and renewable energy direction; dismissing digital transformation." },
  { id: "BC-5.3", category: "Policy & vision", severity: "major", check: "text",
    source: { kind: "practice" },
    title: "Numbers are backed up", plain: "Give a source for figures, budgets and dates. Don't promise more than was approved.",
    rule: "Figures, targets, budgets and dates are sourced or marked for verification; no commitments beyond what has been approved.",
    check_how: "Specific RM amounts, percentages or completion dates with no source or approval reference." },
  { id: "BC-5.4", category: "Policy & vision", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Vision quoted exactly", plain: "If you quote the state vision, use the exact words.",
    rule: "The state vision is quoted verbatim when quoted.",
    check_how: "Paraphrased or altered wording presented as the official vision." },

  // 6. Imagery
  { id: "BC-6.1", category: "Imagery", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Real Sarawak people and places", plain: "Show real Sarawak people and places, and include communities fairly.",
    rule: "Imagery represents Sarawak's communities inclusively and respectfully, in authentic Sarawak settings.",
    check_how: "Generic foreign stock scenes standing in for Sarawak; one community shown as representing all." },
  { id: "BC-6.2", category: "Imagery", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Sharp photos", plain: "Use sharp photos. No blurry, stretched or watermarked images.",
    rule: "No low-resolution, pixelated or watermarked images.",
    check_how: "Visible stock watermarks, blocky compression, stretched photos." },
  { id: "BC-6.3", category: "Imagery", severity: "minor", check: "visual",
    source: { kind: "practice" },
    title: "Permission from people shown", plain: "Get permission from people who can be recognised, especially children.",
    rule: "Identifiable people, especially children, need recorded consent.",
    check_how: "Close-up of identifiable individuals: flag for consent confirmation." },
  { id: "BC-6.4", category: "Imagery", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Cultural patterns used with respect", plain: "Use cultural patterns with respect, not as background filler.",
    rule: "Cultural motifs are used respectfully, not distorted or used as filler decoration.",
    check_how: "Recoloured, cropped or mixed motifs from different communities used as background filler." },
  { id: "BC-6.5", category: "Imagery", severity: "critical", check: "visual",
    source: { kind: "practice" },
    title: "Maps are correct", plain: "Draw Sarawak's borders correctly on maps.",
    rule: "Maps show Sarawak's boundaries correctly.",
    check_how: "Missing districts, wrong borders, or Sarawak drawn inaccurately." },

  // 7. Accessibility
  { id: "BC-7.1", category: "Accessibility", severity: "major", check: "visual",
    source: { kind: "practice" },
    title: "Text stands out", plain: "Make text stand out from its background. No yellow on white.",
    rule: "Text has enough contrast with its background (at least 4.5:1 for body text).",
    check_how: "Yellow text on white, grey on grey, text over photos without a panel." },
  { id: "BC-7.2", category: "Accessibility", severity: "minor", check: "visual",
    source: { kind: "practice" },
    title: "Not colour alone", plain: "Don't rely on colour alone to show meaning. Add a label or icon.",
    rule: "Meaning is not carried by colour alone.",
    check_how: "Charts or statuses distinguished only by red versus green." },

  // 8. Mandatory information
  { id: "BC-8.1", category: "Mandatory information", severity: "major", check: "both",
    source: { kind: "practice" },
    title: "Who it's from and how to reach you", plain: "Show your agency's name and a phone number, email or website.",
    rule: "The issuing agency is named, with a contact (phone, email or website).",
    check_how: "No agency name or no way to contact it." },
  { id: "BC-8.2", category: "Mandatory information", severity: "major", check: "text",
    source: { kind: "practice" },
    title: "Official contacts only", plain: "Use your agency's official website and email. No Gmail or personal numbers.",
    rule: "Official channels only: the agency's official website and email (sarawak.gov.my, an agency .gov.my, or the statutory body's own official domain); no personal or free webmail addresses.",
    check_how: "gmail.com, yahoo.com, hotmail.com, personal phone numbers as the official contact." },
  { id: "BC-8.3", category: "Mandatory information", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Date or version", plain: "Put a date or version number on proposals and slides.",
    rule: "Proposals and presentations show a date or version.",
    check_how: "No date or version anywhere on a proposal, paper or slide deck." },
  { id: "BC-8.4", category: "Mandatory information", severity: "minor", check: "text",
    source: { kind: "practice" },
    title: "Security marking", plain: "Mark internal papers, e.g. TERHAD or \"Untuk Kegunaan Dalaman\".",
    rule: "Proposals and papers carry a classification where applicable (e.g. TERHAD, Untuk Kegunaan Dalaman).",
    check_how: "Internal papers with budgets or plans and no classification marking." },
];

export const ruleById = (id: string) => BRAND_RULES.find((r) => r.id === id);
