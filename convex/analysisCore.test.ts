import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeProperty, classifyMargin, type AnalysisInput } from "./analysisCore.ts";
import { evaluateComps, parseSoldDate, valueProperty, type CountyRecord, type SaleRow, type Valuation } from "./engineCore.ts";

const now = new Date("2026-10-06T16:00:00Z");
const county: CountyRecord = { address: "100 Example Ave", zip: "33141", folio: "F1", owner: "Test Owner",
  subdivision: "TREASURE PLAZA", municipality: "North Bay Village", beds: 3, baths: 2, livingSF: 2000,
  lotSF: 7000, yearBuilt: 1955, landValue: 500000, marketValue: 950000, hasDock: false, riparian: false,
  homestead: false, dorDescription: "RESIDENTIAL SINGLE FAMILY", propertyClass: "sfr", unit: null, salesHistory: [] };
const sales: SaleRow[] = [1, 2, 3].map(n => ({ saleId: `S${n}`, address: `${n} Example St`,
  market: "north_bay_village", zip: "33141", soldDate: "2026-08-01", price: 1000000 + (n - 2) * 20000,
  livingSF: 2000, lotSF: 7000, yearBuilt: 1955, waterfront: false, waterType: "None", conditionClass: "dated",
  verified: true, source: "county", propertyClass: "sfr" }));
