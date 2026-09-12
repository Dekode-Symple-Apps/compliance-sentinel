#!/usr/bin/env python3
"""Regenerate src/lib/mbrs-template.ts and src/lib/mbrs-narratives.ts from a
real SSM MBRS instance document.

    python3 scripts/gen-mbrs-template.py path/to/SSM_FS-MPERS_<reg>_<yyyymmdd>.xml

WHY THIS EXISTS
SSM's taxonomy package (.xsd + linkbases) is not vendored in this repo, so a
real filing produced by SSM's own MBRS Preparation Tool is the only
authoritative description of the required fact set we have. This script lifts
the skeleton — every context, unit, concept and structural zero — verbatim, and
binds only the facts that carry company data to canonical fields from
src/lib/mbrs.ts.

The generated template is checked by a round-trip: feeding the sample's own
figures back through src/lib/mbrs-xbrl.ts must reproduce the source file
fact-for-fact.

To support a new filing variant (FS-MFRS, a different taxonomy year), run this
against a sample of that variant and extend the mapping tables below.
"""
import json
import re
import sys
from datetime import date, timedelta
from xml.sax.saxutils import unescape as _unescape

SRC_DIR = "src/lib"

# Dates in the reference filing, replaced by tokens the generator resolves per
# company. {PPE} is the day before the previous period starts — the opening
# balance instant for the comparative statement of changes in equity.
DATES = {
    "20250630": "{CE}",
    "20240901": "{CS}",
    "20240831": "{PE}",
    "20230901": "{PS}",
    "20230831": "{PPE}",
}
ISO = {
    "2025-06-30": "{CE-}", "2024-09-01": "{CS-}",
    "2024-08-31": "{PE-}", "2023-09-01": "{PS-}", "2023-08-31": "{PPE-}",
}
ENTITY_ID = "202101011095"

