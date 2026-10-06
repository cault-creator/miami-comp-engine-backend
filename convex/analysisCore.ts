// V2 decision layer. Pure, deterministic, and fail-closed; never sends an offer.
import { parseSoldDate, waterTier, type CountyRecord, type Valuation } from "./engineCore.ts";

export const ANALYSIS_VERSION = "2026-10-06.1";
export interface Evidence { sourceUrl: string; checkedAt: string }
export interface SubjectEvidence extends Evidence {
  folio: string;
  wholeOwnership: boolean;
  assetType: "sfr" | "condo" | "land" | "dock" | "fractional" | "unknown";
  livingSF: number;
  condition: string;
  waterfront: boolean;
  waterType: "dry" | "canal" | "open_bay";
  microMarket: string;
  unit?: string;
}
export interface CompEvidence extends Evidence {
  saleId: string;
  armsLength: boolean;
  sameMicroMarket: boolean;
  conditionComparable: boolean;
  propertyClass: "sfr" | "condo";
}
export interface ListingSnapshot extends Evidence {
  folio: string;
  mlsId: string;
  status: "active" | "pending" | "sold" | "withdrawn" | "unknown";
  currentListPrice: number;
  originalListPrice?: number;
  activeDOM?: number;
  cumulativeDOM?: number;
  // Historical asking-price events, not inferred from current/original prices.
  priceEvents?: { date: string; price: number; sourceUrl: string }[];
  agent?: { fullName: string; phone?: string; email?: string; brokerage?: string; sourceUrl: string };
}
export interface InvestorBudget extends Evidence {
  folio: string;
  approvedARV: number;
  repairs: number;
  acquisitionCosts: number;
  resaleCosts: number;
  carryingCosts: number;
  financingCosts: number;
  contingency: number;
  investorProfit: number;
  targetWholesaleMargin?: number; // default .15; minimum .06
  openingDiscount?: number; // default .05 below the wholesale maximum
}
export interface AnalysisInput {
  subject?: SubjectEvidence;
  compEvidence?: CompEvidence[];
  listing?: ListingSnapshot;
  investor?: InvestorBudget;
  contractPrice?: number;
  sellerCosts?: { folio: string; commission: number; closingCosts: number; concessions: number; loanPayoff: number };
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const publicUrl = (s: unknown) => {
  if (typeof s !== "string") return false;
  try { const u = new URL(s); return ["http:", "https:"].includes(u.protocol) && !!u.hostname; } catch { return false; }
};
const fresh = (e: Evidence | undefined, now: Date, days: number) => {
  if (!e || !publicUrl(e.sourceUrl) || typeof e.checkedAt !== "string") return false;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(e.checkedAt) ? parseSoldDate(e.checkedAt) : new Date(e.checkedAt);
  if (!d || !Number.isFinite(d.getTime())) return false;
  const age = (now.getTime() - d.getTime()) / 86400000;
  return age >= 0 && age <= days;
};
export function classifyMargin(margin: number | null) {
  if (margin === null || !Number.isFinite(margin)) return "MANUAL REVIEW";
  if (margin >= .15 - 1e-12) return "GRAND SLAM";
  if (margin >= .10 - 1e-12) return "WHOLESALE";
  if (margin >= .06 - 1e-12) return "NEGOTIATE / THIN WHOLESALE";
  return "BROKER / LISTING";
}

export function analyzeProperty(county: CountyRecord, valuation: Valuation | { error: string },
  input: AnalysisInput = {}, now = new Date()) {
  const blockers: string[] = [];
  const investorBlockers: string[] = [];
  const listingBlockers: string[] = [];
  const warnings: string[] = ["Asking price and days on market do not establish market value or seller motivation."];
  const subject = input.subject;
  const val = "error" in valuation ? null : valuation;
  if (!val) blockers.push("VALUATION_UNAVAILABLE");
  if (!fresh(subject, now, 90) || subject?.folio !== county.folio) blockers.push("SUBJECT_EVIDENCE_MISSING_STALE_OR_WRONG_FOLIO");
  if (!subject?.wholeOwnership || !["sfr", "condo"].includes(subject?.assetType ?? "")) blockers.push("UNSUPPORTED_ASSET_OR_OWNERSHIP");
  if (/boat slip|dockominium|marina|vacant land|fractional|time.?share/i.test(county.dorDescription)) blockers.push("COUNTY_ASSET_TYPE_UNSUPPORTED");
  if (subject && val) {
    if (subject.assetType !== county.propertyClass) blockers.push("SUBJECT_PROPERTY_CLASS_MISMATCH");
    if (!positive(subject.livingSF) || !positive(county.livingSF) || Math.abs(subject.livingSF - county.livingSF) / county.livingSF > .05)
      blockers.push("LEGAL_LIVING_AREA_UNVERIFIED_OR_CONFLICTING");
    if (subject.condition !== val.condition) blockers.push("CONDITION_UNVERIFIED_OR_CONFLICTING");
    if (subject.waterfront !== val.waterfront || (subject.waterfront ? subject.waterType === "dry" : subject.waterType !== "dry"))
      blockers.push("WATERFRONT_UNVERIFIED_OR_CONFLICTING");
    if (!subject.microMarket.trim()) blockers.push("PRECISE_MICRO_MARKET_MISSING");
    if (county.propertyClass === "condo" && (!subject.unit || subject.unit !== county.unit)) blockers.push("CONDO_UNIT_UNVERIFIED");
    if (county.zip === "33154" && val.micro === "miami_beach") blockers.push("UNCALIBRATED_ADJACENT_MARKET_BANDS");
  }
  const compProof = new Map((input.compEvidence ?? []).map(e => [e.saleId, e]));
  const evaluated = (val?.comps ?? []).map(c => {
    const proof = compProof.get(c.saleId);
    const date = parseSoldDate(c.sold);
    const age = date ? (now.getTime() - date.getTime()) / 86400000 : null;
    const flags: string[] = [];
    if (!proof || !fresh(proof, now, 90) || !proof.armsLength) flags.push("UNVERIFIED_ARMS_LENGTH_SALE");
    if (!c.sameMarket || !proof?.sameMicroMarket) flags.push("PRECISE_MICRO_MARKET_UNVERIFIED");
    if (!proof?.conditionComparable) flags.push("CONDITION_ADJUSTMENT_UNVERIFIED");
    if (proof?.propertyClass !== county.propertyClass) flags.push("PROPERTY_CLASS_UNVERIFIED");
    if (age === null || age < 0 || age > 365) flags.push("SALE_DATE_MISSING_FUTURE_OR_OVER_365_DAYS");
    if (!positive(c.price) || !positive(c.sf) || !positive(county.livingSF) || Math.abs(c.sf - county.livingSF) / county.livingSF > .35)
      flags.push("LIVING_AREA_MISMATCH");
    if (c.wf !== subject?.waterfront || c.drySupport || waterTier(c.waterType ?? "") !== subject?.waterType
      || (c.wf && /verify|unknown/i.test(c.waterType ?? ""))) flags.push("WATERFRONT_OR_WATER_TIER_MISMATCH");
    if (c.warnings.some(w => /major lot-size mismatch|superior condition|inferior condition/.test(w))) flags.push("MATERIAL_FEATURE_ADJUSTMENT_NEEDED");
    return { ...c, evidence: proof ?? null, eligibilityWarnings: flags, eligible: flags.length === 0 };
  });
  const eligible = evaluated.filter(c => c.eligible);
  // Every selected pricing comp must pass; otherwise the unchanged V1 value may contain an ineligible sale.
  if (eligible.length < 3) blockers.push("FEWER_THAN_3_VERIFIED_COMPARABLE_SALES");
  if (evaluated.some(c => !c.eligible)) blockers.push("VALUATION_CONTAINS_UNSUPPORTED_COMPS");
  if (val && (!positive(val.retailLow) || !positive(val.retailHigh) || !positive(val.mostLikely)
    || val.retailHigh < val.retailLow || val.mostLikely < val.retailLow || val.mostLikely > val.retailHigh)) blockers.push("INVALID_RETAIL_RANGE");
  if (val && positive(val.mostLikely) && (val.retailHigh - val.retailLow) / val.mostLikely > .25) blockers.push("RETAIL_RANGE_WIDER_THAN_25_PERCENT");
  if (val && /market bands|falls back/i.test([val.dataNote, ...val.reasoning].join(" "))) blockers.push("STATIC_BAND_FALLBACK");
  // A rule-of-thumb land floor cannot silently override verified house sales.
  if (val?.finishedRange && val.landFloor && (val.landFloor[0] > val.finishedRange[0] || val.landFloor[1] > val.finishedRange[1])) blockers.push("UNVERIFIED_LAND_FLOOR_OVERRIDES_SALES");
  const retailReady = blockers.length === 0;
  const listing = input.listing;
  if (!listing || !fresh(listing, now, 7) || listing.folio !== county.folio || !listing.mlsId.trim()
    || listing.status !== "active" || !positive(listing.currentListPrice)) listingBlockers.push("ACTIVE_LISTING_MISSING_STALE_OR_WRONG_PROPERTY");
  for (const n of [listing?.activeDOM, listing?.cumulativeDOM]) if (n !== undefined && (!nonnegative(n) || !Number.isInteger(n))) listingBlockers.push("INVALID_DAYS_ON_MARKET");
  if (listing?.activeDOM !== undefined && listing.cumulativeDOM !== undefined && listing.cumulativeDOM < listing.activeDOM) listingBlockers.push("CUMULATIVE_DOM_LESS_THAN_ACTIVE_DOM");
  const listingReady = listingBlockers.length === 0;
  const events = (listing?.priceEvents ?? []).filter(e => {
    const d = parseSoldDate(e.date);
    return positive(e.price) && publicUrl(e.sourceUrl) && d && d.getTime() <= now.getTime();
  }).sort((a, b) => parseSoldDate(a.date)!.getTime() - parseSoldDate(b.date)!.getTime());
  if (events.length !== (listing?.priceEvents ?? []).length) warnings.push("Some price-history events are invalid; reductions may be incomplete.");
  const reductions = events.slice(1).flatMap((e, i) => e.price < events[i].price
    ? [{ date: e.date, previousPrice: events[i].price, price: e.price, reduction: events[i].price - e.price, sourceUrl: e.sourceUrl }] : []);
  const budget = input.investor;
  const costKeys = ["repairs", "acquisitionCosts", "resaleCosts", "carryingCosts", "financingCosts", "contingency", "investorProfit"] as const;
  if (!budget || !fresh(budget, now, 30) || budget.folio !== county.folio || !positive(budget.approvedARV)
    || costKeys.some(k => !nonnegative(budget[k]))) investorBlockers.push("APPROVED_ARV_OR_COMPLETE_COST_BUDGET_MISSING_INVALID_OR_STALE");
  const targetMargin = budget?.targetWholesaleMargin ?? .15;
  const openingDiscount = budget?.openingDiscount ?? .05;
  if (!Number.isFinite(targetMargin) || targetMargin < .06 || targetMargin >= 1) investorBlockers.push("TARGET_MARGIN_OUT_OF_RANGE");
  if (!Number.isFinite(openingDiscount) || openingDiscount < 0 || openingDiscount >= 1) investorBlockers.push("OPENING_DISCOUNT_OUT_OF_RANGE");
  const candidateExit = investorBlockers.length === 0 && budget ? budget.approvedARV - costKeys.reduce((sum, k) => sum + budget[k], 0) : null;
  if (candidateExit !== null && !positive(candidateExit)) investorBlockers.push("COSTS_AND_PROFIT_EXCEED_ARV");
  if (input.contractPrice !== undefined && !positive(input.contractPrice)) investorBlockers.push("INVALID_CONTRACT_PRICE");
  const investorReady = retailReady && listingReady && investorBlockers.length === 0;
  const exit = investorReady ? candidateExit : null;
  const basis = input.contractPrice ?? (listingReady ? listing!.currentListPrice : null);
  const spread = exit !== null && basis !== null ? exit - basis : null;
  const margin = spread !== null && exit !== null ? spread / exit : null;
  const roundDown = (n: number) => Math.floor(n / 5000) * 5000;
  const maximum = exit === null ? null : roundDown(exit * (1 - targetMargin));
  const costs = input.sellerCosts;
  const sellerCostsValid = costs && costs.folio === county.folio && [costs.commission, costs.closingCosts, costs.concessions, costs.loanPayoff].every(nonnegative);
  const contact = listingReady ? listing?.agent : undefined;
  const contactReady = !!(contact && contact.fullName.trim().split(/\s+/).length >= 2
    && /^\+?[\d\s().-]{10,}$/.test(contact.phone ?? "") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? "") && publicUrl(contact.sourceUrl));
  if (contact && !contactReady) warnings.push("Agent full name, public phone, email, or contact source is incomplete. Do not guess missing details.");
  return {
    version: ANALYSIS_VERSION, asOf: now.toISOString(), folio: county.folio,
    quality: { status: retailReady ? "SUPPORTED" : "MANUAL REVIEW", confidence: retailReady ? "B" : "C", blockers: [...new Set(blockers)], eligibleCompCount: eligible.length, selectedCompCount: evaluated.length },
    seller: { status: retailReady ? "SUPPORTED" : "MANUAL REVIEW", mostLikelyRetail: val?.mostLikely ?? null,
      retailRange: val ? [val.retailLow, val.retailHigh] : null, provisional: !retailReady,
      netProceeds: retailReady && sellerCostsValid ? val!.mostLikely - costs!.commission - costs!.closingCosts - costs!.concessions - costs!.loanPayoff : null,
      netProceedsNote: "Net requires the seller's actual negotiated commission, closing costs, concessions, and payoff." },
    buyer: { status: retailReady ? "SUPPORTED" : "MANUAL REVIEW", supportedValue: retailReady ? val!.mostLikely : null,
      askingPremiumPct: retailReady && listingReady ? (listing!.currentListPrice - val!.mostLikely) / val!.mostLikely : null,
      reasoning: val?.reasoning ?? [], selectedComps: evaluated, excludedComps: val?.excludedComps ?? [], compSummary: val?.compSummary ?? null },
    listing: { status: listingReady ? "VERIFIED SNAPSHOT" : "MANUAL REVIEW", blockers: [...new Set(listingBlockers)], snapshot: listing ?? null,
      over90Days: listingReady && (listing?.cumulativeDOM ?? listing?.activeDOM) !== undefined
        ? (listing?.cumulativeDOM ?? listing?.activeDOM)! > 90 : null,
      priceReductions: reductions, originalToCurrentReduction: listingReady && positive(listing?.originalListPrice)
        ? listing!.originalListPrice! - listing!.currentListPrice : null,
      agentContactReady: contactReady },
    investor: { status: investorReady ? "READY FOR OFFER REVIEW" : "MANUAL REVIEW", blockers: [...new Set([...blockers, ...listingBlockers, ...investorBlockers])],
      budget: budget ?? null, likelyInvestorExit: exit, investorExitDefinition: "Investor purchase ceiling = approved ARV less repairs, all budgeted costs, contingency, and investor profit. This is not retail resale value.",
      wholesaleMAO15: exit === null ? null : roundDown(exit * .85), wholesaleMAO10: exit === null ? null : roundDown(exit * .90), brokerThreshold6: exit === null ? null : roundDown(exit * .94),
      recommendedOpeningOffer: maximum === null ? null : roundDown(maximum * (1 - openingDiscount)), recommendedMaximumOffer: maximum,
      contractPrice: basis, contractPriceBasis: input.contractPrice !== undefined ? "proposed contract price" : "current asking price screening",
      potentialGrossSpread: spread, spreadPct: margin, classification: classifyMargin(margin),
      targetWholesaleMargin: targetMargin, marginFormula: "(Investor Exit - Contract Price) / Investor Exit",
      offerReviewReady: investorReady && contactReady },
    warnings,
  };
}
