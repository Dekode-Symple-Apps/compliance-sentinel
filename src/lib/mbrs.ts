// MBRS (Malaysian Business Reporting System) — canonical extraction model.
//
// The pipeline is deliberately three-staged:
//   OCR/text  →  MbrsExtraction (this file)  →  XBRL instance (mbrs-xbrl.ts)
//
// The LLM only ever produces an MbrsExtraction. It never writes XBRL: concept
// names and context refs are schema-constrained, and a hallucinated tag is a
// silent SSM rejection rather than a visible error. Keeping a readable
// intermediate also means the correction UI edits plain labelled numbers.

// Deliberately imports the small generated narratives module rather than the
// full fact template: this file is imported by the review page, and pulling
// mbrs-template.ts in would ship ~120KB of taxonomy scaffolding to the browser.
import { NARRATIVE_CONCEPTS } from "./mbrs-narratives";

export { NARRATIVE_CONCEPTS };

export type Period = "current" | "previous";

export interface FieldSpec {
  key: string;
  label: string;
  /** Statement this line belongs to, for grouping in the review form. */
  group: "entity" | "sofp" | "pl" | "cf";
  type: "text" | "date" | "number" | "money";
  /** Money/number fields are captured per period; entity fields are not. */
  periodic: boolean;
  /** Shown under the field in the review form when the source is non-obvious. */
  hint?: string;
}

/** Company / filing metadata. Sourced from the cover pages, directors' report,
 *  statement by directors and the auditors' report — not the statements. */
export const ENTITY_FIELDS: FieldSpec[] = [
  { key: "entityName", label: "Company name", group: "entity", type: "text", periodic: false },
  { key: "registrationNumber", label: "Registration no. (new format)", group: "entity", type: "text", periodic: false, hint: "12-digit MyCoID, e.g. 202101011095" },
  { key: "oldRegistrationNumber", label: "Registration no. (old format)", group: "entity", type: "text", periodic: false, hint: "e.g. 1411394-T" },
  // SSM allows up to three declared business activities, each carrying its own
  // MSIC code and description on a separate NatureOfBusinessAxis member.
  { key: "msicCode1", label: "MSIC code (activity 1)", group: "entity", type: "text", periodic: false },
  { key: "businessDescription1", label: "Nature of business (activity 1)", group: "entity", type: "text", periodic: false },
  { key: "msicCode2", label: "MSIC code (activity 2)", group: "entity", type: "text", periodic: false, hint: "Leave blank if the company declares only one activity" },
  { key: "businessDescription2", label: "Nature of business (activity 2)", group: "entity", type: "text", periodic: false },
  { key: "msicCode3", label: "MSIC code (activity 3)", group: "entity", type: "text", periodic: false, hint: "Leave blank if unused" },
  { key: "businessDescription3", label: "Nature of business (activity 3)", group: "entity", type: "text", periodic: false },
  { key: "numberOfEmployees", label: "Number of employees", group: "entity", type: "number", periodic: false },
  { key: "currentPeriodStart", label: "Current FY start", group: "entity", type: "date", periodic: false },
  { key: "currentPeriodEnd", label: "Current FY end", group: "entity", type: "date", periodic: false },
  { key: "previousPeriodStart", label: "Previous FY start", group: "entity", type: "date", periodic: false },
  { key: "previousPeriodEnd", label: "Previous FY end", group: "entity", type: "date", periodic: false },
  { key: "director1Name", label: "First signing director", group: "entity", type: "text", periodic: false },
  { key: "director1Id", label: "First director ID no.", group: "entity", type: "text", periodic: false },
  { key: "director2Name", label: "Second signing director", group: "entity", type: "text", periodic: false },
  { key: "director2Id", label: "Second director ID no.", group: "entity", type: "text", periodic: false },
  { key: "directorsReportDate", label: "Directors' report date", group: "entity", type: "date", periodic: false },
  { key: "boardApprovalDate", label: "Date approved by the Board", group: "entity", type: "date", periodic: false, hint: "Statement by Directors / Directors' report signing date if not stated separately" },
  { key: "statutoryDeclarationDate", label: "Statutory declaration date", group: "entity", type: "date", periodic: false, hint: "Date the statutory declaration was signed before the Commissioner for Oaths" },
  { key: "circulationDate", label: "Date circulated to members", group: "entity", type: "date", periodic: false, hint: "Often stamped on the cover page — \"circulated on ...\"" },
  // SSM's mTool generates the applicable template set from these "Filing
  // Information" answers, then requires the minimum-requirement list for that
  // set. Our template is derived from one profile (FS-MPERS · Separate ·
  // audited · income statement by function), so we must read these back and
  // refuse anything outside it rather than emit a structurally wrong filing.
  { key: "basisOfAccounting", label: "Reporting framework", group: "entity", type: "text", periodic: false, hint: "MPERS or MFRS, as stated in the basis-of-preparation note" },
  { key: "financialStatementsType", label: "Separate or consolidated", group: "entity", type: "text", periodic: false, hint: "\"Separate\" for a standalone company; \"Consolidated\" if the accounts consolidate subsidiaries" },
  { key: "incomeStatementFormat", label: "Income statement presentation", group: "entity", type: "text", periodic: false, hint: "\"By function\" if it shows cost of sales / gross profit; \"By nature\" if it lists purchases, staff costs, depreciation" },
  { key: "auditStatus", label: "Audit status", group: "entity", type: "text", periodic: false, hint: "Audited or Unaudited" },
  { key: "directorsOtherBenefits", label: "Directors received other benefits by contract?", group: "entity", type: "text", periodic: false, hint: "Yes or No, from the Directors' Report" },
  { key: "contingentLiabilityEnforceable", label: "Contingent liability enforceable within 12 months?", group: "entity", type: "text", periodic: false, hint: "Yes or No, from the Directors' Report" },
  { key: "materialUnusualEvents", label: "Substantial, material or unusual items/events?", group: "entity", type: "text", periodic: false, hint: "Yes or No, from the Directors' Report" },
  { key: "dividendStatus", label: "Status of dividend", group: "entity", type: "text", periodic: false, hint: "As stated in the Directors' Report — e.g. \"Not mentioned\" or \"Mentioned but not recommended\"" },
  { key: "auditorsOpinion", label: "Auditor's opinion", group: "entity", type: "text", periodic: false, hint: "e.g. Unmodified opinion" },
  { key: "auditorName", label: "Auditor name", group: "entity", type: "text", periodic: false },
  { key: "auditorLicenseNumber", label: "Auditor licence no.", group: "entity", type: "text", periodic: false },
  { key: "auditFirmName", label: "Audit firm", group: "entity", type: "text", periodic: false },
  { key: "auditFirmRegistrationNumber", label: "Audit firm AF no.", group: "entity", type: "text", periodic: false },
  { key: "auditFirmAddress", label: "Audit firm address", group: "entity", type: "text", periodic: false },
  { key: "auditFirmPostcode", label: "Audit firm postcode", group: "entity", type: "text", periodic: false },
  { key: "auditFirmTown", label: "Audit firm town", group: "entity", type: "text", periodic: false },
  { key: "auditFirmState", label: "Audit firm state", group: "entity", type: "text", periodic: false },
  { key: "auditorReportDate", label: "Auditor's report date", group: "entity", type: "date", periodic: false },
];