# ── concept → canonical field ──────────────────────────────────────────────
SOFP = {
    "ifrs-smes:PropertyPlantAndEquipment": "propertyPlantAndEquipment",
    "ifrs-smes:NoncurrentAssets": "totalNoncurrentAssets",
    "ssmt-mpers:OtherCurrentReceivables": "otherReceivablesInclRelated",
    "ssmt-mpers:OtherCurrentReceivablesDueFromHoldingCompany": "receivablesDueFromHoldingCompany",
    "ssmt-mpers:OtherCurrentReceivablesDueFromRelatedParties": "receivablesDueFromRelatedParties",
    "ifrs-smes:AmountsReceivableRelatedPartyTransactions": "relatedPartyReceivablesTotal",
    "ifrs-smes:AmountsPayableRelatedPartyTransactions": "relatedPartyPayablesTotal",
    "ifrs-smes:Buildings": "buildings",
    "ssmt-mpers:OfficeEquipmentFixtureAndFittings": "officeEquipment",
    # Same story as inventories: unbound, and frozen at the donors' zero.
    "ifrs-smes:LandAndBuildings": "buildings",
    "ifrs-smes:OtherPropertyPlantAndEquipment": "otherPropertyPlantAndEquipment",
    "ifrs-smes:CurrentTaxAssetsCurrent": "currentTaxAssets",
    "ifrs-smes:CashAndCashEquivalents": "cashAndCashEquivalents",
    "ifrs-smes:Cash": "cashAndCashEquivalents",
    "ifrs-smes:BalancesWithBanks": "cashAndCashEquivalents",
    "ssmt:CashAndBankBalances": "cashAndCashEquivalents",
    "ifrs-smes:CurrentAssets": "totalCurrentAssets",
    "ifrs-smes:Assets": "totalAssets",
    "ifrs-smes:IssuedCapital": "shareCapital",
    "ssmt-mpers:CapitalFromOrdinaryShares": "shareCapital",
    "ifrs-smes:RetainedEarnings": "retainedEarnings",
    "ifrs-smes:EquityAttributableToOwnersOfParent": "totalEquity",
    # WAS MISSING: plain ifrs-smes:Equity fell through to the reference
    # company's literal, filing IOT Foresight's RM15,322 as every company's
    # total equity.
    "ifrs-smes:Equity": "totalEquity",
    # The SOCE "total" column on a plain context: opening balance is last
    # year's closing equity, and the movement row is the derived roll-forward.
    "ssmt-mpers:EquityBalanceRestated": "totalEquity",
    "ifrs-smes:ChangesInEquity": "equityMovementTotal",
    # Face-of-statement receivables total, i.e. trade + other.
    "ifrs-smes:TradeAndOtherCurrentReceivables": "totalReceivables",
    "ifrs-smes:InvestmentProperty": "investmentProperty",
    "ifrs-smes:InvestmentsInAssociates": "investmentsInAssociates",
    "ifrs-smes:Inventories": "inventories",
    "ssmt-mpers:InventoriesTotal": "inventories",
    # The filings use the ifrs-smes namespace for this one. Mapped only under
    # ssmt-mpers, it stayed unbound — and both donors are property companies
    # holding no stock, so the generator froze their shared "0" into the box.
    # Yee Fatt is a car dealer; its 458,751 of vehicles could never appear.
    "ifrs-smes:InventoriesTotal": "inventories",
    # Real concept names, learned from the multi-donor literal diff — the
    # ifrs-smes spellings guessed earlier never appear in an actual filing.
    "ssmt-mpers:CurrentTradeReceivables": "tradeReceivables",
    "ssmt-mpers:OtherCurrentTradeReceivables": "tradeReceivables",
    "ssmt-mpers:OtherCurrentNontradeReceivables": "otherReceivables",
    "ssmt-mpers:OtherCurrentPrepaymentsAndCurrentAccruedIncome": "prepayments",
    "ssmt-mpers:OtherCurrentNontradeDeposits": "deposits",
    "ssmt-mpers:OtherCurrentPrepayments": "prepayments",
    "ssmt-mpers:PlantAndEquipment": "plantAndEquipment",
    "ifrs-smes:Vehicles": "vehicles",
    "ssmt-mpers:OtherInvestmentProperty": "investmentProperty",
    "ssmt-mpers:InvestmentPropertyFreeholdLandAndBuilding": "investmentProperty",
    "ssmt-mpers:NoncurrentInvestmentsOtherThanInvestmentsAccountedForUsingEquityMethod": "otherInvestments",
    "ssmt-mpers:OtherCurrentMiscellaneousNontradeReceivables": "otherReceivablesExclDeposits",
    "ssmt-mpers:OtherCurrentPayablesDueToOtherRelatedParties": "payablesDueToRelatedParties",
    "ssmt-mpers:InvestmentsInAssociatesUnquotedSharesNetOfImpairmentLosses": "investmentsInAssociates",
    "ssmt-mpers:InvestmentPropertyFreeholdLandAndBuilding": "investmentPropertyFreehold",
    "ssmt-mpers:OtherInvestmentProperty": "investmentPropertyOther",
    "ssmt-mpers:CurrentSecuredBankLoansReceivedAndCurrentPortionOfNoncurrentSecuredBankLoansReceived": "currentBankLoans",
    "ssmt-mpers:CurrentPortionOfFinanceLeaseLiabilities": "financeLeaseCurrent",
    "ssmt-mpers:NoncurrentPortionOfFinanceLeaseLiabilities": "financeLeaseNoncurrent",
    "ssmt-mpers:OtherCurrentReceivablesDueFromOtherRelatedParties": "receivablesDueFromRelatedParties",
    "ssmt-mpers:NoncurrentPortionOfNoncurrentSecuredBankLoansReceived": "noncurrentBankLoans",
    "ifrs-smes:TradeAndOtherCurrentPayables": "totalPayables",
    "ssmt-mpers:NoncurrentBorrowings": "noncurrentBorrowings",
    "ifrs-smes:ShorttermBorrowings": "currentBorrowings",
    "ssmt-mpers:AmountOfSharesIssuedAndFullyPaidOutstanding": "shareCapital",
    "ifrs-smes:NumberOfSharesIssuedAndFullyPaid": "numberOfShares",
    "ifrs-smes:TradeAndOtherCurrentReceivablesToTradeCustomers": "tradeReceivables",
    "ifrs-smes:NoncurrentLiabilities": "totalNoncurrentLiabilities",
    "ifrs-smes:NoncurrentPortionOfNoncurrentBorrowings": "noncurrentBorrowings",
    "ifrs-smes:DeferredTaxLiabilities": "deferredTaxLiabilities",
    "ifrs-smes:CurrentBorrowings": "currentBorrowings",
    "ssmt-mpers:OtherCurrentTradePayables": "tradePayables",
    "ifrs-smes:TradeAndOtherCurrentPayablesToTradeSuppliers": "tradePayables",
    "ssmt-mpers:OtherCurrentPayables": "otherPayablesInclRelated",
    # Subtotal BELOW the face amount: accruals + other non-trade payables,
    # i.e. the face amount less the holding-company balance.
    "ssmt-mpers:CurrentNontradePayables": "currentNontradePayables",
    "ssmt-mpers:CurrentNontradeAccruals": "accruals",
    "ssmt-mpers:OtherCurrentNontradePayables": "otherNontradePayables",
    "ssmt-mpers:OtherCurrentPayablesDueToHoldingCompany": "payablesDueToHoldingCompany",
    "ssmt-mpers:OtherCurrentPayablesDueToRelatedParties": "payablesDueToRelatedParties",
    "ifrs-smes:CurrentTaxLiabilitiesCurrent": "currentTaxLiabilities",
    "ifrs-smes:CurrentLiabilities": "totalCurrentLiabilities",
    "ifrs-smes:Liabilities": "totalLiabilities",
    "ifrs-smes:EquityAndLiabilities": "totalEquityAndLiabilities",
}
PL = {
    "ifrs-smes:Revenue": "revenue",
    # Both donors happened to file 0 here, so the multi-donor agreement rule
    # read it as a constant and froze "0" into the template — which is how
    # LS Contracts' real RM4,000 audit fee could never appear in any filing.
    "ssmt-mpers:AuditorsRemuneration": "auditorsRemuneration",
    # SSM's calc tree: AuditorsRemuneration = ForAuditServices + ForOtherServices.
    # A company with one auditor and no non-audit fees files the whole amount
    # under audit services (LS Contracts: 4,000 in both).
    "ssmt-mpers:AuditorsRemunerationForAuditServices": "auditorsRemuneration",
    "ifrs-smes:DepreciationPropertyPlantAndEquipment": "depreciation",
    "ssmt-mpers:GainsOnDisposalsOfPropertyPlantAndEquipment": "gainsOnDisposal",
    # Split by nature. Binding both to one "revenue" field emitted the full
    # amount twice; every filing reports one and zero for the other.
    "ifrs-smes:RevenueFromRenderingOfServices": "revenueFromServices",
    "ssmt-mpers:RevenueFromRenderingOfOtherServices": "revenueFromServices",
    "ifrs-smes:RevenueFromSaleOfGoods": "revenueFromGoods",
    "ssmt-mpers:RevenueFromSaleOfOtherGoods": "revenueFromGoods",
    "ifrs-smes:GrossProfit": "grossProfit",
    "ifrs-smes:AdministrativeExpense": "administrativeExpenses",
    "ifrs-smes:OtherIncome": "otherIncome",
    "ssmt-mpers:RentalIncome": "rentalIncome",
    "ssmt-mpers:OtherIncomeDividend": "dividendIncome",
    "ssmt-mpers:OtherInterestIncome": "interestIncome",
    "ssmt-mpers:GainsOnDisposalsOfNoncurrentAssets": "gainsOnDisposal",
    "ifrs-smes:OtherOperatingExpense": "otherOperatingExpenses",
    "ifrs-smes:OtherExpenseByFunction": "otherOperatingExpenses",
    "ssmt-mpers:SellingAndDistributionExpenses": "sellingAndDistributionExpenses",
    "ifrs-smes:CostOfSales": "costOfSales",
    "ssmt-mpers:OtherCostOfSales": "costOfSales",
    "ifrs-smes:CostOfInventories": "costOfSales",
    # The filings state it under ssmt-mpers; unbound under that name it was
    # frozen at the donors' zero — the inventories bug again, one row down.
    "ssmt-mpers:CostOfInventories": "costOfSales",
    "ifrs-smes:FinanceCosts": "financeCosts",
    "ifrs-smes:KeyManagementPersonnelCompensation": "keyManagementCompensation",
    "ssmt-mpers:DividendIncomeRelatedPartyTransactions": "relatedPartyDividendIncome",
    "ssmt-mpers:RevenueFromSaleOfGoodsRelatedPartyTransactions": "relatedPartyRevenueGoods",
    "ssmt-mpers:RevenueFromRenderingOfServicesRelatedPartyTransactions": "relatedPartyRevenueServices",
    "ssmt-mpers:RentalExpensesRelatedPartyTransactions": "relatedPartyRentalExpense",
    "ifrs-smes:ProfitLossBeforeTax": "profitBeforeTax",
    "ssmt-mpers:AggregateProfitLossBeforeTax": "profitBeforeTax",
    "ssmt-mpers:ProfitLossFromOperatingActivities": "operatingProfit",
    "ifrs-smes:IncomeTaxExpenseContinuingOperations": "taxExpense",
    "ifrs-smes:ProfitLoss": "profitAfterTax",
    "ifrs-smes:ProfitLossFromContinuingOperations": "profitAfterTax",
    "ifrs-smes:ProfitLossAttributableToOwnersOfParent": "profitAfterTax",
    "ifrs-smes:ComprehensiveIncome": "profitAfterTax",
    "ifrs-smes:ComprehensiveIncomeAttributableToOwnersOfParent": "profitAfterTax",
}
CF = {
    "ssmt-mpers:AdjustmentsForDepreciationExpense": "depreciation",
    "ifrs-smes:AdjustmentsForDecreaseIncreaseInOtherOperatingReceivables": "cfChangeInReceivables",
    "ifrs-smes:AdjustmentsForDecreaseIncreaseInTradeAccountReceivable": "cfChangeInTradeReceivables",
    "ifrs-smes:AdjustmentsForIncreaseDecreaseInTradeAccountPayable": "cfChangeInTradePayables",
    "ifrs-smes:AdjustmentsForIncreaseDecreaseInOtherOperatingPayables": "cfChangeInOtherPayables",
    "ifrs-smes:AdjustmentsForReconcileProfitLoss": "cfTotalAdjustments",
    "ssmt-mpers:CashFlowsFromUsedInOperations": "cfFromOperations",
    "ifrs-smes:CashFlowsFromUsedInOperatingActivities": "cfFromOperatingActivities",
    "ifrs-smes:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "cfPurchaseOfPpe",
    "ifrs-smes:CashFlowsFromUsedInInvestingActivities": "cfFromInvestingActivities",
    "ifrs-smes:CashFlowsFromUsedInFinancingActivities": "cfFromFinancingActivities",
    "ifrs-smes:RepaymentsOfBorrowingsClassifiedAsFinancingActivities": "cfRepaymentOfBorrowings",
    "ifrs-smes:PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities": "cfLeaseRepayments",
    # Indirect-method reconciliation lines the accepted filings carry and we
    # had no box for. The disposal gain and finance income enter the calc tree
    # with weight -1; the fact itself is stated positive, as in the accounts.
    "ssmt-mpers:GainsLossesOnDisposalsOfPropertyPlantAndEquipment": "gainsOnDisposal",
    "ssmt-mpers:AdjustmentsForFinanceIncome": "interestIncome",
    "ifrs-smes:InterestReceivedClassifiedAsOperatingActivities": "interestIncome",
    "ifrs-smes:AdjustmentsForDecreaseIncreaseInInventories": "cfChangeInInventories",
    "ifrs-smes:ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "cfProceedsFromDisposalOfPpe",
    "ifrs-smes:IncomeTaxesPaidRefundClassifiedAsOperatingActivities": "incomeTaxPaid",
    # add-back of finance costs in the operating reconciliation = the P&L line
    "ifrs-smes:AdjustmentsForFinanceCosts": "financeCosts",
    "ifrs-smes:IncreaseDecreaseInCashAndCashEquivalents": "cfNetIncreaseInCash",
    "ifrs-smes:IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges": "cfNetIncreaseInCash",
}
DEI = {
    "ssmt-dei:NewCompanyRegistrationNumber": "registrationNumber",
    "ssmt-dei:CompanyRegistrationNumber": "oldRegistrationNumber",
    "ssmt-dei:NameOfReportingEntity": "entityName",
    "ssmt-dei:CompanyCurrentFinancialYearStartDate": "currentPeriodStart",
    "ssmt-dei:CompanyCurrentFinancialYearEndDate": "currentPeriodEnd",
    "ssmt-dei:CompanyPreviousFinancialYearStartDate": "previousPeriodStart",
    "ssmt-dei:CompanyPreviousFinancialYearEndDate": "previousPeriodEnd",
    "ssmt:NumberOfEmployees": "numberOfEmployees",
    "ssmt:TypeOfAuditorsOpinion": "auditorsOpinion",
    "ssmt:DisclosureOfStatusOfDividend": "dividendStatus",
    "ssmt:BasisOfAccountingStandardsAppliedToPrepareFinancialStatements": "basisOfAccounting",
    "ssmt:DisclosureOfFinancialStatementsAuditStatus": "auditStatus",
    "ssmt:DisclosureOfDirectorsReceivedOrBecomeEntitledToReceiveOtherBenefitsByReasonOfContractMadeByCompanyOrRelatedCorporation": "directorsOtherBenefits",
    "ssmt:DisclosureOfContingentOrOtherLiabilityBeingEnforceableWithinTwelveMonthsAfterEndOfFinancialYear": "contingentLiabilityEnforceable",
    "ssmt:DisclosureOfOccurenceOfAnySubstantialMaterialOrUnusualInNatureItemsTransactionsOrEvents": "materialUnusualEvents",
    "ssmt:DateOfSigningAuditorsReport": "auditorReportDate",
    "ssmt:LicenseNumberOfAuditor": "auditorLicenseNumber",
    "ssmt:NameOfAuditorSigningReport": "auditorName",
    "ssmt:RegistrationNumberOfAuditFirm": "auditFirmRegistrationNumber",
    "ssmt:NameOfAuditFirm": "auditFirmName",
    "ssmt:AddressOne": "auditFirmAddress",
    "ssmt:PostcodeOfAuditFirm": "auditFirmPostcode",
    "ssmt:TownWhereAuditFirmIsLocated": "auditFirmTown",
    "ssmt:StateWhereAuditFirmIsLocated": "auditFirmState",
    "ssmt:NameOfFirstDirectorWhoSignedDirectorsReport": "director1Name",
    "ssmt:IdentificationNumberOfFirstDirectorWhoSignedDirectorsReport": "director1Id",
    "ssmt:NameOfSecondDirectorWhoSignedDirectorsReport": "director2Name",
    "ssmt:IdentificationNumberOfSecondDirectorWhoSignedDirectorsReport": "director2Id",
    "ssmt:NameOfFirstDirectorWhoSignedStatementByDirectors": "director1Name",
    "ssmt:IdentificationNumberOfFirstDirectorWhoSignedStatementByDirectors": "director1Id",
    "ssmt:NameOfSecondDirectorWhoSignedStatementByDirectors": "director2Name",
    "ssmt:IdentificationNumberOfSecondDirectorWhoSignedStatementByDirectors": "director2Id",
    "ssmt:DateOfSigningDirectorsReport": "directorsReportDate",
    "ssmt:DateOfSigningStatementByDirectors": "directorsReportDate",
    "ssmt:NumberOfDirectorsSigningDirectorsReport": "numberOfDirectorsSigning",
    "ssmt:NumberOfDirectorsSigningStatementByDirectors": "numberOfDirectorsSigning",
    # These three carried the reference filing's literals (2027-12-31), while
    # the real dates sat extracted and unused.
    "ssmt:DateOfFinancialStatementsApprovedByBoardOfDirectors": "boardApprovalDate",
    "ssmt:DateOfStatutoryDeclaration": "statutoryDeclarationDate",
    "ssmt:DateOfCirculationOfFinancialStatementsAndReportsToMembers": "circulationDate",
}
# A company declares up to three business activities, each on its own
# NatureOfBusinessAxis member with its OWN MSIC code and description.
BUSINESS_SLOTS = {"BusinessOneMember": "1", "BusinessTwoMember": "2", "BusinessThreeMember": "3"}
# Statement-of-changes-in-equity columns. The grid is a breakdown of equity by
# component, NOT a restatement of the plain-context figure, so each column binds
# to its own field.
EQUITY_COMPONENTS = {
    "IssuedCapitalMember": "shareCapital",
    "RetainedEarningsMember": "retainedEarnings",
    # The "total" column of the grid.
    "EquityAttributableToOwnersOfParentMember": "totalEquity",
}
# Both carry a per-component equity balance; EquityBalanceRestated is the
# opening column, ifrs-smes:Equity the closing one.
EQUITY_CONCEPTS = {"ifrs-smes:Equity", "ssmt-mpers:EquityBalanceRestated"}
# At the {PPE} instant the same concepts mean the OPENING balance of the
# comparative year, which lives under separate keys in the previous bag.
OPENING_COMPONENTS = {
    "IssuedCapitalMember": "openingShareCapital",
    "RetainedEarningsMember": "openingRetainedEarnings",
    "EquityAttributableToOwnersOfParentMember": "openingTotalEquity",
}

