import { v } from "convex/values";

const evidence = { sourceUrl: v.string(), checkedAt: v.string() };
const propertyClass = v.union(v.literal("sfr"), v.literal("condo"));
export const analysisInputValidator = v.object({
  subject: v.optional(v.object({ ...evidence, folio: v.string(), wholeOwnership: v.boolean(),
    assetType: v.union(propertyClass, v.literal("land"), v.literal("dock"), v.literal("fractional"), v.literal("unknown")),
    livingSF: v.number(), condition: v.string(), waterfront: v.boolean(),
    waterType: v.union(v.literal("dry"), v.literal("canal"), v.literal("open_bay")),
    microMarket: v.string(), unit: v.optional(v.string()) })),
  compEvidence: v.optional(v.array(v.object({ ...evidence, saleId: v.string(), armsLength: v.boolean(),
    sameMicroMarket: v.boolean(), conditionComparable: v.boolean(), propertyClass }))),
  listing: v.optional(v.object({ ...evidence, folio: v.string(), mlsId: v.string(),
    status: v.union(v.literal("active"), v.literal("pending"), v.literal("sold"), v.literal("withdrawn"), v.literal("unknown")),
    currentListPrice: v.number(), originalListPrice: v.optional(v.number()), activeDOM: v.optional(v.number()), cumulativeDOM: v.optional(v.number()),
    priceEvents: v.optional(v.array(v.object({ date: v.string(), price: v.number(), sourceUrl: v.string() }))),
    agent: v.optional(v.object({ fullName: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()),
      brokerage: v.optional(v.string()), sourceUrl: v.string() })) })),
  investor: v.optional(v.object({ ...evidence, folio: v.string(), approvedARV: v.number(), repairs: v.number(),
    acquisitionCosts: v.number(), resaleCosts: v.number(), carryingCosts: v.number(), financingCosts: v.number(),
    contingency: v.number(), investorProfit: v.number(), targetWholesaleMargin: v.optional(v.number()), openingDiscount: v.optional(v.number()) })),
  contractPrice: v.optional(v.number()),
  sellerCosts: v.optional(v.object({ folio: v.string(), commission: v.number(), closingCosts: v.number(), concessions: v.number(), loanPayoff: v.number() })),
});