/** Statement of financial position. */
export const SOFP_FIELDS: FieldSpec[] = [
  { key: "propertyPlantAndEquipment", label: "Property, plant and equipment", group: "sofp", type: "money", periodic: true },
  { key: "totalNoncurrentAssets", label: "Total non-current assets", group: "sofp", type: "money", periodic: true },
  { key: "otherReceivables", label: "Other (non-trade) receivables, incl. deposits", group: "sofp", type: "money", periodic: true, hint: "The non-trade subtotal INCLUDING deposits, but EXCLUDING prepayments, trade, and amounts due from holding company or related parties." },
  { key: "receivablesDueFromHoldingCompany", label: "— of which due from holding company", group: "sofp", type: "money", periodic: true, hint: "Holding / parent company ONLY. Either a breakdown inside other receivables OR a separate line on the face of the statement — take it from wherever it is shown." },
  { key: "receivablesDueFromRelatedParties", label: "— of which due from other related parties", group: "sofp", type: "money", periodic: true, hint: "Directors, subsidiaries, associates, companies under common control — NOT the holding company. Either a breakdown inside other receivables OR a separate line on the face of the statement (\"amount owing by directors\" is this field). Always fill it when such a balance exists — current assets will not add up without it." },
  { key: "currentTaxAssets", label: "Current tax assets / tax recoverable", group: "sofp", type: "money", periodic: true, hint: "A separate face line if present (tax recoverable / tax refundable). Leave blank if the statement has none." },
  { key: "cashAndCashEquivalents", label: "Cash and cash equivalents", group: "sofp", type: "money", periodic: true },
  { key: "totalCurrentAssets", label: "Total current assets", group: "sofp", type: "money", periodic: true },
  { key: "totalAssets", label: "Total assets", group: "sofp", type: "money", periodic: true },
  { key: "shareCapital", label: "Share capital", group: "sofp", type: "money", periodic: true },
  { key: "investmentPropertyFreehold", label: "— of which freehold land and buildings", group: "sofp", type: "money", periodic: true, hint: "Fill this ONLY where the note says the property is FREEHOLD. If it says leasehold, or does not say, leave this blank and put the amount in other investment property instead. Breakdown inside investment property, not additional to it." },
  { key: "investmentPropertyOther", label: "— of which other investment property", group: "sofp", type: "money", periodic: true, hint: "Investment property that is not freehold land and buildings — leasehold property and the like. Breakdown inside investment property." },
  { key: "openingShareCapital", label: "Share capital at START of period", group: "sofp", type: "money", periodic: true, hint: "Opening balance row of the statement of changes in equity" },
  { key: "openingRetainedEarnings", label: "Retained earnings at START of period", group: "sofp", type: "money", periodic: true, hint: "Opening balance row of the statement of changes in equity" },
  { key: "openingTotalEquity", label: "Total equity at START of period", group: "sofp", type: "money", periodic: true, hint: "Opening balance row of the statement of changes in equity" },
  // SSM's cash flow statement needs THREE cash dates, not two: this year's
  // close, last year's close, and the opening balance of the comparative year.
  // Our schema held two, so the third had nowhere to go and the box stayed
  // empty in every filing.
  { key: "openingCashAndCashEquivalents", label: "Cash at START of period", group: "cf", type: "money", periodic: true, hint: "The \"cash and cash equivalents at beginning of financial year\" line at the foot of the cash flow statement. Read BOTH columns: the previous-period column gives the opening balance of the comparative year." },
  { key: "buildings", label: "— of which land and buildings", group: "sofp", type: "money", periodic: true, hint: "Carrying amount from the PPE note. Freehold or leasehold land and buildings together — SSM files them as one figure. Includes a showroom, factory, shoplot or premises column. Breakdown inside PPE, not additional to it." },
  { key: "vehicles", label: "— of which motor vehicles", group: "sofp", type: "money", periodic: true, hint: "Carrying amount from the PPE note. Breakdown inside PPE." },
  { key: "plantAndEquipment", label: "— of which plant and machinery", group: "sofp", type: "money", periodic: true, hint: "Carrying amount from the PPE note. Plant, machinery, and also workshop tools and equipment — SSM groups tools here. Breakdown inside PPE." },
  { key: "financeLeaseCurrent", label: "Finance lease / hire purchase liabilities (current)", group: "sofp", type: "money", periodic: true },
  { key: "financeLeaseNoncurrent", label: "Finance lease / hire purchase liabilities (non-current)", group: "sofp", type: "money", periodic: true },
  { key: "officeEquipment", label: "— of which office equipment, fixtures and fittings", group: "sofp", type: "money", periodic: true, hint: "Carrying amount from the PPE note. Breakdown inside PPE, not additional to it. Office equipment, furniture and fittings, AND renovation or fitting-out costs — SSM groups renovation here. Do not fold in workshop tools (plant and machinery) or signboards (other)." },
  // The PPE note routinely carries a column our four named categories do not
  // cover — renovation, tools, signboards. With nowhere to put it the model
  // folded it into office equipment, which is why that box read 71,239 against
  // SSM's 65,656: the 5,583 difference was exactly the unnamed column.
  { key: "otherPropertyPlantAndEquipment", label: "— of which other property, plant and equipment", group: "sofp", type: "money", periodic: true, hint: "Any PPE note column that fits none of the categories above — signboards, containers and the like. NOT renovation (office equipment) and NOT workshop tools (plant and machinery). Add them together if there are several. Breakdown inside PPE, not additional to it." },
  { key: "numberOfShares", label: "Number of shares issued and fully paid", group: "sofp", type: "number", periodic: true },
  { key: "retainedEarnings", label: "Retained profit / (accumulated loss)", group: "sofp", type: "money", periodic: true },
  { key: "totalEquity", label: "Total equity", group: "sofp", type: "money", periodic: true },
  { key: "tradePayables", label: "Trade payables", group: "sofp", type: "money", periodic: true },
  { key: "otherPayablesAndAccruals", label: "Other payables and accruals", group: "sofp", type: "money", periodic: true, hint: "EXCLUDING amounts due to holding company or related parties, which have their own lines" },
  { key: "payablesDueToHoldingCompany", label: "— of which due to holding company", group: "sofp", type: "money", periodic: true, hint: "Holding / parent company ONLY. Breakdown inside other payables." },
  { key: "payablesDueToRelatedParties", label: "— of which due to other related parties", group: "sofp", type: "money", periodic: true, hint: "Directors, subsidiaries, associates, companies under common control — NOT the holding company. Either a breakdown inside other payables OR a separate line on the face of the statement. Always fill it when such a balance exists — current liabilities will not add up without it." },
  { key: "accruals", label: "— of which accruals", group: "sofp", type: "money", periodic: true, hint: "From the payables note" },
  { key: "prepayments", label: "Prepayments and accrued income", group: "sofp", type: "money", periodic: true, hint: "Reported BESIDE other receivables, not inside it" },
  { key: "deposits", label: "— of which deposits", group: "sofp", type: "money", periodic: true, hint: "A component INSIDE other receivables, reported separately as well" },
  { key: "otherNontradePayables", label: "— of which other non-trade payables", group: "sofp", type: "money", periodic: true, hint: "From the payables note" },
  { key: "currentNontradePayables", label: "— non-trade payables subtotal", group: "sofp", type: "money", periodic: true, hint: "Accruals + other non-trade payables. Computed automatically if left blank." },
  { key: "currentTaxLiabilities", label: "Current tax liabilities", group: "sofp", type: "money", periodic: true },
  { key: "totalCurrentLiabilities", label: "Total current liabilities", group: "sofp", type: "money", periodic: true },
  { key: "totalLiabilities", label: "Total liabilities", group: "sofp", type: "money", periodic: true },
  { key: "totalEquityAndLiabilities", label: "Total equity and liabilities", group: "sofp", type: "money", periodic: true },
  // Added after the QSK / LS / Yee Fatt gap analysis: the original 20 lines were
  // modelled on a simple services company, so an investment or trading company
  // silently lost these balances (they were being FILED AS ZERO).
  { key: "investmentProperty", label: "Investment property", group: "sofp", type: "money", periodic: true },
  { key: "investmentsInAssociates", label: "Investments in associates", group: "sofp", type: "money", periodic: true },
  { key: "otherNoncurrentAssets", label: "Other non-current assets", group: "sofp", type: "money", periodic: true },
  { key: "otherInvestments", label: "Other investments (non-current)", group: "sofp", type: "money", periodic: true, hint: "Investments not accounted for by the equity method — quoted/unquoted shares, funds" },
  { key: "inventories", label: "Inventories", group: "sofp", type: "money", periodic: true },
  { key: "tradeReceivables", label: "Trade receivables", group: "sofp", type: "money", periodic: true, hint: "Trade debtors only — other receivables have their own line" },
  { key: "totalNoncurrentLiabilities", label: "Total non-current liabilities", group: "sofp", type: "money", periodic: true },
  { key: "noncurrentBorrowings", label: "— of which borrowings (non-current)", group: "sofp", type: "money", periodic: true, hint: "Bank borrowings, term loans AND lease or hire-purchase liabilities falling due after twelve months. EXCLUDE deferred tax liabilities — this is not the same figure as total non-current liabilities." },
  { key: "deferredTaxLiabilities", label: "— of which deferred tax", group: "sofp", type: "money", periodic: true },
  { key: "noncurrentBankLoans", label: "— of which bank / term loans (non-current)", group: "sofp", type: "money", periodic: true, hint: "Bank and term loans only, EXCLUDING hire purchase and lease liabilities" },
  { key: "currentBankLoans", label: "— of which bank / term loans (current)", group: "sofp", type: "money", periodic: true, hint: "Bank and term loans only, EXCLUDING hire purchase and lease liabilities" },
  { key: "currentBorrowings", label: "Borrowings (current)", group: "sofp", type: "money", periodic: true },
];

