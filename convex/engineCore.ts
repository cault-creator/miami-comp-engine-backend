// Miami comp engine core — TypeScript port of skills/miami_comp_engine/scripts/engine.py.
// Pure functions: no DB, no fetch. Valuation is deterministic; human review stays on.

export interface CountyRecord {
  address: string;
  zip: string | null;
  folio: string;
  owner: string;
  subdivision: string;
  municipality: string;
  beds: number | null;
  baths: number | null;
  livingSF: number | null;
  lotSF: number | null;
  yearBuilt: number | null;
  landValue: number | null; // current roll year
  marketValue: number | null; // current roll year total
  hasDock: boolean;
  riparian: boolean;
  homestead: boolean;
  dorDescription: string;
  propertyClass: "sfr" | "condo";
  unit: string | null;
  salesHistory: { date: string; price: number | null; qual: string }[];
}

export interface SaleRow {
  saleId: string;
  address: string;
  market: string;
  zip: string;
  soldDate: string;
  price: number;
  beds?: number | null;
  baths?: number | null;
  livingSF: number;
  lotSF?: number | null;
  waterfront: boolean;
  waterType: string;
  conditionClass: string;
  verified: boolean;
  source: string;
  propertyClass?: "sfr" | "condo";
}

export const RULES = {
  micro_markets: {
    bay_harbor_islands: {
      zips: ["33154"],
      match_keywords: ["bay harbor island"],
      land_rate_lot_sf: {
        dry: [220, 300],
        canal_lake_wf: [350, 450],
        open_bay_wf: [450, 600],
      },
      dollar_per_sf: {
        dry: {
          dated: [600, 750],
          semi_modern: [800, 950],
          renovated: [950, 1150],
          new: [1300, 1600],
        },
        waterfront: {
          dated: [800, 1000],
          semi_modern: [1000, 1250],
          renovated: [1200, 1500],
          new: [1600, 2200],
        },
      },
      condo_dollar_per_sf: {
        dry: {
          dated: [400, 550],
          semi_modern: [500, 700],
          renovated: [700, 950],
          new: [1100, 1500],
        },
        waterfront: {
          dated: [500, 700],
          semi_modern: [650, 900],
          renovated: [900, 1300],
          new: [1500, 2200],
        },
      },
      wf_land_threshold: 350,
    },
    miami_beach: {
      zips: ["33139", "33140", "33141"],
      match_keywords: ["miami beach"],
      land_rate_lot_sf: {
        dry: [150, 200],
        canal_lake_wf: [380, 450],
        open_bay_wf: [550, 700],
      },
      dollar_per_sf: {
        dry: {
          dated: [850, 1000],
          semi_modern: [850, 1050],
          renovated: [1400, 1750],
          new: [2300, 2600],
        },
        waterfront: {
          dated: [875, 1150],
          semi_modern: [1000, 1250],
          renovated: [1600, 2000],
          new: [2000, 3400],
        },
      },
      condo_dollar_per_sf: {
        dry: {
          dated: [450, 650],
          semi_modern: [650, 900],
          renovated: [900, 1300],
          new: [2000, 3000],
        },
        waterfront: {
          dated: [550, 800],
          semi_modern: [800, 1100],
          renovated: [1200, 1800],
          new: [2500, 3500],
        },
      },
      wf_land_threshold: 350,
    },
    north_miami_keystone: {
      zips: ["33181"],
      match_keywords: ["keystone", "north miami", "biscayne bay", "alamanda", "maple", "banyan"],
      land_rate_lot_sf: {
        dry: [85, 130],
        canal_lake_wf: [190, 220],
        open_bay_wf: [300, 400],
      },
      dollar_per_sf: {
        dry: {
          dated: [590, 940],
          semi_modern: [700, 1000],
          renovated: [900, 1200],
          new: [1100, 1500],
        },
        waterfront: {
          dated: [1500, 1800],
          semi_modern: [1600, 1900],
          renovated: [1900, 2100],
          new: [2100, 2800],
        },
      },
      condo_dollar_per_sf: {
        dry: {
          dated: [280, 380],
          semi_modern: [350, 450],
          renovated: [450, 600],
          new: [700, 900],
        },
        waterfront: {
          dated: [350, 450],
          semi_modern: [450, 600],
          renovated: [600, 800],
          new: [900, 1200],
        },
      },
      wf_land_threshold: 170,
    },
    north_bay_village: {
      zips: ["33141"],
      match_keywords: ["treasure plaza", "north bay village", "adventure", "hispanola", "coquina"],
      land_rate_lot_sf: {
        dry: [90, 110],
        canal_lake_wf: [180, 250],
        open_bay_wf: [250, 350],
      },
      dollar_per_sf: {
        dry: {
          dated: [480, 560],
          semi_modern: [550, 700],
          renovated: [700, 900],
          new: [900, 1200],
        },
        waterfront: {
          dated: [600, 850],
          semi_modern: [700, 900],
          renovated: [900, 1200],
          new: [1200, 1600],
        },
      },
      condo_dollar_per_sf: {
        dry: {
          dated: [300, 400],
          semi_modern: [400, 500],
          renovated: [500, 700],
          new: [750, 1000],
        },
        waterfront: {
          dated: [400, 550],
          semi_modern: [550, 700],
          renovated: [700, 950],
          new: [1000, 1400],
        },
      },
      wf_land_threshold: 170,
    },
  } as Record<string, MicroMarketCfg>,
  street_rules: {
    "FLAMINGO DR": { odd: "waterfront", even: "dry" },
    "BISCAYNE BAY DR": { odd: "waterfront", even: "dry" },
  } as Record<string, { odd: string; even: string }>,
  condition_by_year: [
    [2015, "new"],
    [2000, "semi_modern"],
    [0, "dated"],
  ] as [number, string][],
  offer_ladder: { opening: 0.8, target: 0.85, maximum: 0.9 },
};

