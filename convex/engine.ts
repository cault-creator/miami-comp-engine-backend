declare const process: { env: Record<string, string | undefined> };
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { authenticatedAction, authenticatedMutation, authenticatedQuery } from "./functions";
import { fetchCountyByAddress, fetchCountyByFolio } from "./county";
import {
  consumerReadout,
  valueProperty,
  type SaleRow,
  type Valuation,
} from "./engineCore";
import { SEED_SALES } from "./seedData";
import { internal, api } from "./_generated/api";
import {
  TEAM_EMAIL,
  leadConsumerEmail,
  leadTeamEmail,
  offerConsumerEmail,
  offerTeamEmail,
} from "./emails";
import type { Doc } from "./_generated/dataModel";

async function loadSales(ctx: {
  db: { query: (t: "sales") => any };
}): Promise<SaleRow[]> {
  const rows: Doc<"sales">[] = await ctx.db.query("sales").collect();
  return rows.map((r) => ({
    saleId: r.saleId,
    address: r.address,
    market: r.market,
    zip: r.zip,
    soldDate: r.soldDate,
    price: r.price,
    beds: r.beds,
    baths: r.baths,
    livingSF: r.livingSF,
    lotSF: r.lotSF,
    waterfront: r.waterfront,
    waterType: r.waterType,
    conditionClass: r.conditionClass,
    verified: r.verified,
    source: r.source,
    yearBuilt: r.yearBuilt ?? null,
    propertyClass:
      r.propertyClass === "condo" || r.propertyClass === "sfr"
        ? r.propertyClass
        : undefined,
  }));
}

function isValuation(v: Valuation | { error: string }): v is Valuation {
  return !(v as { error?: string }).error;
}

function moneyValue(v: unknown): number | null {
  const maybe = v as { mostLikely?: unknown } | null;
  return typeof maybe?.mostLikely === "number" ? maybe.mostLikely : null;
}

function summarizeCompRun(run: {
  _id?: unknown;
  address: string;
  folio?: string;
  valuation?: unknown;
  createdAt: number;
}) {
  const valuation = (run.valuation ?? {}) as Partial<Valuation>;
  return {
    runId: String(run._id ?? ""),
    address: run.address,
    folio: run.folio,
    createdAt: run.createdAt,
    mostLikely: moneyValue(run.valuation),
    retailLow: typeof valuation.retailLow === "number" ? valuation.retailLow : null,
    retailHigh: typeof valuation.retailHigh === "number" ? valuation.retailHigh : null,
    confidence: typeof valuation.confidence === "string" ? valuation.confidence : null,
    condition: typeof valuation.condition === "string" ? valuation.condition : null,
    micro: typeof valuation.micro === "string" ? valuation.micro : null,
  };
}

function buildCompHistory(
  current: {
    _id?: unknown;
    address: string;
    folio?: string;
    valuation?: unknown;
    createdAt: number;
  },
  previousRuns: Array<{
    _id?: unknown;
    address: string;
    folio?: string;
    valuation?: unknown;
    createdAt: number;
  }>,
) {
  const currentSummary = summarizeCompRun(current);
  const previous = previousRuns.filter((r) => moneyValue(r.valuation) !== null).map(summarizeCompRun);
  const prior = previous[0] ?? null;
  const amount =
    currentSummary.mostLikely !== null && prior?.mostLikely !== null
      ? currentSummary.mostLikely - prior.mostLikely
      : null;
  return {
    current: currentSummary,
    previous,
    deltaFromPrevious:
      amount === null || !prior?.mostLikely
        ? null
        : {
            amount,
            percent: amount / prior.mostLikely,
            direction: amount > 0 ? "up" : amount < 0 ? "down" : "flat",
            previousRunId: prior.runId,
            previousCreatedAt: prior.createdAt,
          },
  };
}

// ---------- Admin (authenticated) ----------