/** Statement of profit or loss / comprehensive income. */
export const PL_FIELDS: FieldSpec[] = [
  { key: "revenue", label: "Revenue", group: "pl", type: "money", periodic: true },
  { key: "revenueFromGoods", label: "— of which sale of goods", group: "pl", type: "money", periodic: true, hint: "The sale-of-goods component ONLY. If revenue also includes rental or service income, exclude those — goods plus services plus rental must add back to total revenue, not exceed it. Leave blank if the company sells no goods." },
  { key: "revenueFromServices", label: "— of which rendering of services", group: "pl", type: "money", periodic: true, hint: "The services component ONLY, excluding any goods or rental included in revenue. Leave blank if the company renders no services." },
  { key: "grossProfit", label: "Gross profit", group: "pl", type: "money", periodic: true },
  { key: "administrativeExpenses", label: "Administrative expenses", group: "pl", type: "money", periodic: true, hint: "Positive number — sign is applied by the mapper" },
  { key: "profitBeforeTax", label: "Profit / (loss) before tax", group: "pl", type: "money", periodic: true },
  { key: "taxExpense", label: "Income tax expense", group: "pl", type: "money", periodic: true },
  { key: "profitAfterTax", label: "Profit / (loss) after tax", group: "pl", type: "money", periodic: true },
  // Without these, profit-before-tax never reconciles for a company whose
  // profit comes from anything but trading — QSK earned RM2.39m on RM66k of
  // revenue, essentially all of it other income.
  { key: "otherIncome", label: "Other income (total)", group: "pl", type: "money", periodic: true },
  { key: "rentalIncome", label: "— of which rental income", group: "pl", type: "money", periodic: true, hint: "Rental income, wherever the statement reports it. A property company usually presents it INSIDE revenue; everyone else puts it inside other income. Either way it is a component of the line above it, never additional to it." },
  { key: "dividendIncome", label: "— of which dividend income", group: "pl", type: "money", periodic: true, hint: "Component INSIDE other income, reported separately as well" },
  { key: "interestIncome", label: "— of which interest income", group: "pl", type: "money", periodic: true, hint: "Component INSIDE other income, reported separately as well" },
  { key: "gainsOnDisposal", label: "— of which gain on disposal of assets", group: "pl", type: "money", periodic: true, hint: "Component INSIDE other income. Positive for a gain." },
  { key: "costOfSales", label: "Cost of sales", group: "pl", type: "money", periodic: true, hint: "Positive number — sign is applied by the mapper" },
  { key: "otherOperatingExpenses", label: "Other operating expenses", group: "pl", type: "money", periodic: true, hint: "Positive number — sign is applied by the mapper" },
  { key: "sellingAndDistributionExpenses", label: "Selling and distribution expenses", group: "pl", type: "money", periodic: true, hint: "Positive number — sign is applied by the mapper. Leave blank if the statement has no such line." },
  { key: "financeCosts", label: "Finance costs", group: "pl", type: "money", periodic: true, hint: "Positive number — sign is applied by the mapper" },
  { key: "auditorsRemuneration", label: "Auditors' remuneration", group: "pl", type: "money", periodic: true },
  { key: "keyManagementCompensation", label: "Key management personnel compensation", group: "pl", type: "money", periodic: true, hint: "Directors' remuneration and other key management pay, from the related-party note" },
  { key: "relatedPartyDividendIncome", label: "Dividend income from related parties", group: "pl", type: "money", periodic: true, hint: "From the related-party transactions note. If the note exists but lists no dividend from related parties, enter 0. Leave blank ONLY if the report has no related-party note." },
  // The related-party NOTE totals, which are not the same figure as the
  // balance-sheet breakdown. Yee Fatt shows 669,885 owing by directors on the
  // face of the statement, while its note discloses 1,966,867 receivable from
  // related parties in total. We were filing the face figure into the note's
  // box. Where the note gives no separate total the face figure is the best
  // available answer, so it falls back to it rather than filing nothing.
  { key: "relatedPartyReceivablesTotal", label: "Total receivable from related parties (note)", group: "pl", type: "money", periodic: true, hint: "The TOTAL amount due from related parties disclosed in the related-party transactions note — all related parties together, which may exceed any single line on the balance sheet." },
  { key: "relatedPartyPayablesTotal", label: "Total payable to related parties (note)", group: "pl", type: "money", periodic: true, hint: "The TOTAL amount owing to related parties disclosed in the related-party transactions note. Include amounts owing to a company in which a director has a substantial financial interest, even when the balance sheet shows it inside other payables." },
  // SSM's preparers write 0 against every related-party transaction type the
  // note does not list — the note is the complete statement of what occurred.
  // Blank is reserved for a report with no related-party note at all.
  { key: "relatedPartyRevenueGoods", label: "Sales of goods to related parties", group: "pl", type: "money", periodic: true, hint: "From the related-party transactions note. If the note exists but lists no sale of goods to related parties, enter 0. Leave blank ONLY if the report has no related-party note." },
  { key: "relatedPartyRevenueServices", label: "Services rendered to related parties", group: "pl", type: "money", periodic: true, hint: "From the related-party transactions note. If the note exists but lists no services to related parties, enter 0. Leave blank ONLY if the report has no related-party note." },
  { key: "relatedPartyRentalExpense", label: "Rental expense to related parties", group: "pl", type: "money", periodic: true, hint: "From the related-party transactions note. If the note exists but lists no rent paid to related parties, enter 0. Leave blank ONLY if the report has no related-party note." },
];