export interface MicroMarketCfg {
  zips: string[];
  match_keywords: string[];
  land_rate_lot_sf: Record<string, [number, number]>;
  dollar_per_sf: Record<string, Record<string, [number, number]>>;
  condo_dollar_per_sf?: Record<string, Record<string, [number, number]>>;
  wf_land_threshold: number;
}

export function detectMicroMarket(c: CountyRecord): [string | null, MicroMarketCfg | null] {
  const hay = `${c.subdivision} ${c.address}`.toLowerCase();
  for (const [name, cfg] of Object.entries(RULES.micro_markets)) {
    if (cfg.match_keywords.some((k) => hay.includes(k))) return [name, cfg];
  }
  if (c.zip === "33181") return ["north_miami_keystone", RULES.micro_markets.north_miami_keystone];
  if (c.zip && ["33139", "33140", "33141"].includes(c.zip))
    return ["miami_beach", RULES.micro_markets.miami_beach];
  // Bal Harbour / Surfside / Bay Harbor / Indian Creek (33154): adjacent luxury
  // market — uses Miami Beach bands until we calibrate with 33154 sales.
  if (
    c.zip === "33154" ||
    ["bal harbour", "bal harbor", "surfside", "bay harbor", "indian creek"].some((k) =>
      hay.includes(k),
    )
  )
    return ["miami_beach", RULES.micro_markets.miami_beach];
  return [null, null];
}