async function resolveCounty(address: string, folio?: string) {
  if (folio && folio.trim()) return fetchCountyByFolio(folio.trim());
  return fetchCountyByAddress(address);
}

export const compAddress = authenticatedAction({
  args: {
    address: v.string(),
    conditionTier: v.optional(v.string()),
    folio: v.optional(v.string()),
    includeSupportIds: v.optional(v.array(v.string())),
    excludeSaleIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<any> => {
    const res = await resolveCounty(args.address, args.folio);
    if (!res.ok) return res;
    const sales = await ctx.runQuery(internal.engine._loadSalesInternal, {});
    const valuation = valueProperty(res.county, sales, args.conditionTier, {
      includeSupportIds: args.includeSupportIds,
      excludeSaleIds: args.excludeSaleIds,
    });
    const previousRuns = await ctx.runQuery(internal.engine._recentCompRunsByFolio, {
      folio: res.county.folio,
      limit: 8,
    });
    const createdAt = Date.now();
    const runId = await ctx.runMutation(internal.engine._recordCompRun, {
      kind: "admin",
      address: args.address,
      folio: res.county.folio,
      county: res.county,
      valuation,
      createdBy: ctx.userId,
      createdAt,
    });
    return {
      ok: true,
      county: res.county,
      valuation,
      runId,
      compHistory: buildCompHistory(
        { _id: runId, address: args.address, folio: res.county.folio, valuation, createdAt },
        previousRuns,
      ),
    };
  },
});

// Secret-key-gated variant for the HTTP API (calebault.com admin comp tool).
export const compAddressInternal = internalAction({
  args: {
    address: v.string(),
    conditionTier: v.optional(v.string()),
    folio: v.optional(v.string()),
    includeSupportIds: v.optional(v.array(v.string())),
    excludeSaleIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<any> => {
    const res = await resolveCounty(args.address, args.folio);
    if (!res.ok) return res;
    const sales = await ctx.runQuery(internal.engine._loadSalesInternal, {});
    const valuation = valueProperty(res.county, sales, args.conditionTier, {
      includeSupportIds: args.includeSupportIds,
      excludeSaleIds: args.excludeSaleIds,
    });
    const previousRuns = await ctx.runQuery(internal.engine._recentCompRunsByFolio, {
      folio: res.county.folio,
      limit: 8,
    });
    const createdAt = Date.now();
    const runId = await ctx.runMutation(internal.engine._recordCompRun, {
      kind: "admin",
      address: args.address,
      folio: res.county.folio,
      county: res.county,
      valuation,
      createdBy: "api",
      createdAt,
    });
    return {
      ok: true,
      county: res.county,
      valuation,
      runId,
      compHistory: buildCompHistory(
        { _id: runId, address: args.address, folio: res.county.folio, valuation, createdAt },
        previousRuns,
      ),
    };
  },
});

export const saveProperty = authenticatedMutation({
  args: {
    address: v.string(),
    folio: v.string(),
    county: v.any(),
    conditionTier: v.string(),
    valuation: v.any(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_folio", (q) => q.eq("folio", args.folio))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        county: args.county,
        conditionTier: args.conditionTier,
        valuation: args.valuation,
        notes: args.notes ?? existing.notes,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert("properties", {
      ...args,
      createdBy: ctx.userId,
      createdAt: Date.now(),
    });
  },
});

export const listProperties = authenticatedQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("properties").withIndex("by_creator", (q) => q.eq("createdBy", ctx.userId)).collect())
      .sort((a, b) => b.createdAt - a.createdAt),
});

export const createReport = authenticatedMutation({
  args: { address: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const id = await ctx.db.insert("reports", {
      token,
      address: args.address,
      payload: args.payload,
      createdBy: ctx.userId,
      createdAt: Date.now(),
    });
    return { id, token };
  },
});

export const listLeads = authenticatedQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("leads").collect()).sort((a, b) => b.createdAt - a.createdAt),
});

