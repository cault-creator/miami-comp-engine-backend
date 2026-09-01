// Miami-Dade County Property Appraiser JSON API (plain HTTP, no browser).
// Discovered 2026-08-26 from the PA site's own frontend bundle:
//   GET {BASE}/PApublicServiceProxy/PaServicesProxy.ashx
//     ?Operation=GetAddress&clientAppName=PropertySearch&myAddress=...&from=1&to=200
//     ?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch&folioNumber=0232260020010  (dashless!)
//
// 2026-08-27 hardening (condo/unit + wrong-suffix fixes):
//  - County GetAddress is EXACT: wrong street suffix (DR vs CT) = 0 results, and
//    "APT 1510"/"Unit D"/"#17D" style input fails. County stores units in SiteUnit
//    (usually USPS-normalized numeric, e.g. "17D" becomes "1704").
//  - Resolver chain: as-is -> street+myUnit -> suffix variants -> street-without-suffix
//    -> building unit scan with fuzzy unit match. Candidates now include the unit.
import type { CountyRecord } from "./engineCore";

const BASE = "https://apps.miamidadepa.gov";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; MiamiValueEngine/1.0)",
  Referer: "https://apps.miamidadepa.gov/propertysearch/",
};

const STREET_SUFFIXES = [
  "ST", "AVE", "AV", "DR", "CT", "RD", "TER", "LN", "WAY", "PL",
  "CIR", "BLVD", "PKWY", "TRL", "PLZ", "SQ", "HWY", "CT", "LOOP",
];

interface MinInfo {
  Municipality: string;
  Owner1: string;
  SiteAddress: string;
  SiteUnit: string;
  Strap: string;
  [k: string]: any;
}

