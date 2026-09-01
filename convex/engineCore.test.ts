import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectMicroMarket,
  detectWaterfront,
  marketMatches,
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
    sale({ saleId: "same-1", price: 5000000, livingSF: 2600, market: "keystone" }),
    sale({ saleId: "same-2", price: 5400000, livingSF: 2700, market: "North Miami" }),
    sale({ saleId: "other", price: 7000000, livingSF: 3000, market: "miami_beach" }),
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