export const markLeadSynced = authenticatedMutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { fubSynced: true });
  },
});

export const seedSales = authenticatedMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("sales").collect();
    const have = new Set(existing.map((r) => r.saleId));
    let inserted = 0;
    for (const s of SEED_SALES) {
      if (have.has(s.saleId)) continue;
      await ctx.db.insert("sales", s);
      inserted++;
    }
    return { inserted, total: have.size + inserted };
  },
});

export const _importSales = internalMutation({
  args: {
    sales: v.array(
      v.object({
        saleId: v.string(),
        address: v.string(),
        market: v.string(),
        zip: v.string(),
        soldDate: v.string(),
        price: v.number(),
        beds: v.optional(v.union(v.number(), v.null())),
        baths: v.optional(v.union(v.number(), v.null())),
        livingSF: v.number(),
        lotSF: v.optional(v.union(v.number(), v.null())),
        yearBuilt: v.optional(v.union(v.number(), v.null())),
        waterfront: v.boolean(),
        waterType: v.string(),
        conditionClass: v.string(),
        verified: v.boolean(),
        source: v.string(),
        propertyClass: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sales").collect();
    const have = new Set(existing.map((r) => r.saleId));
    let inserted = 0;
    for (const s of args.sales) {
      if (have.has(s.saleId)) continue;
      await ctx.db.insert("sales", s);
      have.add(s.saleId);
      inserted++;
    }
    return { inserted, total: have.size };
  },
});

export const _updateSale = internalMutation({
  args: {
    saleId: v.string(),
    waterType: v.optional(v.string()),
    waterfront: v.optional(v.boolean()),
    conditionClass: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    propertyClass: v.optional(v.string()),
    yearBuilt: v.optional(v.union(v.number(), v.null())),
    lotSF: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sales")
      .withIndex("by_saleId", (q) => q.eq("saleId", args.saleId))
      .first();
    if (!row) return { updated: false };
    const patch: Record<string, unknown> = {};
    if (args.waterType !== undefined) patch.waterType = args.waterType;
    if (args.waterfront !== undefined) patch.waterfront = args.waterfront;
    if (args.conditionClass !== undefined) patch.conditionClass = args.conditionClass;
    if (args.verified !== undefined) patch.verified = args.verified;
    if (args.propertyClass !== undefined) patch.propertyClass = args.propertyClass;
    if (args.yearBuilt !== undefined) patch.yearBuilt = args.yearBuilt;
    if (args.lotSF !== undefined) patch.lotSF = args.lotSF;
    await ctx.db.patch(row._id, patch);
    return { updated: true };
  },
});

export const _deleteSale = internalMutation({
  args: { saleId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sales")
      .withIndex("by_saleId", (q) => q.eq("saleId", args.saleId))
      .first();
    if (!row) return { deleted: false };
    await ctx.db.delete(row._id);
    return { deleted: true };
  },
});

export const salesCount = authenticatedQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("sales").collect()).length,
});