/** Statement of cash flows (indirect method). */
export const CF_FIELDS: FieldSpec[] = [
  { key: "depreciation", label: "Depreciation adjustment", group: "cf", type: "money", periodic: true },
  // How SSM's preparers read the working-capital lines, taken from the accepted
  // filings. A single unlabelled "Changes in receivables" / "Changes in
  // payables" line is the TRADE movement — for a trading company that is what
  // the line is. Movements in amounts owing by/to directors, related parties
  // or the holding company are the OTHER movement. Yee Fatt prints exactly
  // those four lines; the model had been putting the unlabelled line in
  // "other" and dropping the directors' line for want of a home.
  { key: "cfChangeInTradeReceivables", label: "Cash flow: movement in TRADE receivables", group: "cf", type: "money", periodic: true, hint: "From the cash-flow statement, sign as printed. Put here: a line labelled trade receivables, OR a single unlabelled \"changes in receivables\" line (that IS the trade movement). Do not put director / related-party / holding-company movements here." },
  { key: "cfChangeInReceivables", label: "Cash flow: movement in OTHER receivables", group: "cf", type: "money", periodic: true, hint: "From the cash-flow statement, sign as printed. Put here: a line for other receivables / deposits / prepayments, AND any line for amounts owing BY directors, related parties or the holding company. If there are several such lines, add them together. Leave blank only if the statement has none of these." },
  { key: "cfChangeInTradePayables", label: "Change in TRADE payables", group: "cf", type: "money", periodic: true, hint: "From the cash-flow statement, sign as printed. Put here: a line labelled trade payables, OR a single unlabelled \"changes in payables\" line (that IS the trade movement). Do not put director / related-party / holding-company movements here." },
  { key: "cfChangeInOtherPayables", label: "Cash flow: movement in OTHER payables", group: "cf", type: "money", periodic: true, hint: "From the cash-flow statement, sign as printed. Put here: a line for other payables / accruals, AND any line for amounts owing TO directors, related parties or the holding company. If there are several such lines, add them together. Leave blank only if the statement has none of these." },
  { key: "cfTotalAdjustments", label: "Total adjustments to reconcile profit", group: "cf", type: "money", periodic: true },
  // The indirect-method cash flow statement has three look-alike subtotals in
  // a row. Unlabelled, the model picked "operating profit before working
  // capital changes" for LS Contracts (216,450) where the accepted filing has
  // "cash generated from operations" (21,282) — and the derived adjustments
  // line inherited the 195,168 difference.
  { key: "cfFromOperations", label: "Cash generated from / (used in) operations", group: "cf", type: "money", periodic: true, hint: "The subtotal AFTER the working-capital changes (receivables, payables, inventories, related-party movements) and BEFORE interest paid, interest received and tax paid. Often printed as \"Cash generated from operations\" or \"Net change in operations\". NOT \"operating profit before working capital changes\", which sits above the working-capital lines." },
  { key: "cfFromOperatingActivities", label: "Net cash from operating activities", group: "cf", type: "money", periodic: true, hint: "The final operating-activities total, AFTER interest paid, interest received and tax paid. Printed as \"Net cash from/(used in) operating activities\" or \"Net change in operating activities\"." },
  { key: "cfPurchaseOfPpe", label: "Purchase of property, plant and equipment", group: "cf", type: "money", periodic: true },
  { key: "cfFromInvestingActivities", label: "Net cash from investing activities", group: "cf", type: "money", periodic: true },
  { key: "incomeTaxPaid", label: "Income taxes paid", group: "cf", type: "money", periodic: true, hint: "Negative number as shown in the cash flow (an outflow)" },
  { key: "cfRepaymentOfBorrowings", label: "Repayment of borrowings", group: "cf", type: "money", periodic: true, hint: "Positive number — the gross repayment of BANK BORROWINGS and term loans only. Lease and hire-purchase payments have their own field below; do not add them in here." },
  // SSM keeps lease payments out of loan repayments. Yee Fatt's 126,336 was
  // exactly 77,945 of borrowings plus 48,391 of leases, filed as one figure.
  { key: "cfLeaseRepayments", label: "Payment of lease / hire-purchase liabilities", group: "cf", type: "money", periodic: true, hint: "Positive number. The financing-activities line for lease or hire-purchase liabilities, kept separate from bank borrowings." },
  // Two more indirect-method lines the accepted filings carry — the taxonomy
  // has boxes for them and Yee Fatt uses both (221,253 of stock movement;
  // 163,000 of disposal proceeds in the comparative year).
  { key: "cfChangeInInventories", label: "Cash flow: decrease (increase) in inventories", group: "cf", type: "money", periodic: true, hint: "The working-capital adjustment line for inventories in the cash flow statement, with the sign as printed — a decrease in stock is positive (cash released), an increase negative. Leave blank if there is no inventories line." },
  { key: "cfProceedsFromDisposalOfPpe", label: "Proceeds from disposal of property, plant and equipment", group: "cf", type: "money", periodic: true, hint: "Positive number — the investing-activities receipt from selling fixed assets, as printed. Leave blank if none." },
  { key: "cfFromFinancingActivities", label: "Net cash from financing activities", group: "cf", type: "money", periodic: true },
  { key: "cfNetIncreaseInCash", label: "Net increase / (decrease) in cash", group: "cf", type: "money", periodic: true },
];