export function detectWaterfront(
  c: CountyRecord,
  cfg: MicroMarketCfg | null,
): [boolean, string] {
  const m = /^(\d+)\s+(.*)/.exec(c.address || "");
  const housenum = m ? parseInt(m[1], 10) : null;
  const street = m ? m[2].trim().toUpperCase() : "";
  for (const [s, rule] of Object.entries(RULES.street_rules)) {
    if (street.includes(s) && housenum) {
      const side = housenum % 2 ? "odd" : "even";
      const isWf = (rule as Record<string, string>)[side] === "waterfront";
      return [isWf, `street rule ${s} ${side}=${isWf ? "WF" : "dry"}`];
    }
  }
  if (c.hasDock) return [true, "dock in county extras"];
  if (c.riparian) return [true, "RIP RTS in legal"];
  if (c.landValue && c.lotSF && cfg) {
    const rate = c.landValue / c.lotSF;
    if (rate >= cfg.wf_land_threshold)
      return [true, `county land $${rate.toFixed(0)}/lot SF >= ${cfg.wf_land_threshold}`];
  }
  return [false, "no water signals"];
}

export function conditionClass(c: CountyRecord): string {
  const yb = c.yearBuilt || 0;
  for (const [cutoff, cls] of RULES.condition_by_year) {
    if (yb >= cutoff) return cls;
  }
  return "dated";
}

// Map consumer/admin condition tier answers to engine condition classes.
export function tierToCondition(tier: string, yearClass: string): string {
  switch (tier) {
    case "renovated":
      return "renovated";
    case "remodel": // updated / good condition
      return yearClass === "new" ? "new" : "semi_modern";
    case "full_gut":
      return "dated";
    case "teardown":
    case "new_dev":
      return "dated"; // priced off the dirt via teardown flag
    default:
      return yearClass;
  }
}