const value = valueProperty(county, sales) as Valuation;
const evidence = { sourceUrl: "https://www.miamidade.gov/property-record", checkedAt: "2026-10-06" };
const complete: AnalysisInput = {
  subject: { ...evidence, folio: "F1", wholeOwnership: true, assetType: "sfr", livingSF: 2000,
    condition: "dated", waterfront: false, waterType: "dry", microMarket: "Treasure Island" },
  compEvidence: sales.map(s => ({ ...evidence, saleId: s.saleId, armsLength: true,
    sameMicroMarket: true, conditionComparable: true, propertyClass: "sfr" })),
  listing: { ...evidence, folio: "F1", mlsId: "A1", status: "active", currentListPrice: 850000,
    originalListPrice: 1000000, activeDOM: 40, cumulativeDOM: 180,
    agent: { fullName: "Example Agent", phone: "305-555-0101", email: "agent@example.com", sourceUrl: evidence.sourceUrl } },
  investor: { ...evidence, folio: "F1", approvedARV: 1200000, repairs: 50000, acquisitionCosts: 20000,
    resaleCosts: 60000, carryingCosts: 20000, financingCosts: 10000, contingency: 20000, investorProfit: 20000 },
  sellerCosts: { folio: "F1", commission: 30000, closingCosts: 20000, concessions: 0, loanPayoff: 400000 },
};
const run = (input = complete, val = value, c = county) => analyzeProperty(c, val, input, now);
test("separates retail, investor purchase ceiling, and wholesale margin denominator", () => {
  const out = run();
  assert.deepEqual(out.quality.blockers, []);
  assert.equal(out.investor.likelyInvestorExit, 1000000);
  assert.equal(out.seller.mostLikelyRetail, 1000000);
  assert.equal(out.seller.netProceeds, 550000);
  assert.equal(out.investor.wholesaleMAO15, 850000);
  assert.equal(out.investor.wholesaleMAO10, 900000);
  assert.equal(out.investor.brokerThreshold6, 940000);
  assert.equal(out.investor.spreadPct, .15);
  assert.equal(out.investor.classification, "GRAND SLAM");
  assert.equal(out.investor.recommendedMaximumOffer, 850000);
  assert.equal(out.investor.recommendedOpeningOffer, 805000);
  assert.equal(out.investor.offerReviewReady, true);
  const contracted = run({ ...complete, contractPrice: 900000 });
  assert.equal(contracted.investor.classification, "WHOLESALE");
  assert.equal(contracted.investor.contractPriceBasis, "proposed contract price");
});
test("classifies exact thresholds, losses, and insufficient data", () => {
  assert.deepEqual([.15,.149,.10,.099,.06,.059,-.1,null].map(classifyMargin),
    ["GRAND SLAM","WHOLESALE","WHOLESALE","NEGOTIATE / THIN WHOLESALE","NEGOTIATE / THIN WHOLESALE","BROKER / LISTING","BROKER / LISTING","MANUAL REVIEW"]);
});
test("no evidence never produces an investor offer, even with high legacy confidence", () => {
  const out = run({});
  assert.equal(out.quality.status, "MANUAL REVIEW");
  assert.equal(out.investor.recommendedMaximumOffer, null);
  assert.equal(out.investor.classification, "MANUAL REVIEW");
  assert.equal(out.seller.provisional, true);
});
test("missing cost line is not silently treated as zero; explicit zero is permitted", () => {
  const missing = structuredClone(complete);
  delete (missing.investor as any).financingCosts;
  assert.equal(run(missing).investor.likelyInvestorExit, null);
  assert.ok(run(missing).investor.blockers.some(b => b.includes("COMPLETE_COST_BUDGET")));
  assert.equal(run({ ...complete, investor: { ...complete.investor!, financingCosts: 0 } }).investor.likelyInvestorExit, 1010000);
});
test("nonfinite prices, negative costs, and uneconomic budgets fail closed", () => {
  for (const patch of [{ approvedARV: Infinity }, { repairs: -1 }, { repairs: 1300000 }, { targetWholesaleMargin: 1 }]) {
    assert.equal(run({ ...complete, investor: { ...complete.investor!, ...patch } }).investor.recommendedMaximumOffer, null);
  }
  assert.equal(run({ ...complete, contractPrice: NaN }).investor.classification, "MANUAL REVIEW");
});
test("wrong folio, fractional interest, dock, and condo unit mismatch block residential offers", () => {
  for (const patch of [{ folio: "OTHER" }, { wholeOwnership: false }, { assetType: "dock" as const }])
    assert.equal(run({ ...complete, subject: { ...complete.subject!, ...patch } }).investor.recommendedMaximumOffer, null);
  const condo = { ...county, propertyClass: "condo" as const, unit: "402" };
  assert.ok(run({ ...complete, subject: { ...complete.subject!, assetType: "condo", unit: "401" } }, { ...value, propertyClass: "condo" }, condo).quality.blockers.includes("CONDO_UNIT_UNVERIFIED"));
});
test("age does not prove renovation and two bedrooms do not imply teardown", () => {
  const twoBed = valueProperty({ ...county, beds: 2 }, sales);
  assert.ok(!("error" in twoBed) && twoBed.condition === "dated");
  assert.ok(run({ ...complete, subject: { ...complete.subject!, condition: "renovated" } }).quality.blockers.includes("CONDITION_UNVERIFIED_OR_CONFLICTING"));
});
test("unverified sales, wrong water tier, large size mismatch, and wide range require review", () => {
  assert.equal(run({ ...complete, compEvidence: complete.compEvidence!.slice(0,2) }).quality.eligibleCompCount, 2);
  for (const patch of [{ waterType: "Verify", wf: true }, { sf: 4000 }, { sold: "" }]) {
    const out = run(complete, { ...value, comps: [{ ...value.comps[0], ...patch }, ...value.comps.slice(1)] });
    assert.equal(out.investor.recommendedMaximumOffer, null);
    assert.equal(out.quality.eligibleCompCount, 2);
  }
  assert.ok(run(complete, { ...value, retailLow: 700000, retailHigh: 1300000 }).quality.blockers.includes("RETAIL_RANGE_WIDER_THAN_25_PERCENT"));
});
test("stale/inactive listing blocks investor but preserves supported retail; missing contact blocks readiness", () => {
  for (const patch of [{ checkedAt: "2026-09-01" }, { status: "pending" as const }, { folio: "OTHER" }]) {
    const out = run({ ...complete, listing: { ...complete.listing!, ...patch } });
    assert.equal(out.quality.status, "SUPPORTED");
    assert.equal(out.investor.recommendedMaximumOffer, null);
  }
  const out = run({ ...complete, listing: { ...complete.listing!, agent: undefined } });
  assert.equal(out.investor.recommendedMaximumOffer, 850000);
  assert.equal(out.investor.offerReviewReady, false);
});
test("active and cumulative DOM stay distinct; missing DOM remains unknown", () => {
  assert.equal(run().listing.over90Days, true);
  assert.equal(run().listing.snapshot?.activeDOM, 40);
  assert.equal(run({ ...complete, listing: { ...complete.listing!, activeDOM: undefined, cumulativeDOM: undefined } }).listing.over90Days, null);
  assert.equal(run({ ...complete, listing: { ...complete.listing!, activeDOM: 200, cumulativeDOM: 180 } }).listing.status, "MANUAL REVIEW");
});
test("price reductions come from dated history, not just an original-price comparison", () => {
  assert.deepEqual(run().listing.priceReductions, []);
  const out = run({ ...complete, listing: { ...complete.listing!, priceEvents: [
    { date: "2026-09-01", price: 900000, sourceUrl: evidence.sourceUrl },
    { date: "2026-08-01", price: 1000000, sourceUrl: evidence.sourceUrl },
    { date: "2026-10-02", price: 850000, sourceUrl: evidence.sourceUrl },
    { date: "2026-10-10", price: 800000, sourceUrl: evidence.sourceUrl },
  ] } });
  assert.deepEqual(out.listing.priceReductions.map(e => e.reduction), [100000,50000]);
});
test("strict dates exclude invalid or future transfers from the pricing pool", () => {
  assert.equal(parseSoldDate("2026-02-30"), null);
  assert.equal(parseSoldDate("13/01/26"), null);
  assert.equal(parseSoldDate("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
  const result = evaluateComps([ ...sales, { ...sales[0], saleId: "bad", soldDate: "2026-02-30" },
    { ...sales[0], saleId: "future", soldDate: "2099-01-01" } ], false, "dated", "north_bay_village");
  assert.equal(result.selected.length, 3);
  assert.ok(result.excluded.some(e => e.reason.includes("future sale date")));
});
