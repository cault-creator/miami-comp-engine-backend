import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  sales: defineTable({
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
    waterfront: v.boolean(),
    waterType: v.string(),
    conditionClass: v.string(),
    verified: v.boolean(),
    source: v.string(),
    propertyClass: v.optional(v.string()),
  })
    .index("by_saleId", ["saleId"])
    .index("by_zip", ["zip"]),

  properties: defineTable({
    address: v.string(),
    folio: v.string(),
    county: v.any(),
    conditionTier: v.string(),
    valuation: v.any(),
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_creator", ["createdBy"])
    .index("by_folio", ["folio"]),

  compRuns: defineTable({
    kind: v.string(), // "admin" | "consumer"
    address: v.string(),
    folio: v.optional(v.string()),
    county: v.optional(v.any()),
    valuation: v.optional(v.any()),
    error: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  leads: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    folio: v.optional(v.string()),
    answers: v.any(),
    readout: v.any(),
    intent: v.string(), // "cash" | "listing" | "both" | "curious"
    sessionId: v.optional(v.string()),
    fubSynced: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_fubSynced", ["fubSynced"]),

  // Progressive capture: every address typed into the funnel, saved on
  // step-continue (not just on lead submit), enriched with county owner.
  searches: defineTable({
    address: v.string(),
    role: v.optional(v.string()), // "owner" | "realtor" | "buyer" | "other"
    sessionId: v.optional(v.string()),
    source: v.optional(v.string()),
    folio: v.optional(v.string()),
    owner: v.optional(v.string()),
    countyFound: v.boolean(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // Funnel analytics events from calebault.com (intent clicks, branch picks,
  // valuation views, offer starts, LOI signatures).
  events: defineTable({
    event: v.string(),
    sessionId: v.optional(v.string()),
    address: v.optional(v.string()),
    source: v.optional(v.string()),
    meta: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_event", ["event", "createdAt"]),

  // Signed instant-offer LOIs from the "Get my written offer" funnel.
  offers: defineTable({
    token: v.string(), // public LOI view link
    address: v.string(),
    folio: v.optional(v.string()),
    countyOwner: v.optional(v.string()),
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
    signedAt: v.number(),
    readout: v.optional(v.any()),
    sessionId: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.string(), // "signed_loi" | "reviewing" | "contract_sent" | "dead"
    notified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_created", ["createdAt"])
    .index("by_notified", ["notified"]),

  reports: defineTable({
    token: v.string(),
    address: v.string(),
    payload: v.any(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),
});

export default schema;
