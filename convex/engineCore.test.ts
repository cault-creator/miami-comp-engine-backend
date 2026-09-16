import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectMicroMarket,
  detectWaterfront,
  marketMatches,
  evaluateComps,
  matchComps,
  parseSoldDate,
  valueProperty,
  type CountyRecord,
  type SaleRow,
} from "./engineCore.ts";

const maple: CountyRecord = {
  address: "12810 MAPLE RD, North Miami",
  zip: "33181",
  folio: "06-2228-017-0380",
  owner: "ROGER A BERNSTEIN & Wife ERICA C",
  subdivision: "KEYSTONE ISLAND NO 3",
  municipality: "North Miami",
  beds: 4,
  baths: 3,
  livingSF: 2505,
  lotSF: 9375,
  yearBuilt: 1957,
  landValue: 1875000,
  marketValue: 2309483,
  hasDock: true,
  riparian: true,
  homestead: true,
  dorDescription: "RESIDENTIAL - SINGLE FAMILY : 1 UNIT",
  propertyClass: "sfr",
  unit: null,
  salesHistory: [],
};

const sale = (overrides: Partial<SaleRow>): SaleRow => ({
  saleId: "sale-1",
  address: "10121 E Broadview Dr",
  market: "keystone",
  zip: "33154",
  soldDate: "2026-05-18",
  price: 6150000,
  beds: 5,
  baths: 5,
  livingSF: 2848,
  lotSF: 11250,
  waterfront: true,
  waterType: "Verify",
  conditionClass: "dated",
  verified: false,
  source: "test",
  propertyClass: "sfr",
  ...overrides,
});

test("detects Maple Rd as Keystone and waterfront", () => {
  const [market, cfg] = detectMicroMarket(maple);
  assert.equal(market, "north_miami_keystone");
  const [waterfront, reason] = detectWaterfront(maple, cfg);
  assert.equal(waterfront, true);
  assert.match(reason, /dock|RIP|county land/i);
});

test("matches imported market slugs to engine micro-market names", () => {
  assert.equal(marketMatches("keystone", "north_miami_keystone"), true);
  assert.equal(marketMatches("North Miami", "north_miami_keystone"), true);
  assert.equal(marketMatches("miami_beach", "miami_beach"), true);
  assert.equal(marketMatches("Bay Harbor Islands", "bay_harbor_islands"), true);
  assert.equal(marketMatches("Miami Beach", "north_miami_keystone"), false);
});

test("parses both PropStream ISO and legacy slash sold dates", () => {
  assert.equal(parseSoldDate("2026-05-18")?.getFullYear(), 2026);
  assert.equal(parseSoldDate("04/16/24")?.getFullYear(), 2024);
  assert.equal(parseSoldDate("not a date"), null);
});

test("matchComps filters property class and rewards same-market waterfront comps", () => {
  const comps = matchComps(
    [
      sale({ saleId: "same-market", market: "keystone", propertyClass: "sfr" }),
      sale({
        saleId: "wrong-market",
        address: "3220 Chase Ave",
        market: "miami_beach",
        propertyClass: "sfr",
      }),
      sale({ saleId: "condo", market: "keystone", propertyClass: "condo" }),
      sale({ saleId: "dry", market: "keystone", waterfront: false, waterType: "None" }),
    ],
    true,
    "dated",
    "north_miami_keystone",
    5,
    "sfr",
    "canal",
  );

  assert.equal(comps.some((comp) => comp.saleId === "condo"), false);
  assert.equal(comps[0].saleId, "same-market");
  assert.equal(comps[0].sameMarket, true);
  assert.ok(comps[0].reasons.length > 0);
});