// Backfill yearBuilt (and missing lotSF) on sale rows from the county PA
// record. Batched — call repeatedly with increasing offset until done.
export const backfillSalesYearBuilt = internalAction({
  args: { offset: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<any> => {
    const offset = args.offset ?? 0;
    const limit = Math.min(args.limit ?? 15, 25);
    const all: any[] = await ctx.runQuery(internal.engine._loadSalesInternal, {});
    const batch = all
      .filter((r: any) => r.yearBuilt == null || r.lotSF == null)
      .slice(offset, offset + limit);
    const results: { address: string; ok: boolean; detail: string }[] = [];
    for (const row of batch) {
      const clean = String(row.address)
        .replace(/,.*$/, "")
        .replace(/\s+(PH\s*-.*|#.*|UNIT\s.*)$/i, "")
        .trim();
      const ZIP_CITIES: Record<string, string[]> = {
        "33139": ["Miami Beach"],
        "33140": ["Miami Beach"],
        "33141": ["Miami Beach"],
        "33154": ["Bay Harbor Islands", "Surfside", "Bal Harbour"],
        "33181": ["North Miami"],
      };
      const zip = String(row.zip ?? "");
      const attempts = [clean, ...(ZIP_CITIES[zip] ?? []).map((c) => `${clean}, ${c}, FL ${zip}`)];
      try {
        let res: any = null;
        for (const attempt of attempts) {
          res = await fetchCountyByAddress(attempt);
          if (res.ok) break;
        }
        if (!res?.ok) {
          results.push({ address: row.address, ok: false, detail: res?.error ?? "no county match" });
          continue;
        }
        await ctx.runMutation(internal.engine._updateSale, {
          saleId: row.saleId,
          yearBuilt: res.county.yearBuilt,
          lotSF: row.lotSF == null ? res.county.lotSF : undefined,
        });
        results.push({
          address: row.address,
          ok: true,
          detail: `yearBuilt=${res.county.yearBuilt ?? "?"} lotSF=${res.county.lotSF ?? "?"}`,
        });
      } catch (e: any) {
        results.push({ address: row.address, ok: false, detail: String(e?.message ?? e) });
      }
    }
    return {
      processed: batch.length,
      offset,
      nextOffset: offset + limit,
      remaining: all.filter((r: any) => r.yearBuilt == null || r.lotSF == null).length - batch.length,
      results,
    };
  },
});

// ---------- Consumer (deliberately public) ----------

export const getHomeValue = action({
  args: {
    address: v.string(),
    conditionTier: v.string(),
    timeline: v.string(),
    reason: v.string(),
    intent: v.string(),
    folio: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const res = await resolveCounty(args.address, args.folio);
    if (!res.ok) return res;
    const sales = await ctx.runQuery(internal.engine._loadSalesInternal, {});
    const valuation = valueProperty(res.county, sales, args.conditionTier);
    if (!isValuation(valuation)) return { ok: false, error: valuation.error };
    const readout = consumerReadout(valuation);
    await ctx.runMutation(internal.engine._recordCompRun, {
      kind: "consumer",
      address: args.address,
      folio: res.county.folio,
      county: undefined,
      valuation: undefined,
    });
    // Public response: county basics + readout. No offer ladder, no comps internals.
    return {
      ok: true,
      county: {
        address: res.county.address,
        beds: res.county.beds,
        baths: res.county.baths,
        livingSF: res.county.livingSF,
        lotSF: res.county.lotSF,
        yearBuilt: res.county.yearBuilt,
        waterfront: res.county.hasDock || valuation.waterfront,
      },
      readout,
      folio: res.county.folio,
    };
  },
});


// ---------- Progressive search capture (public) ----------

// Fires the moment a visitor continues past the address step — we never wait
// for a full lead submit. Best-effort county enrichment gives us the owner
// name even when the visitor never identifies themselves.
export const trackSearch = action({
  args: {
    address: v.string(),
    role: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    let folio: string | undefined;
    let owner: string | undefined;
    let countyFound = false;
    try {
      const res = await fetchCountyByAddress(args.address);
      if (res.ok) {
        countyFound = true;
        folio = res.county.folio;
        owner = res.county.owner;
      }
    } catch {
      // still record the raw search
    }
    const id = await ctx.runMutation(internal.engine._insertSearch, {
      address: args.address,
      role: args.role,
      sessionId: args.sessionId,
      source: args.source,
      folio,
      owner,
      countyFound,
    });
    return { ok: true, id, countyFound, owner };
  },
});

export const _insertSearch = internalMutation({
  args: {
    address: v.string(),
    role: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    source: v.optional(v.string()),
    folio: v.optional(v.string()),
    owner: v.optional(v.string()),
    countyFound: v.boolean(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("searches", { ...args, createdAt: Date.now() });
  },
});

export const listSearches = authenticatedQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("searches")
      .withIndex("by_created")
      .order("desc")
      .take(200);
    return rows.map((r: Doc<"searches">) => ({
      address: r.address,
      role: r.role ?? null,
      folio: r.folio ?? null,
      owner: r.owner ?? null,
      countyFound: r.countyFound,
      createdAt: r.createdAt,
    }));
  },
});

export const saveLead = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    folio: v.optional(v.string()),
    answers: v.any(),
    readout: v.any(),
    intent: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("leads", { ...args, fubSynced: false, createdAt: Date.now() });
  },
});