export const FINANCIAL_FIELDS: FieldSpec[] = [...SOFP_FIELDS, ...PL_FIELDS, ...CF_FIELDS];
export const ALL_FIELDS: FieldSpec[] = [...ENTITY_FIELDS, ...FINANCIAL_FIELDS];

export const GROUP_LABELS: Record<FieldSpec["group"], string> = {
  entity: "Company & filing details",
  sofp: "Statement of financial position",
  pl: "Statement of profit or loss",
  cf: "Statement of cash flows",
};

export type EntityValues = Record<string, string>;
export type PeriodValues = Record<string, number | null>;

export interface MbrsExtraction {
  entity: EntityValues;
  current: PeriodValues;
  previous: PeriodValues;
  /** Narrative disclosure blocks keyed by XBRL concept (…Explanatory). */
  narratives: Record<string, string>;
  /** Fields the model could not find, so the review form can prompt for them. */
  missing: string[];
  /** Fields the reviewer marked not-applicable — stays blank in the filing and
   *  stops appearing in the outstanding-work list. */
  na?: string[];
  /** Free-text notes from the extractor about anything ambiguous. */
  extractionNotes?: string[];
  /** Per-field agreement across consensus runs, keyed "current.<field>" etc.
   *  Only fields that were NOT unanimous are recorded. */
  agreement?: Record<string, { level: "unanimous" | "majority" | "disputed"; candidates: Array<number | string | null> }>;
}

export function emptyExtraction(): MbrsExtraction {
  return { entity: {}, current: {}, previous: {}, narratives: {}, missing: [], na: [] };
}

/** Entity fields a filing cannot go out without — N/A is not offered here. */
export const REQUIRED_ENTITY_KEYS = [
  "entityName", "registrationNumber",
  "currentPeriodStart", "currentPeriodEnd",
  "previousPeriodStart", "previousPeriodEnd",
] as const;

/**
 * Fields that come from the company's SSM REGISTRATION record, not from its
 * audited accounts — so they must never be taken from the report, however
 * confidently an extractor offers them.
 *
 * Verified against a real filing: IOT Foresight's submitted XBRL declares
 * MSIC 71102 / 71109 / 62099 (engineering and IT services), while extraction
 * of its audited report produced "Retail sale of any kind of product over the
 * Internet" — a different industry entirely. Worse, that string is verbatim
 * MSIC 47912 vocabulary, so a label-match check "confirmed" it: the model had
 * echoed the taxonomy back, and matching against it was circular, not
 * corroborating. A wrong MSIC code on a statutory filing is materially worse
 * than a blank one the filer must fill, so these stay blank and flagged.
 *
 * `businessDescriptionN` is derived from the chosen code instead — in the real
 * filing each DescriptionOfBusiness is exactly the official MSIC label for the
 * code beside it, so code → label is authoritative rather than a guess.
 */
export const REGISTRY_ONLY_ENTITY_KEYS = [
  "msicCode1", "businessDescription1",
  "msicCode2", "businessDescription2",
  "msicCode3", "businessDescription3",
] as const;

/** Subtotals the taxonomy requires as their own facts but which sit between a
 *  note breakdown and a face amount, so nobody reads them off a statement.
 *
 *  These are recomputed from their components whenever any component is
 *  present, rather than merely filled when absent: an extractor will happily
 *  return a confident wrong value here (it reads "total adjustments" as the
 *  depreciation line, which is the only add-back with an obvious label). The
 *  components are what a reviewer can actually check against the page, so the
 *  components win. */
const DERIVED: Array<{
  key: string;
  from: string[];
  /** Subtracted from the `from` total. */
  minus?: string[];
  /** Only fill when the field is absent, instead of overwriting an extracted
   *  value. Used where the figure is normally read straight off the page and
   *  the derivation is just a fallback. */
  whenMissing?: boolean;
}> = [
  { key: "currentNontradePayables", from: ["accruals", "otherNontradePayables"] },
  // Total adjustments reconciling profit to operating cash flow. Models
  // reliably read this as "the depreciation line" because that is the only
  // add-back with an obvious label, so it is computed rather than trusted.
  // Exact by definition: the adjustments are whatever bridges profit before
  // tax to cash generated from operations. Summing the individual working-
  // capital lines was fragile (a mis-classified line broke it); this identity
  // is not. Verified: LS 21,282 - 190,459 = -169,177; Yee 324,492 - (-162,240)
  // = 486,732, both exactly the accepted filing's figure.
  { key: "cfTotalAdjustments", from: ["cfFromOperations"], minus: ["profitBeforeTax"] },
  // Operating profit before finance costs — SSM's ProfitLossFromOperatingActivities.
  // Verified: Yee -162,240 + 52,217 = -110,023, the accepted figure.
  { key: "operatingProfit", from: ["profitBeforeTax", "financeCosts"] },
  // Recoverable arithmetically when the face of the statement shows only the
  // totals. QSK's RM607,211.94 of non-current liabilities was sitting derivable
  // in the extraction the whole time, while the filing declared zero.
  { key: "totalReceivables", from: ["tradeReceivables", "otherReceivables", "prepayments", "receivablesDueFromHoldingCompany", "receivablesDueFromRelatedParties"] },
  // SSM's "other current receivables" concept is other + every related-party
  // balance; the face line we extract excludes related parties.
  { key: "otherReceivablesInclRelated", from: ["otherReceivables", "prepayments", "receivablesDueFromHoldingCompany", "receivablesDueFromRelatedParties"] },
  // SSM splits what we read as one line. Its "miscellaneous" box is the
  // non-trade balance NET of deposits, which get a box of their own, so the
  // gross figure we extract belongs in the parent concept and this net one
  // has to be computed. Verified on Yee Fatt: 792,793 - 45,300 = 747,493,
  // the accepted filing's figure exactly.
  { key: "otherReceivablesExclDeposits", from: ["otherReceivables"], minus: ["deposits"] },
  // Fallbacks: when the note states no total of its own, the balance-sheet
  // related-party line is the closest true figure. QSK and LS both file the
  // two as the same number, so this loses nothing where the note is silent.
  { key: "relatedPartyReceivablesTotal", from: ["receivablesDueFromRelatedParties"], whenMissing: true },
  { key: "relatedPartyPayablesTotal", from: ["payablesDueToRelatedParties"], whenMissing: true },
  // Where the note names only one kind of investment property, the whole
  // balance is that kind; QSK's 1,111,549 is all leasehold, with freehold nil.
  { key: "investmentPropertyOther", from: ["investmentProperty"], minus: ["investmentPropertyFreehold"], whenMissing: true },
  { key: "otherPayablesInclRelated", from: ["otherPayablesAndAccruals", "payablesDueToHoldingCompany", "payablesDueToRelatedParties"] },
  { key: "totalPayables", from: ["tradePayables", "otherPayablesAndAccruals", "payablesDueToHoldingCompany", "payablesDueToRelatedParties"] },
  {
    key: "totalNoncurrentLiabilities",
    from: ["totalLiabilities"],
    minus: ["totalCurrentLiabilities"],
    whenMissing: true,
  },
];