export function parseSoldDate(s: string): Date | null {
  const text = (s || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

const MARKET_ALIASES: Record<string, string[]> = {
  bay_harbor_islands: ["bay_harbor_islands", "bay harbor islands", "bay harbor"],
  bal_harbour: ["bal_harbour", "bal harbour", "bal harbor"],
  miami_beach: ["miami_beach", "miami beach"],
  north_miami_keystone: ["north_miami_keystone", "keystone", "north miami"],
  north_bay_village: ["north_bay_village", "north bay village"],
  surfside: ["surfside"],
};

function normalizeMarket(s: string): string {
  return (s || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

export function marketMatches(rowMarket: string, subjectMarket: string | null): boolean {
  if (!subjectMarket) return false;
  const row = normalizeMarket(rowMarket);
  const subject = normalizeMarket(subjectMarket);
  if (row === subject) return true;
  const aliases = MARKET_ALIASES[subject] ?? [subject];
  return aliases.map(normalizeMarket).includes(row);
}

export interface MatchedComp {
  saleId: string;
  address: string;
  price: number;
  sf: number;
  lotSF?: number | null;
  psf: number;
  sold: string;
  cond: string;
  wf: boolean;
  waterType?: string;
  verified: boolean;
  sameMarket?: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
}

export type WaterTier = "dry" | "canal" | "open_bay";

export interface ExcludedComp {
  saleId: string;
  address: string;
  price?: number;
  sf?: number | null;
  psf?: number | null;
  sold?: string;
  reason: string;
  reasons: string[];
}

export interface CompMatchSummary {
  selectedCount: number;
  sameMarketCount: number;
  verifiedCount: number;
  medianPsf: number | null;
  excludedCount: number;
}

export interface CompMatchResult {
  selected: MatchedComp[];
  excluded: ExcludedComp[];
  summary: CompMatchSummary;
}

export interface SubjectCompProfile {
  livingSF?: number | null;
  lotSF?: number | null;
  landFloor?: [number, number] | null;
}

export function waterTier(t: string): WaterTier {
  const s = (t || "").toLowerCase();
  if (!s || s === "none") return "dry";
  if (s.includes("canal") || s.includes("lake") || s.includes("waterway")) return "canal";
  if (s.includes("bay") || s.includes("ocean")) return "open_bay";
  return "canal"; // "verify" etc — assume protected water, not open bay
}

function similarityRatio(row: number | null | undefined, subject: number | null | undefined) {
  if (!row || !subject) return null;
  return Math.abs(row - subject) / subject;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function evaluateComps(
  sales: SaleRow[],
  isWf: boolean,
  cond: string,
  microName: string | null,
  topN = 5,
  subjectClass: "sfr" | "condo" = "sfr",
  subjectTier: WaterTier = "dry",
  subject: SubjectCompProfile = {},
): CompMatchResult {
  const out: MatchedComp[] = [];
  const excluded: ExcludedComp[] = [];
  const today = new Date();
  const exclude = (r: SaleRow, reason: string, reasons: string[] = [reason]) => {
    excluded.push({
      saleId: r.saleId,
      address: r.address,
      price: r.price,
      sf: r.livingSF,
      psf: r.price && r.livingSF ? Math.round(r.price / r.livingSF) : null,
      sold: r.soldDate,
      reason,
      reasons,
    });
  };

  for (const r of sales) {
    if (!r.price || !r.livingSF) {
      exclude(r, "missing sale price or living area");
      continue;
    }
    // garbage rows (partial-interest transfers, data errors) never comp
    const psf = r.price / r.livingSF;
    if (r.price < 100_000 || psf < 150) {
      exclude(r, "below minimum arm's-length sale sanity threshold");
      continue;
    }
    // condos only comp against condos, houses against houses
    if ((r.propertyClass ?? "sfr") !== subjectClass) {
      exclude(r, `property class mismatch: ${(r.propertyClass ?? "sfr")} sale for ${subjectClass} subject`);
      continue;
    }
    const rowTier = r.waterfront ? waterTier(r.waterType) : "dry";
    if (isWf && !r.waterfront) {
      exclude(r, "dry-lot sale cannot price a waterfront subject");
      continue;
    }
    if (!isWf && r.waterfront) {
      exclude(r, "waterfront sale would overprice a dry-lot subject");
      continue;
    }
    if (subject.landFloor && isWf && r.waterfront && r.price < subject.landFloor[0] * 0.85) {
      exclude(r, "waterfront sale is materially below subject land-floor support");
      continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];
    const sameMarket = marketMatches(r.market, microName);
    if (sameMarket) {
      score += 4;
      reasons.push("same micro-market");
    } else {
      score -= 2;
      warnings.push("outside subject micro-market");
    }
    score += 3;
    reasons.push(isWf ? "waterfront sale" : "dry-lot sale");
    // water-tier match: canal sales don't price open-bay trophy and vice versa
    if (subjectTier !== "dry" && rowTier !== "dry") {
      if (rowTier === subjectTier) {
        score += 3;
        reasons.push(`water tier matches: ${rowTier}`);
      } else {
        score -= 4;
        warnings.push(`water tier differs: ${rowTier} sale for ${subjectTier} subject`);
      }
    }
    const saleCond = r.conditionClass.toLowerCase();
    if (saleCond.includes(cond)) {
      score += 1;
      reasons.push(`condition aligns: ${r.conditionClass}`);
    } else if (cond === "dated" && /new|renovated/.test(saleCond)) {
      score -= 2;
      warnings.push("superior condition sale may overstate as-is value");
    } else if ((cond === "new" || cond === "renovated") && /dated|original|teardown/.test(saleCond)) {
      score -= 2;
      warnings.push("inferior condition sale may understate improved value");
    }

    const sfDelta = similarityRatio(r.livingSF, subject.livingSF);
    if (sfDelta !== null) {
      if (sfDelta <= 0.2) {
        score += 3;
        reasons.push("similar living area");
      } else if (sfDelta <= 0.35) {
        score += 1;
        reasons.push("usable living-area bracket");
      } else if (sfDelta <= 0.5) {
        score -= 1;
        warnings.push("wide living-area adjustment needed");
      } else {
        score -= 3;
        warnings.push("major living-area mismatch");
      }
    }
    const lotDelta = similarityRatio(r.lotSF, subject.lotSF);
    if (lotDelta !== null) {
      if (lotDelta <= 0.25) {
        score += 2;
        reasons.push("similar lot size");
      } else if (lotDelta <= 0.5) {
        score += 1;
        reasons.push("usable lot-size bracket");
      } else {
        score -= 2;
        warnings.push("major lot-size mismatch");
      }
    }
    const d = parseSoldDate(r.soldDate);
    if (d) {
      const age = (today.getTime() - d.getTime()) / 86400000;
      if (age <= 180) {
        score += 2;
        reasons.push("recent sale");
      } else if (age <= 400) {
        score += 1;
        reasons.push("current-cycle sale");
      } else if (age > 730) {
        score -= 2;
        warnings.push("older than two years");
      }
    } else {
      warnings.push("sale date could not be parsed");
    }
    if (r.verified) {
      score += 2;
      reasons.push("verified source");
    } else {
      warnings.push("secondary-source sale; verify in MLS/county");
    }
    if (score < 5) {
      exclude(r, "low similarity score after feature checks", [...reasons, ...warnings]);
      continue;
    }
    out.push({
      saleId: r.saleId,
      address: r.address,
      price: r.price,
      sf: r.livingSF,
      lotSF: r.lotSF,
      psf: Math.round(psf),
      sold: r.soldDate,
      cond: r.conditionClass,
      wf: r.waterfront,
      waterType: r.waterType,
      verified: r.verified,
      sameMarket,
      score,
      reasons,
      warnings,
    });
  }
  out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  let selected = out.slice(0, topN);
  if (subjectTier !== "dry") {
    const tierMatched = out.filter((c) => waterTier((c as any).waterType ?? "") === subjectTier);
    if (tierMatched.length >= 2) selected = tierMatched.slice(0, topN);
  }
  return {
    selected,
    excluded: excluded.slice(0, 25),
    summary: {
      selectedCount: selected.length,
      sameMarketCount: selected.filter((c) => c.sameMarket).length,
      verifiedCount: selected.filter((c) => c.verified).length,
      medianPsf: median(selected.map((c) => c.psf)),
      excludedCount: excluded.length,
    },
  };
}

export function matchComps(
  sales: SaleRow[],
  isWf: boolean,
  cond: string,
  microName: string | null,
  topN = 5,
  subjectClass: "sfr" | "condo" = "sfr",
  subjectTier: WaterTier = "dry",
  subject: SubjectCompProfile = {},
): MatchedComp[] {
  return evaluateComps(sales, isWf, cond, microName, topN, subjectClass, subjectTier, subject)
    .selected;
}

export interface Valuation {
  micro: string | null;
  propertyClass: "sfr" | "condo";
  dataNote?: string | null;
  waterfront: boolean;
  waterfrontWhy: string;
  condition: string;
  psfBand: [number, number];
  landRateBand: [number, number];
  finishedRange: [number, number] | null;
  landFloor: [number, number] | null;
  retailLow: number;
  retailHigh: number;
  mostLikely: number;
  offers: { opening: number; target: number; maximum: number };
  comps: MatchedComp[];
  excludedComps: ExcludedComp[];
  compSummary: CompMatchSummary;
  reasoning: string[];
  confidence: string;
  countyMarketValue: number | null;
}

export function valueProperty(
  county: CountyRecord,
  sales: SaleRow[],
  conditionTier?: string,
): Valuation | { error: string } {
  const [microName, cfg] = detectMicroMarket(county);
  if (!cfg) return { error: "no micro-market rules for this address" };
  const [isWf, wfWhy] = detectWaterfront(county, cfg);
  const yearClass = conditionClass(county);
  const cond = conditionTier ? tierToCondition(conditionTier, yearClass) : yearClass;
  const wkey = isWf ? "waterfront" : "dry";
  const isCondo = county.propertyClass === "condo";
  const bandTable = isCondo && cfg.condo_dollar_per_sf ? cfg.condo_dollar_per_sf : cfg.dollar_per_sf;
  const band = bandTable[wkey][cond] || bandTable[wkey].dated;
  const sf = county.livingSF;
  const lot = county.lotSF;
  // Condos: no land floor, no teardown play — value is interior $/SF only.
  const landBand = cfg.land_rate_lot_sf[isWf ? "canal_lake_wf" : "dry"] as [number, number];
  const landFloor: [number, number] | null =
    !isCondo && lot ? [Math.round(lot * landBand[0]), Math.round(lot * landBand[1])] : null;
  let finished: [number, number] | null = sf
    ? [Math.round(sf * band[0]), Math.round(sf * band[1])]
    : null;
  const teardown =
    !isCondo &&
    (conditionTier === "teardown" ||
      conditionTier === "new_dev" ||
      (cond === "dated" && (county.beds || 3) <= 2));
  if (teardown && landFloor) {
    finished = [landFloor[0], Math.round(landFloor[1] * 1.2)];
  }
  const landRate = county.landValue && county.lotSF ? county.landValue / county.lotSF : 0;
  const subjectTier: WaterTier = !isWf
    ? "dry"
    : cfg && landRate >= cfg.land_rate_lot_sf.open_bay_wf[0]
      ? "open_bay"
      : "canal";
  const compEval = evaluateComps(sales, isWf, cond, microName, 5, isCondo ? "condo" : "sfr", subjectTier, {
    livingSF: sf,
    lotSF: lot,
    landFloor,
  });
  const comps = compEval.selected;
  // Comp-weighted pricing: with 2+ same-market comps, actual sold $/SF beats
  // static bands — that's the "dialed-in" value. Bands remain the fallback.
  const compPsfs = comps
    .filter((c) => c.sameMarket && c.psf >= 150)
    .map((c) => c.psf)
    .sort((a, b) => a - b);
  // interpolated percentile
  const pct = (arr: number[], f: number) => {
    if (arr.length === 1) return arr[0];
    const i = f * (arr.length - 1);
    const lo = Math.floor(i);
    return arr[lo] + (arr[Math.min(arr.length - 1, lo + 1)] - arr[lo]) * (i - lo);
  };
  // IQR outlier trim (trophy sales skew small samples) — needs 4+ points
  let trimmed = compPsfs;
  if (compPsfs.length >= 4) {
    const q1 = pct(compPsfs, 0.25);
    const q3 = pct(compPsfs, 0.75);
    const iqr = q3 - q1;
    const kept = compPsfs.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
    if (kept.length >= 2) trimmed = kept;
  }
  let pricedFromComps = false;
  if (sf && trimmed.length >= 2) {
    finished = [Math.round(sf * pct(trimmed, 0.25)), Math.round(sf * pct(trimmed, 0.75))];
    pricedFromComps = true;
  }
  const lows = [finished?.[0], landFloor?.[0]].filter((x): x is number => !!x);
  const highs = [finished?.[1], landFloor?.[1]].filter((x): x is number => !!x);
  const retailLow = Math.max(...lows);
  const retailHigh = Math.max(...highs);
  const mostLikely = Math.round((retailLow + retailHigh) / 2);
  const round10k = (n: number) => Math.round(n / 10000) * 10000;
  const verifiedN = comps.filter((c) => c.verified).length;
  const sameMarketN = comps.filter((c) => c.sameMarket).length;
  const conf = isCondo
    ? verifiedN >= 2
      ? "B"
      : "C"
    : verifiedN >= 2
      ? "A-"
      : comps.length >= 3 && sameMarketN >= 1
        ? "B"
        : sameMarketN >= 1
          ? "B-"
          : "C";
  const reasoning = [
    `Subject classified as ${microName ?? "unknown market"} / ${isCondo ? "condo" : "single-family"} / ${subjectTier}.`,
    `Waterfront decision: ${isWf ? "yes" : "no"} (${wfWhy}).`,
    pricedFromComps
      ? `Valuation uses selected same-market sale $/SF range after feature checks: $${trimmed[0]}-$${trimmed[trimmed.length - 1]}/SF.`
      : "Valuation falls back to market bands because fewer than two same-market sales passed feature checks.",
    landFloor
      ? `Land floor support is $${landFloor[0].toLocaleString()}-$${landFloor[1].toLocaleString()} before finished-home overlay.`
      : "No land floor applied for this property type.",
    `${compEval.summary.selectedCount} comps selected; ${compEval.summary.excludedCount} sales excluded for class, water, land-floor, size, age, or similarity issues.`,
  ];
  return {
    micro: microName,
    propertyClass: isCondo ? "condo" : "sfr",
    dataNote: pricedFromComps
      ? `Priced from ${trimmed.length} same-market sales ($${trimmed[0]}–$${trimmed[trimmed.length - 1]}/SF).`
      : isCondo
        ? comps.length
          ? null
          : "Condo estimate from market bands — no condo sales in the DB yet. Add condo sales (same building best) to sharpen this."
        : "Estimate from market bands — fewer than 2 same-market comps in the DB. Add sales to sharpen this.",
    waterfront: isWf,
    waterfrontWhy: wfWhy,
    condition: teardown ? "teardown" : cond,
    psfBand: band,
    landRateBand: landBand,
    finishedRange: finished,
    landFloor,
    retailLow,
    retailHigh,
    mostLikely,
    offers: {
      opening: round10k(mostLikely * RULES.offer_ladder.opening),
      target: round10k(mostLikely * RULES.offer_ladder.target),
      maximum: round10k(mostLikely * RULES.offer_ladder.maximum),
    },
    comps,
    excludedComps: compEval.excluded,
    compSummary: compEval.summary,
    reasoning,
    confidence: conf,
    countyMarketValue: county.marketValue,
  };
}

// ---- Consumer readout (KBB-style) ----
// Caleb's rules: real instant-offer number, err low — just above the low end,
// never under. Plus retail/list value and net-after-costs, and a listing play.

export interface ConsumerReadout {
  instantOffer: number; // pinned just above the low of the wholesale range
  wholesaleRange: [number, number];
  retailEstimate: number; // most likely retail
  retailRange: [number, number];
  netAfterCosts: number; // retail minus selling costs at standard commission
  listingCommissionPct: number; // tiered
  listingCommission: number;
  confidence: string;
}

export function listingCommissionPct(price: number): number {
  if (price <= 2_000_000) return 3.0;
  if (price <= 5_000_000) return 2.5;
  if (price <= 7_500_000) return 2.0;
  if (price <= 10_000_000) return 1.5;
  return 1.0;
}

export function consumerReadout(v: Valuation): ConsumerReadout {
  const wholesaleLow = Math.round(v.mostLikely * RULES.offer_ladder.opening);
  const wholesaleHigh = Math.round(v.mostLikely * RULES.offer_ladder.maximum);
  // Just above the low, never under: low + 15% of the wholesale spread.
  const instantOffer =
    Math.round((wholesaleLow + (wholesaleHigh - wholesaleLow) * 0.15) / 5000) * 5000;
  const retail = v.mostLikely;
  const commissionPct = listingCommissionPct(retail);
  const commission = Math.round((retail * commissionPct) / 100);
  // Net after costs: commission + ~2% closing/misc on the retail price.
  const netAfterCosts = Math.round(retail - commission - retail * 0.02);
  return {
    instantOffer,
    wholesaleRange: [wholesaleLow, wholesaleHigh],
    retailEstimate: retail,
    retailRange: [v.retailLow, v.retailHigh],
    netAfterCosts,
    listingCommissionPct: commissionPct,
    listingCommission: commission,
    confidence: v.confidence,
  };
}