// Lead submit with email confirmations (consumer + team). Emails are
// best-effort — a mail failure never blocks the lead from saving.
export const submitLead = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    folio: v.optional(v.string()),
    answers: v.any(),
    readout: v.any(),
    intent: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const id = await ctx.runMutation(api.engine.saveLead, args);
    const consumer = leadConsumerEmail({
      name: args.name,
      address: args.address,
      readout: args.readout,
    });
    const team = leadTeamEmail({
      name: args.name,
      email: args.email,
      phone: args.phone,
      address: args.address,
      intent: args.intent,
      readout: args.readout,
      sessionId: args.sessionId,
    });
    const results = await Promise.allSettled([
      ctx.runAction(internal.emails.sendTransactionalEmail, { to: args.email, ...consumer }),
      ctx.runAction(internal.emails.sendTransactionalEmail, { to: TEAM_EMAIL, ...team }),
    ]);
    const emails = results.map((r) =>
      r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason) },
    );
    return { ok: true, id, emails };
  },
});

// ---------- Funnel event tracking (public, lightweight) ----------

export const trackEvent = action({
  args: {
    event: v.string(),
    sessionId: v.optional(v.string()),
    address: v.optional(v.string()),
    source: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<any> => {
    const id = await ctx.runMutation(internal.engine._insertEvent, args);
    return { ok: true, id };
  },
});

export const _insertEvent = internalMutation({
  args: {
    event: v.string(),
    sessionId: v.optional(v.string()),
    address: v.optional(v.string()),
    source: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("events", { ...args, createdAt: Date.now() });
  },
});

export const listEvents = authenticatedQuery({
  args: { limit: v.optional(v.number()), event: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.event) {
      return ctx.db
        .query("events")
        .withIndex("by_event", (q) => q.eq("event", args.event!))
        .order("desc")
        .take(args.limit ?? 200);
    }
    return ctx.db.query("events").withIndex("by_created").order("desc").take(args.limit ?? 200);
  },
});


// ---------- Instant offer / signed LOI funnel ----------

const offerArgs = {
  address: v.string(),
  name: v.string(),
  email: v.string(),
  phone: v.string(),
  price: v.number(),
  deposit: v.number(),
  inspectionDays: v.number(),
  dueDiligenceDays: v.number(),
  closingDays: v.number(),
  contingencies: v.array(v.string()),
  otherContingency: v.optional(v.string()),
  signatureName: v.string(),
  readout: v.optional(v.any()),
  sessionId: v.optional(v.string()),
  source: v.optional(v.string()),
};