export const DERIVED_KEYS = new Set(DERIVED.map((d) => d.key));

/** A declared component that exactly equals its parent total is not a
 *  component — it is the total echoed back because no split was found in the
 *  note. Filing it as the named category asserts something the accounts never
 *  said (QSK Realty's investment property is leasehold; calling all of it
 *  freehold put a wrong figure in two boxes and emptied two more). Clearing it
 *  lets the catch-all category take the balance instead. */
function unsplitEcho(values: PeriodValues): PeriodValues {
  const out = { ...values };
  const total = num(out.investmentProperty);
  if (total !== null && total !== 0 && num(out.investmentPropertyFreehold) === total) {
    out.investmentPropertyFreehold = null;
  }
  return out;
}

function deriveInto(values: PeriodValues): PeriodValues {
  const out = unsplitEcho(values);
  for (const d of DERIVED) {
    if (d.whenMissing && typeof out[d.key] === "number") continue;
    const parts = d.from.map((k) => out[k]);
    const subs = (d.minus ?? []).map((k) => out[k]);
    if (parts.every((p) => typeof p !== "number")) continue;
    // A subtraction is only meaningful with both sides present, otherwise the
    // "derived" figure would silently equal the gross total.
    if (d.minus && subs.some((p) => typeof p !== "number")) continue;
    const total = parts.reduce((a: number, p) => a + (typeof p === "number" ? p : 0), 0);
    out[d.key] = subs.reduce((a: number, p) => a - (typeof p === "number" ? p : 0), total);
  }
  return out;
}

/**
 * Fills a missing component with 0 — but only where the arithmetic PROVES it
 * is nil, never where it is merely unknown.
 *
 * SSM's own filings put an explicit 0 in these boxes. Yee Fatt has no
 * investment property, and its accepted filing says so with a zero; we left
 * the box empty. But blanket zero-filling would be the original defect back
 * again — of the empty boxes measured, 63 wanted a real figure and only 25
 * wanted zero, so filling them all would file 63 false amounts.
 *
 * The test that separates the two: if the components we DID find already add
 * up to the printed total, anything missing must be nil. Yee's non-current
 * assets are 1,262,376 and its property, plant and equipment is 1,262,376 —
 * so investment property, associates and other non-current assets are proven
 * zero, not assumed. Where the sum does NOT reconcile, something real is
 * missing and the box stays blank for the reviewer.
 */
function zeroFillProvenNil(values: PeriodValues): PeriodValues {
  const out = { ...values };
  for (const r of ROLLUPS) {
    const total = num(out[r.total]);
    if (total === null) continue;
    const missing = r.parts.filter((p) => num(out[p]) === null);
    if (!missing.length || missing.length === r.parts.length) continue;
    const sum = r.parts.reduce(
      (a, p) => a + (num(out[p]) ?? 0) * (NEGATED_PARTS.has(p) ? -1 : 1),
      0,
    );
    if (Math.round(sum) === Math.round(total)) for (const p of missing) out[p] = 0;
  }
  return out;
}

/** Identifier fields SSM wants unpunctuated, but which are printed with
 *  separators on the page ("730516-08-5119", "AF : 1346"). Normalising here
 *  rather than in the prompt keeps it deterministic. */
function normalizeEntity(entity: EntityValues): EntityValues {
  const out = { ...entity };

  for (const k of ["director1Id", "director2Id"]) {
    const v = out[k];
    if (v) out[k] = v.replace(/\D/g, "");
  }

  const signing = ["director1Name", "director2Name"].filter((k) => (out[k] ?? "").trim()).length;
  if (signing > 0) out.numberOfDirectorsSigning = String(signing);

  const st = canonicalState(out.auditFirmState);
  if (st) out.auditFirmState = st;

  if (out.auditFirmRegistrationNumber) {
    // "AF : 1346" / "AF 1346" -> "AF1346"
    out.auditFirmRegistrationNumber = out.auditFirmRegistrationNumber
      .replace(/[\s:]+/g, "")
      .toUpperCase();
  }

  if (out.auditorLicenseNumber) {
    // Practising certificates print as "02144/04/2027 J"; the filing carries
    // only the membership number itself.
    const m = out.auditorLicenseNumber.match(/\d+/);
    if (m) out.auditorLicenseNumber = String(parseInt(m[0], 10));
  }

  if (out.registrationNumber) out.registrationNumber = out.registrationNumber.replace(/\D/g, "");

  return out;
}

/** Recomputes derived subtotals and normalises identifier formatting.
 *  Run before validating or generating XBRL. */
/**
 * SSM accepts only its own uppercase state names. Audited reports print the
 * honorific form ("Pahang Darul Makmur", "Penang"), which the validator
 * rejects, so fold them onto the controlled list.
 */
const STATE_CANON: Record<string, string> = {
  "pahang": "PAHANG", "pahang darul makmur": "PAHANG",
  "selangor": "SELANGOR", "selangor darul ehsan": "SELANGOR",
  "johor": "JOHOR", "johor darul takzim": "JOHOR", "johore": "JOHOR",
  "penang": "PULAU PINANG", "pulau pinang": "PULAU PINANG",
  "perak": "PERAK", "perak darul ridzuan": "PERAK",
  "kedah": "KEDAH", "kedah darul aman": "KEDAH",
  "kelantan": "KELANTAN", "kelantan darul naim": "KELANTAN",
  "melaka": "MELAKA", "malacca": "MELAKA",
  "negeri sembilan": "NEGERI SEMBILAN", "negeri sembilan darul khusus": "NEGERI SEMBILAN",
  "perlis": "PERLIS", "perlis indera kayangan": "PERLIS",
  "terengganu": "TERENGGANU", "terengganu darul iman": "TERENGGANU",
  "sabah": "SABAH", "sarawak": "SARAWAK",
  "kuala lumpur": "WILAYAH PERSEKUTUAN KUALA LUMPUR",
  "wilayah persekutuan kuala lumpur": "WILAYAH PERSEKUTUAN KUALA LUMPUR",
  "labuan": "WILAYAH PERSEKUTUAN LABUAN",
  "putrajaya": "WILAYAH PERSEKUTUAN PUTRAJAYA",
};

export function canonicalState(raw: string | undefined | null): string | null {
  if (!raw || !raw.trim()) return null;
  return STATE_CANON[raw.trim().toLowerCase()] ?? raw.trim().toUpperCase();
}