# Movement rows on the grid's total column. Profit attributable to owners is
# profit after tax for a company with no non-controlling interests, which is
# every FS-MPERS filer. ChangesInEquity and EquityBalanceRestated are
# deliberately NOT bound: the first also absorbs share issues and dividends,
# the second is an opening balance whose period is ambiguous in this context
# set — guessing either would put a wrong number back into the filing.
EQUITY_MOVEMENT_CONCEPTS = {
    "ifrs-smes:ProfitLoss": "profitAfterTax",
    "ifrs-smes:ComprehensiveIncome": "profitAfterTax",
}
# The profit row lands in retained earnings, so both the total column and the
# retained-earnings column carry profit after tax.
EQUITY_MOVEMENT_MEMBERS = ("EquityAttributableToOwnersOfParentMember", "RetainedEarningsMember")

# The "total movement" row: closing minus opening per component, derived in
# mbrs.ts. Never equal to profit when a dividend or share issue occurred.
EQUITY_CHANGE_FIELDS = {
    "IssuedCapitalMember": "equityMovementShareCapital",
    "RetainedEarningsMember": "equityMovementRetainedEarnings",
    "EquityAttributableToOwnersOfParentMember": "equityMovementTotal",
}

# The "Parent" column of the related-party grid — the holding company, whose
# balance we already read off the face of the statement.
RELATED_PARTY_PARENT = {
    "ifrs-smes:AmountsReceivableRelatedPartyTransactions": "receivablesDueFromHoldingCompany",
    "ifrs-smes:AmountsPayableRelatedPartyTransactions": "payablesDueToHoldingCompany",
}