export const createOffer = action({
  args: offerArgs,
  handler: async (ctx, args): Promise<any> => {
    // Best-effort county enrichment (owner + folio for the LOI).
    let folio: string | undefined;
    let countyOwner: string | undefined;
    try {
      const res = await fetchCountyByAddress(args.address);
      if (res.ok) {
        folio = res.county.folio;
        countyOwner = res.county.owner;
      }
    } catch {
      /* enrichment is best-effort */
    }
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const id = await ctx.runMutation(internal.engine._insertOffer, {
      ...args,
      token,
      folio,
      countyOwner,
    });
    await ctx.runMutation(internal.engine._insertEvent, {
      event: "loi_signed",
      sessionId: args.sessionId,
      address: args.address,
      source: args.source,
      meta: { price: args.price, closingDays: args.closingDays },
    });
    // Email confirmations (best-effort): consumer copy + team alert.
    const appUrl = process.env.VALUE_ENGINE_APP_URL ?? "";
    const offerUrl = appUrl ? `${appUrl}/offer/${token}` : `(token ${token})`;
    const consumer = offerConsumerEmail({
      name: args.name,
      address: args.address,
      price: args.price,
      deposit: args.deposit,
      closingDays: args.closingDays,
      offerUrl,
    });
    const team = offerTeamEmail({
      name: args.name,
      email: args.email,
      phone: args.phone,
      address: args.address,
      price: args.price,
      deposit: args.deposit,
      inspectionDays: args.inspectionDays,
      dueDiligenceDays: args.dueDiligenceDays,
      closingDays: args.closingDays,
      contingencies: args.contingencies,
      countyOwner,
    });
    const results = await Promise.allSettled([
      ctx.runAction(internal.emails.sendTransactionalEmail, { to: args.email, ...consumer }),
      ctx.runAction(internal.emails.sendTransactionalEmail, { to: TEAM_EMAIL, ...team }),
    ]);
    const emails = results.map((r) =>
      r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason) },
    );
    return { ok: true, id, token, emails };
  },
});

export const _insertOffer = internalMutation({
  args: {
    ...offerArgs,
    token: v.string(),
    folio: v.optional(v.string()),
    countyOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("offers", {
      ...args,
      status: "signed_loi",
      notified: false,
      signedAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const getOfferByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const o = await ctx.db
      .query("offers")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!o) return null;
    return o;
  },
});

export const listOffers = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const all = await ctx.db
      .query("offers")
      .withIndex("by_created")
      .collect();
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  },
});

// Signed-offer alert bridge (polled by Viktor cron, secret-gated like lead sync).
export const unsyncedOffers = query({
  args: {},
  handler: async (ctx) =>
    ctx.db.query("offers").withIndex("by_notified", (q) => q.eq("notified", false)).collect(),
});

export const markOfferNotifiedPublic = mutation({
  args: { id: v.id("offers"), secret: v.string() },
  handler: async (ctx, args) => {
    if (args.secret !== (process.env.LEAD_SYNC_SECRET ?? "")) {
      throw new Error("unauthorized");
    }
    await ctx.db.patch(args.id, { notified: true });
  },
});

// ---------- Public report view ----------

export const getReportByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await ctx.db
      .query("reports")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!r) return null;
    return { address: r.address, payload: r.payload, createdAt: r.createdAt };
  },
});

// ---------- Internal helpers ----------

export const _loadSalesInternal = internalQuery({
  args: {},
  handler: async (ctx) => loadSales(ctx),
});

export const _recordCompRun = internalMutation({
  args: {
    kind: v.string(),
    address: v.string(),
    folio: v.optional(v.string()),
    county: v.optional(v.any()),
    valuation: v.optional(v.any()),
    createdBy: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("compRuns", { ...args, createdAt: args.createdAt ?? Date.now() });
  },
});

export const _recentCompRunsByFolio = internalQuery({
  args: { folio: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return ctx.db
      .query("compRuns")
      .withIndex("by_folio_created", (q) => q.eq("folio", args.folio))
      .order("desc")
      .take(args.limit ?? 8);
  },
});

// Lead sync support: unsynced leads for the FUB bridge (queried via query_app_database).
export const unsyncedLeads = query({
  args: {},
  handler: async (ctx) =>
    ctx.db.query("leads").withIndex("by_fubSynced", (q) => q.eq("fubSynced", false)).collect(),
});

export const markLeadSyncedPublic = mutation({
  args: { id: v.id("leads"), secret: v.string() },
  handler: async (ctx, args) => {
    if (args.secret !== (process.env.LEAD_SYNC_SECRET ?? "")) {
      throw new Error("unauthorized");
    }
    await ctx.db.patch(args.id, { fubSynced: true });
  },
});