async function paGet(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ clientAppName: "PropertySearch", ...params });
  const res = await fetch(`${BASE}/PApublicServiceProxy/PaServicesProxy.ashx?${qs}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`county API HTTP ${res.status}`);
  return res.json();
}

async function getAddress(myAddress: string, myUnit = "", from = 1, to = 200): Promise<any> {
  return paGet({
    Operation: "GetAddress",
    myAddress: myAddress.toUpperCase(),
    myUnit,
    from: String(from),
    to: String(to),
  });
}

// Split raw user input into street part + unit token.
export function parseAddressInput(raw: string): { street: string; unit: string | null } {
  let s = String(raw ?? "")
    .toUpperCase()
    .replace(/,.*$/, "") // drop ", Miami FL 33139" tail
    .replace(/\b(FL|FLORIDA|MIAMI-DADE)\b/g, " ")
    .replace(/\s+\d{5}(-\d{4})?$/, "") // trailing zip only — 5-digit house numbers exist
    .replace(/\s+/g, " ")
    .trim();
  // explicit unit keywords: APT 1510, UNIT D, STE 2, NO 17D, NUMBER 17D, # 1510
  let m = s.match(/^(.*?)\s+(?:APT|APARTMENT|UNIT|STE|SUITE|NO\.?|NUMBER|PH)\s*#?\s*([A-Z0-9][A-Z0-9-]*)$/);
  if (m) return { street: m[1].trim(), unit: m[2] };
  m = s.match(/^(.*?)\s+#\s*([A-Z0-9][A-Z0-9-]*)$/);
  if (m) return { street: m[1].trim(), unit: m[2] };
  // trailing unit after a street suffix: "... AVE 1510" or "... AVE 17D" or "... AVE D"
  const sfx = STREET_SUFFIXES.join("|");
  m = s.match(new RegExp(`^(.*?\\b(?:${sfx}))\\s+([0-9]+[A-Z]|[A-Z]|\\d{1,5})$`));
  if (m) return { street: m[1].trim(), unit: m[2] };
  return { street: s, unit: null };
}

const normUnit = (u: string) => String(u ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function toCandidates(infos: MinInfo[]) {
  return infos.slice(0, 12).map((i) => ({
    address: i.SiteAddress,
    folio: i.Strap,
    unit: i.SiteUnit || undefined,
  }));
}

// Fetch every unit row for a multi-result building (county pages cap at 200).
async function fetchAllUnits(street: string): Promise<MinInfo[]> {
  const all: MinInfo[] = [];
  let from = 1;
  for (let page = 0; page < 4; page++) {
    const d = await getAddress(street, "", from, from + 199);
    const infos: MinInfo[] = d?.MinimumPropertyInfos ?? [];
    all.push(...infos);
    const total = d?.Total ?? infos.length;
    if (all.length >= total || infos.length === 0) break;
    from += 200;
  }
  return all;
}

// Fuzzy-pick one unit from a building list. County normalizes units
// ("17D" may be stored as "1704"); alpha units fall back to digit-prefix match.
function matchUnit(infos: MinInfo[], unit: string): MinInfo[] {
  const want = normUnit(unit);
  if (!want) return [];
  const exact = infos.filter((i) => normUnit(i.SiteUnit) === want);
  if (exact.length) return exact;
  const digitWant = want.replace(/[A-Z]+$/, "");
  if (!digitWant) return [];
  return infos.filter((i) => {
    const u = normUnit(i.SiteUnit);
    if (!u) return false;
    const digitHave = u.replace(/[A-Z]+$/, "");
    return u.startsWith(digitWant) || (digitHave.length >= 2 && want.startsWith(digitHave));
  });
}

type LookupResult =
  | { ok: true; folioDashed: string; infos: MinInfo[] }
  | { ok: false; error: string; candidates?: { address: string; folio: string; unit?: string }[] };

async function resolveFolio(rawAddress: string): Promise<LookupResult> {
  const { street, unit } = parseAddressInput(rawAddress);

  // 1) as-is (county accepts "... AVE 1510" directly)
  let d = await getAddress(rawAddress);
  let infos: MinInfo[] = d?.MinimumPropertyInfos ?? [];
  if (infos.length === 1) return { ok: true, folioDashed: infos[0].Strap, infos };

  // 2) parsed street + county myUnit param
  if (infos.length === 0 && unit) {
    d = await getAddress(street, unit);
    infos = d?.MinimumPropertyInfos ?? [];
    if (infos.length === 1) return { ok: true, folioDashed: infos[0].Strap, infos };
  }

  // 3) street variants: wrong suffix (DR vs CT) is the #1 failure
  if (infos.length === 0) {
    const tokens = street.split(" ");
    const last = tokens[tokens.length - 1];
    const variants: string[] = [];
    if (STREET_SUFFIXES.includes(last)) {
      const base = tokens.slice(0, -1).join(" ");
      variants.push(base); // no suffix: "61 CAMDEN"
      for (const s of STREET_SUFFIXES) if (s !== last) variants.push(`${base} ${s}`);
    }
    for (const v of variants) {
      d = await getAddress(v);
      const got: MinInfo[] = d?.MinimumPropertyInfos ?? [];
      if (got.length) {
        // guard against wrong-street hits: house number must match the input
        const hn = /^(\d+)/.exec(street)?.[1];
        const filtered = hn
          ? got.filter((i) => String(i.SiteAddress).startsWith(hn + " "))
          : got;
        if (filtered.length) {
          infos = filtered;
          break;
        }
      }
    }
  }

  if (infos.length === 0) return { ok: false, error: "no county match for that address" };

  // 4) multiple rows: same-street units or genuine duplicates
  if (infos.length > 1 || (infos.length === 1 && unit && normUnit(infos[0].SiteUnit) !== normUnit(unit))) {
    const all = infos.length > 1 && (d?.Total ?? 0) > infos.length ? await fetchAllUnits(street) : infos;
    if (unit) {
      const matches = matchUnit(all, unit);
      if (matches.length === 1) return { ok: true, folioDashed: matches[0].Strap, infos: matches };
      if (matches.length > 1) {
        return {
          ok: false,
          error: `multiple units match "${unit}" — pick one`,
          candidates: toCandidates(matches),
        };
      }
      return {
        ok: false,
        error: `unit "${unit}" not found at ${street} — check the unit number`,
        candidates: toCandidates(all.filter((i) => i.SiteUnit).slice(0, 12)),
      };
    }
    // no unit given: pick through candidates (condo buildings return many rows)
    const withUnits = all.filter((i) => i.SiteUnit);
    if (withUnits.length > 1) {
      return {
        ok: false,
        error: `${d?.Total ?? all.length} units at this address — add a unit number (e.g. "${street} ${withUnits[0].SiteUnit}")`,
        candidates: toCandidates(withUnits),
      };
    }
    if (all.length === 1) return { ok: true, folioDashed: all[0].Strap, infos: all };
    return {
      ok: false,
      error: `${all.length} county matches — pick one`,
      candidates: toCandidates(all),
    };
  }

  return { ok: true, folioDashed: infos[0].Strap, infos };
}

export async function fetchCountyByFolio(folioDashed: string): Promise<
  { ok: true; county: CountyRecord } | { ok: false; error: string }
> {
  const folio = folioDashed.replace(/-/g, "");
  const d = await paGet({ Operation: "GetPropertySearchByFolio", folioNumber: folio });
  if (d?.Message) return { ok: false, error: String(d.Message) };

  const pi = d.PropertyInfo ?? {};
  const assessments: any[] = d.Assessment?.AssessmentInfos ?? [];
  const cur = assessments.reduce(
    (best: any, a: any) => (a.Year > (best?.Year ?? 0) ? a : best),
    null,
  );
  const extras: any[] = d.ExtraFeature?.ExtraFeatureInfos ?? [];
  const legal = String(d.LegalDescription?.Description ?? "");
  const site = (d.SiteAddress ?? [])[0] ?? {};
  const zipMatch = /(\d{5})(-\d{4})?$/.exec(String(site.Address ?? ""));
  const sales: any[] = d.SalesInfos ?? [];
  const buildings: any[] = d.Building?.BuildingInfos ?? [];
  const yearRaw = String(pi.YearBuilt ?? "");
  let yearBuilt: number | null = /^\d{4}$/.test(yearRaw) ? parseInt(yearRaw, 10) : null;
  if (!yearBuilt && buildings.length) {
    const years = buildings
      .map((b: any) => parseInt(String(b.Actual ?? ""), 10))
      .filter((y: number) => y > 1700 && y < 2100);
    if (years.length) yearBuilt = Math.min(...years);
  }
  const cleanName = (s: string) =>
    String(s ?? "").replace(/<w\/>/g, " ").replace(/&W\b/g, "& Wife").replace(/\s+/g, " ").trim();
  const dor = String(pi.DORDescription ?? "");
  const propertyClass = /CONDOMINIUM|CONDO|CO-OP|COOPERATIVE/i.test(dor) ? "condo" : "sfr";
  const unit = String(site.Address ?? "").match(/(?:UNIT|APT|#)\s*([A-Z0-9-]+)/i)?.[1] ?? null;

  const county: CountyRecord = {
    address: String(site.Address ?? "").replace(/, FL \d{5}(-\d{4})?$/, ""),
    zip: zipMatch ? zipMatch[1] : null,
    folio: folioDashed,
    owner: (d.OwnerInfos ?? [])
      .map((o: any) => cleanName(o.Name))
      .filter(Boolean)
      .join(" & "),
    subdivision: pi.SubdivisionDescription ?? "",
    municipality: pi.Municipality ?? "",
    beds: pi.BedroomCount || null,
    baths: (pi.BathroomCount || 0) + (pi.HalfBathroomCount ? 0.5 : 0) || null,
    livingSF: pi.BuildingHeatedArea || null,
    lotSF: pi.LotSize || null,
    yearBuilt,
    landValue: cur?.LandValue ?? null,
    marketValue: cur?.TotalValue ?? null,
    hasDock: extras.some((e: any) => /dock/i.test(String(e.Description ?? ""))),
    riparian: /RIP RTS/i.test(legal),
    homestead: (pi.PercentHomesteadCapped ?? 0) > 0,
    dorDescription: dor,
    propertyClass,
    unit,
    salesHistory: sales.slice(0, 5).map((s: any) => ({
      date: s.DateOfSale ?? "",
      price: s.SalePrice ?? null,
      qual: s.QualificationDescription ?? "",
    })),
  };
  return { ok: true, county };
}

export async function fetchCountyByAddress(addressNoCity: string): Promise<
  | { ok: true; county: CountyRecord }
  | { ok: false; error: string; candidates?: { address: string; folio: string; unit?: string }[] }
> {
  const r = await resolveFolio(addressNoCity);
  if (!r.ok) return r;
  return fetchCountyByFolio(r.folioDashed);
}