BUSINESS_CONCEPTS = {
    "ssmt:MSICCode": "msicCode",
    "ssmt:DescriptionOfBusiness": "businessDescription",
}

FACT_RE = re.compile(
    r"<((?:ifrs-smes|ssmt|ssmt-mpers|ssmt-dei[\w-]*|ifrs-full)[:\w.-]+)([^>]*?)>(.*?)</\1>", re.S
)
PLAIN_CTX = re.compile(r"^(?:asof_\{\w+\}|fromto_\{\w+\}_\{\w+\})(?:_SeparateMember)?$")


def unesc(s):
    """XML text -> raw string. Everything downstream stores values unescaped;
    mbrs-xbrl.ts escapes exactly once on output."""
    return _unescape(s or "", {"&quot;": '"', "&apos;": "'"})


def tok(s, table):
    for k, v in table.items():
        s = s.replace(k, v)
    return s


def period_of(ctx):
    if not ctx:
        return None
    if "{CS}_{CE}" in ctx or re.search(r"asof_\{CE\}", ctx):
        return "current"
    if "{PS}_{PE}" in ctx or re.search(r"asof_\{PE\}", ctx):
        return "previous"
    # The instant before the comparative year opens: the SOCE's earliest
    # balance row. Belongs to the previous bag under its opening* keys.
    if re.search(r"asof_\{PPE\}", ctx):
        return "opening"
    return None


