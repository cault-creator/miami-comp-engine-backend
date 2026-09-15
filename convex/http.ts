declare const process: { env: Record<string, string | undefined> };
// HTTP API so calebault.com (Lovable repo, separate codebase) can call the
// value engine cross-origin. Public funnel endpoints are open (same data the
// public Space page shows); the admin comp endpoint is gated on ENGINE_API_KEY.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-engine-key",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

for (const path of ["/api/value", "/api/lead", "/api/track", "/api/offer", "/api/offer-notified", "/api/comp", "/api/report"]) {
  http.route({ path, method: "OPTIONS", handler: preflight });
}

// Public: home-value readout (county basics + consumer numbers).
http.route({
  path: "/api/value",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    if (!body.address || typeof body.address !== "string") {
      return json({ ok: false, error: "address required" }, 400);
    }
    const result = await ctx.runAction(api.engine.getHomeValue, {
      address: body.address,
      conditionTier: String(body.conditionTier ?? "remodel"),
      timeline: String(body.timeline ?? ""),
      reason: String(body.reason ?? ""),
      intent: String(body.intent ?? "both"),
      folio: typeof body.folio === "string" ? body.folio : undefined,
    });
    return json(result);
  }),
});



// Public: signed instant-offer LOI from the "Get my written offer" funnel.
http.route({
  path: "/api/offer",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    const required = ["address", "name", "email", "phone", "signatureName"];
    for (const f of required) {
      if (!body[f] || typeof body[f] !== "string") {
        return json({ ok: false, error: `${f} required` }, 400);
      }
    }
    const nums = ["price", "deposit", "inspectionDays", "dueDiligenceDays", "closingDays"];
    for (const f of nums) {
      if (typeof body[f] !== "number" || !(body[f] > 0)) {
        return json({ ok: false, error: `${f} must be a positive number` }, 400);
      }
    }
    const result = await ctx.runAction(api.engine.createOffer, {
      address: body.address,
      name: body.name,
      email: body.email,
      phone: body.phone,
      price: body.price,
      deposit: body.deposit,
      inspectionDays: body.inspectionDays,
      dueDiligenceDays: body.dueDiligenceDays,
      closingDays: body.closingDays,
      contingencies: Array.isArray(body.contingencies) ? body.contingencies.map(String) : [],
      otherContingency: body.otherContingency ? String(body.otherContingency) : undefined,
      signatureName: body.signatureName,
      readout: body.readout ?? undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      source: body.source ? String(body.source) : undefined,
    });
    return json(result);
  }),
});


// Secret-gated: mark a signed offer as team-notified (used by the alert cron).
http.route({
  path: "/api/offer-notified",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    if (!body.id || !body.secret) {
      return json({ ok: false, error: "id and secret required" }, 400);
    }
    try {
      await ctx.runMutation(api.engine.markOfferNotifiedPublic, {
        id: body.id,
        secret: String(body.secret),
      });
      return json({ ok: true });
    } catch {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
  }),
});

// Public: progressive search capture — fires when a visitor types an address,
// before (and regardless of) any lead submit.
http.route({
  path: "/api/track",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    // Funnel analytics events (no address needed).
    if (body.event && typeof body.event === "string") {
      const result = await ctx.runAction(api.engine.trackEvent, {
        event: body.event,
        sessionId: body.sessionId ? String(body.sessionId) : undefined,
        address: body.address ? String(body.address) : undefined,
        source: body.source ? String(body.source) : undefined,
        meta: body.meta ?? undefined,
      });
      return json(result);
    }
    if (!body.address || typeof body.address !== "string") {
      return json({ ok: false, error: "address required" }, 400);
    }
    const result = await ctx.runAction(api.engine.trackSearch, {
      address: body.address,
      role: body.role ? String(body.role) : undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      source: body.source ? String(body.source) : undefined,
    });
    return json(result);
  }),
});

// Public: lead capture from the calebault.com funnel.
http.route({
  path: "/api/lead",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    if (!body.name || !body.email || !body.phone) {
      return json({ ok: false, error: "name, email and phone are required" }, 400);
    }
    const result = await ctx.runAction(api.engine.submitLead, {
      name: String(body.name),
      email: String(body.email),
      phone: String(body.phone),
      address: String(body.address ?? ""),
      folio: body.folio ? String(body.folio) : undefined,
      answers: body.answers ?? {},
      readout: body.readout ?? {},
      intent: String(body.intent ?? "both"),
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
    });
    return json(result);
  }),
});

// Admin (secret-key): full comp — county record + valuation + offer ladder.
http.route({
  path: "/api/comp",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.ENGINE_API_KEY ?? "";
    if (!expected || req.headers.get("x-engine-key") !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    if (!body.address) return json({ ok: false, error: "address required" }, 400);
    const result = await ctx.runAction(internal.engine.compAddressInternal, {
      address: String(body.address),
      conditionTier: body.conditionTier ? String(body.conditionTier) : undefined,
      folio: typeof body.folio === "string" ? body.folio : undefined,
      includeSupportIds: Array.isArray(body.includeSupportIds)
        ? body.includeSupportIds.map(String)
        : undefined,
      excludeSaleIds: Array.isArray(body.excludeSaleIds)
        ? body.excludeSaleIds.map(String)
        : undefined,
    });
    return json(result);
  }),
});

// Public: fetch a saved report by token (for shareable report pages).
http.route({
  path: "/api/report",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    if (!token) return json({ ok: false, error: "token required" }, 400);
    const report = await ctx.runQuery(api.engine.getReportByToken, { token });
    if (!report) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, report });
  }),
});

// Key-gated: bulk-import sale rows (backfills, sales monitor).
http.route({
  path: "/api/import-sales",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.ENGINE_API_KEY ?? "";
    if (!expected || req.headers.get("x-engine-key") !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }
    if (!Array.isArray(body.sales) || body.sales.length === 0) {
      return json({ ok: false, error: "sales array required" }, 400);
    }
    if (body.sales.length > 500) {
      return json({ ok: false, error: "max 500 sales per call" }, 400);
    }
    const result = await ctx.runMutation(internal.engine._importSales, {
      sales: body.sales,
    });
    return json({ ok: true, ...result });
  }),
});

// Key-gated: patch a sale row (water type, condition, verified).
http.route({
  path: "/api/update-sale",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.ENGINE_API_KEY ?? "";
    if (!expected || req.headers.get("x-engine-key") !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const body: any = await req.json().catch(() => null);
    if (!body?.saleId) return json({ ok: false, error: "saleId required" }, 400);
    const result = await ctx.runMutation(internal.engine._updateSale, {
      saleId: String(body.saleId),
      waterType: body.waterType ? String(body.waterType) : undefined,
      conditionClass: body.conditionClass ? String(body.conditionClass) : undefined,
      verified: typeof body.verified === "boolean" ? body.verified : undefined,
      propertyClass: body.propertyClass ? String(body.propertyClass) : undefined,
    });
    return json({ ok: true, ...result });
  }),
});

export default http;