export function normalizeExtraction(x: MbrsExtraction): MbrsExtraction {
  const current = zeroFillProvenNil(deriveInto(x.current ?? {}));
  const previous = zeroFillProvenNil(deriveInto(x.previous ?? {}));
  return {
    ...x,
    entity: normalizeEntity(x.entity ?? {}),
    current: withEquityMovements(current, previous),
    // The comparative year's movement needs ITS opening balance, which only the
    // SOCE carries — so it is derived only when the extractor read it.
    previous: withEquityMovements(previous, {}),
  };
}

/**
 * The statement of changes in equity is a roll-forward: each column's movement
 * is closing minus opening. Deriving it that way is exact and survives
 * dividends and share issues, whereas assuming "movement = profit" silently
 * breaks for any company that distributed anything.
 *
 * Only the current year can be built this way — the comparative column would
 * need the balance from the year before last, which the accounts don't carry.
 */
function withEquityMovements(current: PeriodValues, previous: PeriodValues): PeriodValues {
  const out = { ...current };
  // The current year's opening balance IS last year's closing balance — fill
  // it from there when the extractor didn't read it off the SOCE directly.
  const openings: Array<[string, string]> = [
    ["openingShareCapital", "shareCapital"],
    ["openingRetainedEarnings", "retainedEarnings"],
    ["openingTotalEquity", "totalEquity"],
  ];
  for (const [opening, closing] of openings) {
    if (num(out[opening]) === null && num(previous[closing]) !== null) out[opening] = previous[closing]!;
  }
  const pairs: Array<[string, string, string]> = [
    ["equityMovementShareCapital", "shareCapital", "openingShareCapital"],
    ["equityMovementRetainedEarnings", "retainedEarnings", "openingRetainedEarnings"],
    ["equityMovementTotal", "totalEquity", "openingTotalEquity"],
  ];
  for (const [target, closing, opening] of pairs) {
    const c = num(out[closing]);
    const o = num(out[opening]);
    if (c !== null && o !== null) out[target] = c - o;
  }
  return out;
}

// ── validation ─────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: "error" | "warning";
  /** Which review-form group to jump to. */
  group: FieldSpec["group"];
  period?: Period;
  message: string;
  /** Fields involved, so the form can highlight them. */
  fields: string[];
}

interface RollUp {
  total: string;
  parts: string[];
  label: string;
  group: FieldSpec["group"];
  /** Defaults to "error". A few identities hold for most filings but not all —
   *  rental income sits inside revenue for a property company and inside other
   *  income for everyone else — so they flag for a look rather than block. */
  severity?: ValidationIssue["severity"];
}

/** Arithmetic identities that must hold in any well-formed MPERS filing.
 *  These are what catch an OCR digit slip before it reaches SSM. */
const ROLLUPS: RollUp[] = [
  { total: "totalAssets", parts: ["totalNoncurrentAssets", "totalCurrentAssets"], label: "Total assets = non-current + current assets", group: "sofp" },
  { total: "totalNoncurrentAssets", parts: ["propertyPlantAndEquipment", "investmentProperty", "investmentsInAssociates", "otherInvestments", "otherNoncurrentAssets"], label: "Non-current assets = PPE + investment property + associates + investments + other", group: "sofp" },
  { total: "totalCurrentAssets", parts: ["inventories", "tradeReceivables", "otherReceivables", "prepayments", "receivablesDueFromHoldingCompany", "receivablesDueFromRelatedParties", "currentTaxAssets", "cashAndCashEquivalents"], label: "Current assets = inventories + receivables + cash", group: "sofp" },
  { total: "totalLiabilities", parts: ["totalCurrentLiabilities", "totalNoncurrentLiabilities"], label: "Total liabilities = current + non-current", group: "sofp" },
  { total: "totalEquity", parts: ["shareCapital", "retainedEarnings"], label: "Equity = share capital + retained earnings", group: "sofp" },
  { total: "totalCurrentLiabilities", parts: ["tradePayables", "otherPayablesAndAccruals", "payablesDueToHoldingCompany", "payablesDueToRelatedParties", "currentTaxLiabilities", "currentBorrowings"], label: "Current liabilities = trade + other payables + related parties + tax + borrowings", group: "sofp" },
  { total: "otherPayablesAndAccruals", parts: ["accruals", "otherNontradePayables"], label: "Other payables note reconciles to the face amount", group: "sofp" },
  { total: "profitBeforeTax", parts: ["grossProfit", "otherIncome", "administrativeExpenses", "sellingAndDistributionExpenses", "otherOperatingExpenses", "financeCosts"], label: "Profit before tax = gross profit + other income − expenses − finance costs", group: "pl" },
  // SSM files an explicit 0 against the revenue categories a company does not
  // use, and this identity proves which those are: LS Contracts sells only
  // services, so goods are nil; Yee Fatt only goods; QSK's 66,784 is 32,684 of
  // goods plus 34,100 of rent, so services are nil. Where the parts do not
  // reconcile nothing is filled, so a company whose rent sits in other income
  // is left alone rather than zeroed wrongly.
  { total: "revenue", parts: ["revenueFromGoods", "revenueFromServices", "rentalIncome"], label: "Revenue = goods + services + rental", group: "pl", severity: "warning" },
];

const NEGATED_PARTS = new Set(["administrativeExpenses", "sellingAndDistributionExpenses", "otherOperatingExpenses", "financeCosts"]);

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Runs the arithmetic checks over one period's figures. */
function validatePeriod(values: PeriodValues, period: Period): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const r of ROLLUPS) {
    const total = num(values[r.total]);
    const parts = r.parts.map((p) => ({ key: p, v: num(values[p]) }));
    // Skip when the line genuinely isn't present — a company with no fixed
    // assets shouldn't be nagged. Only check when we have the total and at
    // least one component.
    if (total === null || parts.every((p) => p.v === null)) continue;
    const sum = parts.reduce(
      (a, p) => a + (p.v ?? 0) * (NEGATED_PARTS.has(p.key) ? -1 : 1),
      0,
    );
    if (Math.round(sum) !== Math.round(total)) {
      issues.push({
        severity: r.severity ?? "error",
        group: r.group,
        period,
        message: `${r.label} — expected ${fmt(total)}, components total ${fmt(sum)} (out by ${fmt(Math.abs(total - sum))}).`,
        fields: [r.total, ...r.parts],
      });
    }
  }

  // The balance sheet must balance. This is the single most important check:
  // SSM's own validator rejects the submission outright when it fails.
  const assets = num(values.totalAssets);
  const eqLiab = num(values.totalEquityAndLiabilities);
  if (assets !== null && eqLiab !== null && Math.round(assets) !== Math.round(eqLiab)) {
    issues.push({
      severity: "error",
      group: "sofp",
      period,
      message: `Balance sheet does not balance — total assets ${fmt(assets)} vs total equity and liabilities ${fmt(eqLiab)}.`,
      fields: ["totalAssets", "totalEquityAndLiabilities"],
    });
  }

  const equity = num(values.totalEquity);
  const liabilities = num(values.totalLiabilities);
  if (assets !== null && equity !== null && liabilities !== null &&
      Math.round(equity + liabilities) !== Math.round(assets)) {
    issues.push({
      severity: "error",
      group: "sofp",
      period,
      message: `Equity ${fmt(equity)} + liabilities ${fmt(liabilities)} does not equal total assets ${fmt(assets)}.`,
      fields: ["totalEquity", "totalLiabilities", "totalAssets"],
    });
  }

  const pbt = num(values.profitBeforeTax);
  const tax = num(values.taxExpense);
  const pat = num(values.profitAfterTax);
  if (pbt !== null && tax !== null && pat !== null &&
      Math.round(pbt - tax) !== Math.round(pat)) {
    issues.push({
      severity: "error",
      group: "pl",
      period,
      message: `Profit after tax ${fmt(pat)} does not equal profit before tax ${fmt(pbt)} less tax ${fmt(tax)}.`,
      fields: ["profitBeforeTax", "taxExpense", "profitAfterTax"],
    });
  }

  return issues;
}