def resolve(concept, ctx):
    if concept in BUSINESS_CONCEPTS and ctx:
        for member, n in BUSINESS_SLOTS.items():
            if ctx.endswith("_" + member):
                return (f"{BUSINESS_CONCEPTS[concept]}{n}", None)
        return None
    if concept in DEI:
        return (DEI[concept], None)
    p = period_of(ctx)
    if p is None:
        return None
    if p == "opening":
        # The comparative year's opening cash sits at this instant too — the
        # only non-equity fact SSM states at {PPE}.
        if concept == "ifrs-smes:CashAndCashEquivalents" and PLAIN_CTX.match(ctx or ""):
            return ("openingCashAndCashEquivalents", "previous")
        if concept not in EQUITY_CONCEPTS:
            return None
        if PLAIN_CTX.match(ctx or ""):
            return ("openingTotalEquity", "previous")
        for member, field in OPENING_COMPONENTS.items():
            if (ctx or "").endswith("_" + member):
                return (field, "previous")
        return None
    # SSM states the share-capital figures twice: once undimensioned, and once
    # tagged OrdinarySharesMember. Same company, same number — the member names
    # the class of share, nothing more. Only the plain twin was bound, leaving
    # the dimensioned one permanently empty. No equity-grid map uses this
    # member, so folding it away here cannot disturb the SOCE columns below.
    if ctx and ctx.endswith("_OrdinarySharesMember"):
        ctx = ctx[: -len("_OrdinarySharesMember")]

    # The related-party note is a grid: an undimensioned total plus one column
    # per class of related party. The "Parent" column is exactly our holding
    # company balance — including when it is nil, which is what all three
    # filings state and what we were leaving blank.
    if (ctx or "").endswith("_ParentMember") and concept in RELATED_PARTY_PARENT:
        return (RELATED_PARTY_PARENT[concept], p)
    # Key management personnel compensation under the key-management column is
    # definitional — the concept and the member name the same people — so the
    # figure the plain box carries is the figure this column carries. The
    # "other related parties" column is NOT bound the same way: a company with
    # a parent files its dividends and rent under the parent column instead.
    if (ctx or "").endswith("_KeyManagementPersonnelOfEntityOrParentMember") and concept == "ifrs-smes:KeyManagementPersonnelCompensation":
        return ("keyManagementCompensation", p)

    if not PLAIN_CTX.match(ctx or ""):
        # SOCE equity columns: bind the component we can identify. Previously
        # every dimensional fact kept the reference company's literal, which is
        # how another entity's share capital and retained earnings ended up in
        # each filing.
        if concept in EQUITY_CONCEPTS:
            for member, field in EQUITY_COMPONENTS.items():
                if (ctx or "").endswith("_" + member):
                    return (field, p)
        if concept in EQUITY_MOVEMENT_CONCEPTS:
            for member in EQUITY_MOVEMENT_MEMBERS:
                if (ctx or "").endswith("_" + member):
                    return (EQUITY_MOVEMENT_CONCEPTS[concept], p)
        if concept == "ifrs-smes:ChangesInEquity":
            for member, field in EQUITY_CHANGE_FIELDS.items():
                if (ctx or "").endswith("_" + member):
                    return (field, p)
        return None
    for table in (SOFP, PL, CF):
        if concept in table:
            return (table[concept], p)
    # The same local name exists under both ifrs-smes and ssmt-mpers for a
    # number of concepts, and the filings do not always use the one we mapped.
    # Three boxes were lost that way — inventories, cost of sales, related-party
    # revenue — each frozen at the donors' zero because the other-namespace twin
    # was unbound. When one namespace is mapped, the other means the same thing.
    local = concept.split(":", 1)[1]
    for alt in (f"ifrs-smes:{local}", f"ssmt-mpers:{local}"):
        if alt != concept:
            for table in (SOFP, PL, CF):
                if alt in table:
                    return (table[alt], p)
    return None