test("valueProperty can price Maple Rd from same-market imported sales", () => {
  const result = valueProperty(maple, [
    sale({ saleId: "same-1", address: "100 Keystone Blvd", price: 5000000, livingSF: 2600, market: "keystone" }),
    sale({ saleId: "same-2", address: "200 Keystone Blvd", price: 5400000, livingSF: 2700, market: "North Miami" }),
    sale({ saleId: "other", address: "300 Beach Ave", price: 7000000, livingSF: 3000, market: "miami_beach" }),
  ]);

  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.micro, "north_miami_keystone");
  assert.equal(result.waterfront, true);
  assert.match(result.dataNote ?? "", /Priced from 2 same-market sales/);
  assert.notEqual(result.confidence, "C");
  assert.ok(result.reasoning.length >= 3);
  assert.equal(result.compSummary.sameMarketCount, 2);
});

test("valueProperty excludes waterfront sales below subject land floor", () => {
  const result = valueProperty(maple, [
    sale({
      saleId: "too-low",
      address: "1900 Keystone Blvd",
      price: 1200000,
      livingSF: 1443,
      lotSF: 9375,
      market: "keystone",
    }),
    sale({
      saleId: "usable-1",
      address: "2055 Keystone Blvd",
      price: 2373900,
      livingSF: 3204,
      lotSF: 9900,
      market: "keystone",
    }),
    sale({
      saleId: "usable-2",
      address: "2085 Keystone Blvd",
      price: 5300000,
      livingSF: 4922,
      lotSF: 10500,
      market: "keystone",
    }),
  ]);

  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.comps.some((comp) => comp.saleId === "too-low"), false);
  assert.equal(result.excludedComps.some((comp) => comp.saleId === "too-low"), true);
  assert.match(
    result.excludedComps.find((comp) => comp.saleId === "too-low")?.reason ?? "",
    /land-floor/i,
  );
});

const newBuild: CountyRecord = {
  ...maple,
  address: "13100 CORONADO TER, North Miami",
  yearBuilt: 2022,
  livingSF: 4078,
  landValue: 2050000,
};

test("new_construction tier prices at the new-build band and mentions land + $/SF", () => {
  const result = valueProperty(
    newBuild,
    [sale({ saleId: "wf-1", market: "keystone" }), sale({ saleId: "wf-2", market: "keystone", price: 5900000 })],
    "new_construction",
  );
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.condition, "new");
  assert.deepEqual(result.psfBand, [2100, 2800]); // keystone waterfront new band
  assert.ok(result.reasoning.some((line) => /New construction: land value/.test(line)));
  assert.ok(result.landFloor);
  // dated comps must NOT drag a new build down to dated $/SF — band pricing wins
  assert.deepEqual(result.finishedRange, [Math.round(4078 * 2100), Math.round(4078 * 2800)]);
});

test("new-construction subject prices off new comps when 2+ exist", () => {
  const result = valueProperty(
    newBuild,
    [
      sale({ saleId: "old-1", address: "400 Keystone Blvd", market: "keystone" }),
      sale({ saleId: "new-1", address: "500 Keystone Blvd", market: "keystone", price: 9000000, livingSF: 4000, conditionClass: "new", yearBuilt: 2023 }),
      sale({ saleId: "new-2", address: "600 Keystone Blvd", market: "keystone", price: 10200000, livingSF: 4200, conditionClass: "new", yearBuilt: 2024 }),
    ],
    "new_construction",
  );
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.match(result.dataNote ?? "", /Priced from 2 same-market sales/);
  assert.ok(result.finishedRange![0] > 4078 * 2000); // ~$2250-2428/SF comp range, not the dated ~$800/SF
});