/** Full pre-generation check. Errors block XBRL generation; warnings don't. */
/**
 * The one Filing-Information profile our XBRL template was derived from.
 * mTool builds a DIFFERENT template set for each combination, so a filing
 * outside this profile needs a different template, not a best-effort fill.
 */
export const TEMPLATE_PROFILE = {
  basis: "MPERS",
  type: "Separate",
  format: "By function",
} as const;

/** Loose contains-match: the extractor returns prose, not an enum. */
function says(v: string | undefined, ...needles: string[]): boolean {
  const t = (v ?? "").toLowerCase();
  return needles.some((n) => t.includes(n));
}

/**
 * Refuses filings whose scoping differs from the template's. Silently emitting
 * a Separate / by-function / MPERS instance for a consolidated, by-nature or
 * MFRS company would produce a structurally wrong submission that still looks
 * plausible — the worst failure mode for a statutory return.
 */
export function validateProfile(entity: EntityValues): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (says(entity.financialStatementsType, "consolidat")) {
    out.push({
      severity: "error", group: "entity",
      message: "These are CONSOLIDATED financial statements. This workflow generates a Separate-entity FS-MPERS instance; SSM requires a different template set (with Consolidated columns) for a group filing.",
      fields: ["financialStatementsType"],
    });
  }
  if (says(entity.basisOfAccounting, "mfrs") && !says(entity.basisOfAccounting, "mpers")) {
    out.push({
      severity: "error", group: "entity",
      message: "These accounts are prepared under MFRS, not MPERS. FS-MFRS uses a different SSM taxonomy and template set.",
      fields: ["basisOfAccounting"],
    });
  }
  if (says(entity.incomeStatementFormat, "by nature", "nature")) {
    out.push({
      severity: "error", group: "entity",
      message: "The income statement is presented BY NATURE. This template is the by-function variant (cost of sales / gross profit); mTool generates different templates for the two.",
      fields: ["incomeStatementFormat"],
    });
  }
  if (says(entity.auditStatus, "unaudited")) {
    out.push({
      severity: "warning", group: "entity",
      message: "Accounts are marked UNAUDITED — confirm the audit-status and auditor fields before filing.",
      fields: ["auditStatus"],
    });
  }
  return out;
}

/**
 * Turns consensus disagreement into reviewer-facing warnings. A disputed
 * field has been left blank on purpose — the runs could not agree, so nothing
 * was filed and the reviewer decides. A majority field IS filed, but the
 * minority reading is shown so an honest 2-vs-1 split is not mistaken for
 * certainty.
 */
function validateAgreement(x: MbrsExtraction): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const fmt = (v: number | string | null) =>
    v === null ? "—" : typeof v === "number" ? v.toLocaleString("en-MY", { maximumFractionDigits: 2 }) : String(v);
  const label = (key: string) => ALL_FIELDS.find((f) => f.key === key)?.label ?? key;
  for (const [k, ag] of Object.entries(x.agreement ?? {})) {
    const [scope, field] = k.split(".");
    const group: FieldSpec["group"] = ALL_FIELDS.find((f) => f.key === field)?.group ?? "sofp";
    const period = scope === "current" || scope === "previous" ? (scope as Period) : undefined;
    const readings = ag.candidates.map(fmt).join(" / ");
    if (ag.level === "disputed") {
      out.push({
        severity: "warning", group, period,
        message: `${label(field)}${period ? ` (${period})` : ""}: extraction runs disagreed — ${readings}. Left blank; confirm from the report.`,
        fields: [field],
      });
    } else if (ag.level === "majority") {
      out.push({
        severity: "warning", group, period,
        message: `${label(field)}${period ? ` (${period})` : ""}: 2 of 3 runs agree — ${readings}. Worth a glance.`,
        fields: [field],
      });
    }
  }
  return out;
}

export function validateExtraction(x: MbrsExtraction): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const blank = REQUIRED_ENTITY_KEYS.filter((k) => !String(x.entity[k] ?? "").trim());
  if (blank.length) {
    issues.push({
      severity: "error",
      group: "entity",
      message: `Required filing details are missing: ${blank
        .map((k) => ENTITY_FIELDS.find((f) => f.key === k)?.label ?? k)
        .join(", ")}.`,
      fields: blank,
    });
  }

  for (const k of ["currentPeriodStart", "currentPeriodEnd", "previousPeriodStart", "previousPeriodEnd"]) {
    const v = String(x.entity[k] ?? "").trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      issues.push({
        severity: "error", group: "entity",
        message: `${ENTITY_FIELDS.find((f) => f.key === k)?.label ?? k} must be a yyyy-mm-dd date (got "${v}").`,
        fields: [k],
      });
    }
  }

  const cs = x.entity.currentPeriodStart, ce = x.entity.currentPeriodEnd;
  if (cs && ce && cs >= ce) {
    issues.push({
      severity: "error", group: "entity",
      message: "Current financial year start must fall before its end date.",
      fields: ["currentPeriodStart", "currentPeriodEnd"],
    });
  }

  const reg = String(x.entity.registrationNumber ?? "").trim();
  if (reg && !/^\d{12}$/.test(reg)) {
    issues.push({
      severity: "warning", group: "entity",
      message: `Registration number "${reg}" is not the expected 12-digit MyCoID format.`,
      fields: ["registrationNumber"],
    });
  }

  issues.push(...validateProfile(x.entity ?? {}));
  issues.push(...validateAgreement(x));
  issues.push(...validatePeriod(x.current, "current"));
  issues.push(...validatePeriod(x.previous, "previous"));

  const missingNarratives = NARRATIVE_CONCEPTS.filter(
    (c) => !String(x.narratives?.[c] ?? "").trim(),
  );
  if (missingNarratives.length) {
    issues.push({
      severity: "warning",
      group: "entity",
      message: `${missingNarratives.length} of ${NARRATIVE_CONCEPTS.length} narrative disclosure blocks are empty and would be submitted blank.`,
      fields: [],
    });
  }

  return issues;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(n);
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