def _nonzero_money(v):
    try:
        return float(str(v).replace(",", "")) != 0.0
    except ValueError:
        return False


def tsj(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def derive_maps(raw):
    """Per-sample date/entity tokens, read from the filing itself rather than
    hardcoded, so any accepted filing can serve as a donor."""
    def dei(tag):
        m = re.search(rf"<ssmt-dei:{tag}[^>]*>([^<]+)<", raw)
        return m.group(1).strip() if m else None

    cs, ce = dei("CompanyCurrentFinancialYearStartDate"), dei("CompanyCurrentFinancialYearEndDate")
    ps, pe = dei("CompanyPreviousFinancialYearStartDate"), dei("CompanyPreviousFinancialYearEndDate")
    ent = re.search(r"<xbrli:identifier[^>]*>([^<]+)</xbrli:identifier>", raw).group(1).strip()
    if not all([cs, ce, ps, pe]):
        raise SystemExit("sample is missing the ssmt-dei period dates")
    ppe = (date.fromisoformat(ps) - timedelta(days=1)).isoformat()
    iso = {ce: "{CE-}", cs: "{CS-}", pe: "{PE-}", ps: "{PS-}", ppe: "{PPE-}"}
    dates = {k.replace("-", ""): v.replace("-}", "}") for k, v in iso.items()}
    return dates, iso, ent


def parse_sample(path):
    """One donor -> {(concept, ctx): entry} plus its context structures."""
    global ISO
    raw = open(path, encoding="utf-8", errors="replace").read()
    dates, iso, ent = derive_maps(raw)
    ISO = iso  # resolve() and the literal tokeniser read the module-level map

    contexts = {
        m.group(1): " ".join(m.group(2).split())
        for m in re.finditer(r'<xbrli:context id="([^"]+)">(.*?)</xbrli:context>', raw, re.S)
    }
    body = re.sub(r"<xbrli:context .*?</xbrli:context>", "", raw, flags=re.S)
    body = re.sub(r"<xbrli:unit .*?</xbrli:unit>", "", body, flags=re.S)

    out, order = {}, []
    for m in FACT_RE.finditer(body):
        name, attrs, val = m.group(1), m.group(2), m.group(3).strip()
        cm = re.search(r'contextRef="([^"]+)"', attrs)
        um = re.search(r'unitRef="([^"]+)"', attrs)
        dm = re.search(r'decimals="([^"]+)"', attrs)
        ctx = tok(cm.group(1), dates) if cm else None

        entry = {"c": name}
        if ctx:
            entry["ctx"] = ctx
        if um:
            entry["u"] = um.group(1)
        if dm:
            entry["d"] = dm.group(1)

        if name.endswith("Explanatory") or name.split(":")[-1].startswith(
            "DescriptionOfAccountingPolicy"
        ):
            entry["narrative"] = True
        else:
            r = resolve(name, ctx)
            if r:
                entry["field"] = r[0]
                if r[1]:
                    entry["period"] = r[1]
            else:
                entry["v"] = tok(unesc(val), iso)

        key = (name, ctx)
        if key not in out:
            out[key] = entry
            order.append(key)

    ctx_struct = {}
    for cid, cbody in contexts.items():
        b = tok(tok(cbody, dates), iso).replace(ent, "{ENTITY}")
        inst = re.search(r"<xbrli:instant>([^<]+)</xbrli:instant>", b)
        sd = re.search(r"<xbrli:startDate>([^<]+)</xbrli:startDate>", b)
        ed = re.search(r"<xbrli:endDate>([^<]+)</xbrli:endDate>", b)
        ex = re.findall(r'<xbrldi:explicitMember dimension="([^"]+)">([^<]+)</xbrldi:explicitMember>', b)
        ty = re.findall(
            r'<xbrldi:typedMember dimension="([^"]+)">\s*<([\w:.-]+)>([^<]*)</[\w:.-]+>\s*</xbrldi:typedMember>', b
        )
        e = {}
        if inst:
            e["i"] = inst.group(1)
        else:
            e["s"], e["e"] = sd.group(1), ed.group(1)
        if ex:
            e["dims"] = [[a, mm] for a, mm in ex]
        if ty:
            e["typed"] = [[a, el, v] for a, el, v in ty]
        ctx_struct[tok(cid, dates)] = e

    return out, order, ctx_struct


# Presentation roles that make up the by-function, current/non-current,
# indirect-cash-flow FS-MPERS filing — the only profile this template serves.
# The alternative layouts (by nature 32xxxx, by liquidity 22xxxx, direct method
# 510000, OCI variants 4xxxxx) are deliberately left out.
PROFILE_ROLES = {"020000", "120000", "120100", "130000", "200100", "200200", "210000", "210100",
                 "300100", "300200", "310000", "310100", "500100", "520000", "610000", "620000",
                 "710000", "720000", "730000", "740000", "750000"}
PLAIN_CTXS = {"instant": ["asof_{CE}_SeparateMember", "asof_{PE}_SeparateMember"],
              "duration": ["fromto_{CS}_{CE}_SeparateMember", "fromto_{PS}_{PE}_SeparateMember"]}


def augment_from_taxonomy(merged, order, catalogue_path):
    """Add a slot for every taxonomy concept we can bind that no donor used.

    The donors decide what the template *contains*, and two property companies
    never had vehicles, inventories, lease liabilities or cost of sales, so
    those boxes did not exist — 64 facts in the held-out filings with nowhere
    to land, and no extraction quality could reach them. The taxonomy is the
    blank form itself: every concept in the profile's presentation tree that
    resolves to a field gets its two standard plain-context slots. Only bound
    concepts are added — an unbound box would emit nothing anyway — and the
    dimensional grids (equity, related parties, auditors) stay donor-derived,
    because their context shapes are not something the taxonomy states.
    """
    cat = json.load(open(catalogue_path, encoding="utf-8"))
    elems = cat["elems"]
    concepts = set()
    for role, arcs in cat["pres"].items():
        if role in PROFILE_ROLES:
            for parent, child, _o in arcs:
                concepts.add(parent); concepts.add(child)
    added = []
    for q in sorted(concepts):
        e = elems.get(q)
        if not e or e.get("abstract"):
            continue
        t = e.get("type") or ""
        if t.startswith("monetary"):
            u, d = "MYR", "0"
        elif t.startswith("shares"):
            u, d = "share", "INF"
        else:
            continue
        for ctx in PLAIN_CTXS.get(e.get("period"), []):
            if (q, ctx) in merged:
                continue
            r = resolve(q, ctx)
            if not r:
                continue
            entry = {"c": q, "ctx": ctx, "u": u, "d": d, "field": r[0]}
            if r[1]:
                entry["period"] = r[1]
            merged[(q, ctx)] = entry
            order.append((q, ctx))
            added.append(f"{q} @ {ctx}")
    return added


def main(*paths):
    taxonomy = None
    if "--taxonomy" in paths:
        i = paths.index("--taxonomy"); taxonomy = paths[i + 1]
        paths = paths[:i] + paths[i + 2:]
    merged, order, ctx_struct = {}, [], {}
    seen_literal = {}   # key -> set of literal values across donors

    for path in paths:
        sample, sample_order, sctx = parse_sample(path)
        for key in sample_order:
            e = sample[key]
            if "v" in e:
                seen_literal.setdefault(key, set()).add(e["v"])
            if key not in merged:
                merged[key] = e
                order.append(key)
            elif "field" in e and "field" not in merged[key]:
                merged[key] = e     # a later donor let us bind what an earlier one could not
        ctx_struct.update(sctx)

    added = augment_from_taxonomy(merged, order, taxonomy) if taxonomy else []

    facts, bound, narrative, dropped, varying, unbound = [], 0, 0, [], [], []
    for key in order:
        e = merged[key]
        name = e["c"]
        if e.get("narrative"):
            narrative += 1
            facts.append(e)
            continue
        if "field" in e:
            bound += 1
            facts.append(e)
            continue

        lits = seen_literal.get(key, set())
        # A literal that DIFFERS between donors is company data, not a constant,
        # and so is any non-zero amount. Strip the VALUE — but keep the box.
        # Deleting the box was the deeper bug: 130 boxes SSM actually uses had
        # vanished, and no amount of extraction quality can fill a box that
        # isn't there. An unbound box emits nothing until a field is mapped to
        # it, then works immediately.
        strip = (len(lits) > 1) or (e.get("u") == "MYR" and _nonzero_money(e.get("v", "")))
        if strip:
            (varying if len(lits) > 1 else dropped).append(
                f"{name} ({' | '.join(sorted(lits))[:60] if len(lits) > 1 else e.get('v')})"
            )
            e = {k: v for k, v in e.items() if k != "v"}
            unbound.append(name)
        facts.append(e)

    header = f'''// AUTO-DERIVED from a real SSM MBRS Preparation Tool instance document
// (FS-MPERS, taxonomy SSMxT_2022v1.0). Do not hand-edit — regenerate with:
//   python3 scripts/gen-mbrs-template.py <donor.xml> [<donor2.xml>] --taxonomy scratch/ssmxt/catalogue.json
//
// Donor filings supply the context set, unit set, concept ordering, the
// dimensional grids and the structural literals. SSM's published taxonomy
// (SSMxT 2022 v1.0, parsed by scripts/parse-ssm-taxonomy.py) then adds a slot
// for every concept in the profile's presentation tree that we can bind and
// no donor happened to use — the blank form, not just the three filled-in
// copies we started from.
//
// All values are UNESCAPED. mbrs-xbrl.ts escapes exactly once on output.
//
// Date tokens, resolved at generation time:
//   {{CS}}/{{CE}}    current period start / end     (yyyymmdd form, used in ids)
//   {{PS}}/{{PE}}    previous period start / end
//   {{PPE}}        day before previous start - the opening SOCE balance instant
//   {{CS-}} etc.   the same dates in ISO yyyy-mm-dd form, used in context bodies
//   {{ENTITY}}     company registration number

export interface TemplateFact {{
  /** Qualified XBRL concept, e.g. "ifrs-smes:Assets". */
  c: string;
  /** Tokenised context id; absent for context-free facts. */
  ctx?: string;
  /** Unit ref: MYR | PURE | share. */
  u?: string;
  /** XBRL decimals attribute. */
  d?: string;
  /** Literal value - structural zeros, fixed enumerations, tokenised dates. */
  v?: string;
  /** Canonical extraction field this fact is filled from. */
  field?: string;
  /** Which reporting period `field` is read from. */
  period?: "current" | "previous";
  /** Filled from the extracted narratives map, keyed by `c`. */
  narrative?: boolean;
}}

export interface TemplateContext {{
  /** Instant date token (point-in-time context). */
  i?: string;
  /** Duration start / end date tokens. */
  s?: string;
  e?: string;
  /** Explicit dimension members: [axis, member][]. */
  dims?: [string, string][];
  /** Typed dimension members: [axis, element, value][]. */
  typed?: [string, string, string][];
}}

'''
    out = header + "export const TEMPLATE_FACTS: TemplateFact[] = [\n"
    for f in facts:
        out += "  " + tsj(f) + ",\n"
    out += "];\n\nexport const TEMPLATE_CONTEXTS: Record<string, TemplateContext> = {\n"
    for k, v in ctx_struct.items():
        out += f"  {tsj(k)}: {tsj(v)},\n"
    out += "};\n"
    open(f"{SRC_DIR}/mbrs-template.ts", "w").write(out)

    narr = []
    for f in facts:
        if f.get("narrative") and f["c"] not in narr:
            narr.append(f["c"])
    narr_out = (
        "// AUTO-DERIVED alongside mbrs-template.ts — regenerate with the same script.\n"
        "//\n"
        "// Split out of the template deliberately: the canonical model needs this list\n"
        "// and is imported by the review page, so keeping it here stops the ~120KB fact\n"
        "// template from being pulled into the client bundle.\n\n"
        "/** XBRL concepts that carry company narrative prose (…Explanatory). */\n"
        "export const NARRATIVE_CONCEPTS: string[] = [\n"
        + "".join(f"  {tsj(c)},\n" for c in narr)
        + "];\n"
    )
    open(f"{SRC_DIR}/mbrs-narratives.ts", "w").write(narr_out)

    print(f"facts {len(facts)} (bound {bound}, narrative {narrative}, "
          f"literal {len(facts)-bound-narrative}) | contexts {len(ctx_struct)}")
    if dropped:
        print(f"dropped {len(dropped)} unbindable monetary literals (donor's money)")
    if varying:
        print(f"stripped {len(varying)} literals that DIFFER between donors (company data)")
    if added:
        print(f"added {len(added)} slots from the taxonomy for bound concepts no donor used")
    if unbound:
        from collections import Counter as _C
        u = _C(unbound)
        print(f"{len(unbound)} boxes kept but UNBOUND — map a field to each to fill it:")
        for c, n in u.most_common(25):
            print(f"   {n:3}x {c}")
    print(f"wrote {SRC_DIR}/mbrs-template.ts ({len(out)} bytes)")
    print(f"wrote {SRC_DIR}/mbrs-narratives.ts ({len(narr)} concepts)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])