test("new-construction waterfront subject surfaces dry-lot sales as opt-in support comps", () => {
  const drySale = sale({
    saleId: "dry-support",
    address: "2125 Ixora Rd",
    market: "keystone",
    waterfront: false,
    waterType: "None",
    price: 4600000,
    livingSF: 4147,
    lotSF: 9000,
    soldDate: "2026-04-29",
    conditionClass: "new",
    yearBuilt: 2021,
  });
  const wfSale = sale({ saleId: "wf-comp", market: "keystone", yearBuilt: 2020 });
  const without = valueProperty(newBuild, [drySale, wfSale], "new_construction");
  assert.equal("error" in without, false);
  if ("error" in without) return;
  // not in pricing comps by default, listed as support with the dry-lot difference noted
  assert.equal(without.comps.some((c) => c.saleId === "dry-support"), false);
  const supportComp = without.supportComps.find((c) => c.saleId === "dry-support");
  assert.ok(supportComp);
  assert.equal(supportComp.drySupport, true);
  assert.ok(supportComp.warnings.some((w) => /dry lot, not waterfront/.test(w)));

  // reviewer includes it -> it joins the pricing pool even against the tier preference
  const withIncluded = valueProperty(newBuild, [drySale, wfSale], "new_construction", {
    includeSupportIds: ["dry-support"],
  });
  assert.equal("error" in withIncluded, false);
  if ("error" in withIncluded) return;
  const included = withIncluded.comps.find((c) => c.saleId === "dry-support");
  assert.ok(included);
  assert.ok(included.reasons.some((r) => /reviewer-included/.test(r)));
});

test("excludeSaleIds removes a comp from consideration", () => {
  const result = valueProperty(
    maple,
    [sale({ saleId: "keep", market: "keystone" }), sale({ saleId: "drop", market: "keystone", price: 5200000 })],
    undefined,
    { excludeSaleIds: ["drop"] },
  );
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.comps.some((c) => c.saleId === "drop"), false);
  const ex = result.excludedComps.find((c) => c.saleId === "drop");
  assert.match(ex?.reason ?? "", /removed by reviewer/);
});

test("excluded comps are ranked by relevance, not insertion order, and deduped", () => {
  const junkFirst = sale({
    saleId: "junk",
    address: "1 Far Away Dr",
    market: "miami_beach",
    waterfront: false,
    waterType: "None",
    price: 400000,
  });
  const nearMiss = sale({
    saleId: "near-miss",
    address: "2310 Bayview Ln",
    market: "keystone",
    waterfront: false,
    waterType: "None",
    price: 4200000,
    livingSF: 4822,
    lotSF: 9375,
  });
  const nearMissDup = sale({
    saleId: "near-miss-dup",
    address: "2310 Bayview Ln, North Miami, FL 33181",
    market: "Keystone Islands / N Miami",
    waterfront: false,
    waterType: "Canal",
    price: 4200000,
    livingSF: 4822,
  });
  const result = valueProperty(
    maple,
    [junkFirst, nearMiss, nearMissDup, sale({ saleId: "wf-1", market: "keystone" }), sale({ saleId: "wf-2", market: "keystone", price: 5400000 })],
  );
  assert.equal("error" in result, false);
  if ("error" in result) return;
  const dryExclusions = result.excludedComps.filter((c) => /dry-lot/.test(c.reason));
  assert.equal(dryExclusions[0]?.saleId, "near-miss"); // same-market near miss outranks junk
  // address-level dedupe: only one Bayview Ln exclusion survives
  assert.equal(result.excludedComps.filter((c) => c.address.startsWith("2310 Bayview Ln")).length, 1);
  // scores are attached so the UI can show how close a miss was
  assert.equal(typeof dryExclusions[0]?.score, "number");
});

test("solid comps that miss the top-N cut stay visible as exclusions with scores", () => {
  const sales = Array.from({ length: 7 }, (_, i) =>
    sale({ saleId: `wf-${i}`, address: `${100 + i} Keystone Blvd`, price: 5000000 + i * 100000 }),
  );
  const result = evaluateComps(sales, true, "dated", "north_miami_keystone", 5, "sfr", "canal");
  assert.equal(result.selected.length, 5);
  const overflow = result.excluded.filter((c) => /outranked/.test(c.reason));
  assert.equal(overflow.length, 2);
  assert.equal(typeof overflow[0]?.score, "number");
  // every sale is accounted for: selected + excluded
  assert.equal(result.selected.length + result.excluded.length, sales.length);
});
