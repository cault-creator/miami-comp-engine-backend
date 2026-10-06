# Seller, buyer, and investor analysis

`POST /api/analyze`, protected by `x-engine-key`, accepts `{ address, folio?, conditionTier?, input }`.
The full input contract is in `convex/analysisCore.ts` and is enforced by the nested Convex validator in `convex/analysisValidators.ts`. Missing optional inputs return manual review, not invented defaults. Source evidence is supplied by an authorized reviewer; this endpoint does not scrape MLS, verify that a URL supports a claim, or independently authenticate submitted evidence.

## Three decisions

- **Seller:** as-is retail estimate and range, explicitly provisional when unsupported. Net proceeds require actual dollar amounts for negotiated commission, closing costs, concessions, and loan payoff. No automatic commission assumption.
- **Buyer:** supported value and asking-price premium only after the evidence gate passes; selected comps, rejected comps, eligibility warnings, reasoning, and original comp summary remain visible.
- **Investor:** independently approved ARV minus repairs, acquisition costs, resale costs, carry, finance, contingency, and investor profit yields the investor purchase ceiling. ARV is the improved resale value; the investor exit used for wholesale math is the end buyer's purchase ceiling.

Every cost line is required; a reviewed zero is valid but an omitted cost is not. Budget and listing folios must match the county parcel. Default wholesale target margin is 15%, adjustable from 6% to under 100%. All offer ceilings round **down** to $5,000. Opening starts 5% below that ceiling by default, also adjustable. These are reviewable negotiation settings, not estimates of seller acceptance.

`Wholesale margin = (Investor Exit - Contract Price) / Investor Exit`.

The 15%, 10%, and 6% thresholds are `exit × .85`, `exit × .90`, and `exit × .94`, rounded down. Spread is gross before the wholesaler's own costs. Classification uses the actual proposed contract price when supplied; otherwise the verified current asking price is used strictly for screening. A 6% broker threshold is a screening category, not a commission recommendation or an authorization to list.

## Evidence gate

Residential whole ownership, legal living area, condition, precise micro-market, waterfront/water tier, and condo unit identity need a folio-linked subject check within 90 days. For every selected comp, a reviewer must supply a public record or MLS source URL, check date, arm's-length confirmation, precise neighborhood match, comparable condition, and asset class. At least three selected comps must qualify; any unsupported selected pricing comp blocks approval rather than silently retaining its price in the valuation. Qualified sales must be dated within 365 days, have living area within 35%, and match waterfront and water tier. Unknown water type is not an accepted match.

Ranges wider than 25%, static-band fallback, uncalibrated adjacent-market bands, and land-floor overrides require review. V2 confidence is capped at B even when supported. Original engine confidence is not approval. Current price/status checks expire after seven days; ARV/budgets after 30 days. Future evidence dates and nonfinite/negative money inputs are rejected by the decision layer.

Agent full professional name, public phone, public email, and a contact source are required for `offerReviewReady`. Do not guess an email or expand a professional name without evidence. Completeness is not independent verification; the source must be checked by the reviewer.

## Listing signals and history

Active DOM and cumulative DOM remain separate. More than 90 days is a conversation signal, not proof of distress or overpricing. Missing DOM is unknown. Original-to-current dollar change is not presented as a count of price cuts. Reductions are reconstructed only from valid dated asking-price events. Relistings can reset active DOM. Fresh non-active listings never produce an investor offer recommendation.

The snapshot, evidence, version, budget, and full analysis are stored in the existing `compRuns.valuation.analysis` payload. No database migration is needed. The response includes `runId` and `compHistory` as before. V2 sets legacy `valuation.offers` to null; use `analysis.investor` instead. This endpoint never sends messages, creates signed documents, or places an offer.

## Compatibility and rollout

V1 `/api/comp` and `/api/value` retain their existing shapes and heuristic retail-percentage offer numbers for compatibility. **They are not investor underwriting and have not been migrated to V2 in this PR.** Existing public instant-offer UI must be migrated and tested before treating this change as a complete production replacement. Do not advertise verified investor offers from V1. Core fixes shared by V1 and V2 now exclude missing/invalid/future sale dates, cap zero-verified-comp confidence at C, describe dry support correctly, and remove automatic teardown classification based on two bedrooms.

Next website integration: call V2 through a server-side authenticated bridge, attach the immutable analysis run to a saved offer, show seller/buyer/investor panels, display blockers, and require explicit agent selection plus complete public contact evidence before transmission. Keep the engine key on the server. An explicit human send action should remain separate from calculation.

## Verification

- `npm run test:engine`: 29 tests, including missing evidence/costs, exact margin boundaries, loss, asset identity, stale listings, condition, water/size mismatch, invalid dates, reductions, and DOM reset semantics.
- `npm run typecheck:engine`: pure modules, tests, and the actual Convex validator typecheck.
- Replayed ten saved prospect runs (2026-10-06); all ten correctly remain manual review with null recommended offers because no independent evidence/budget was supplied and legacy verified count was zero.
- Full deployed Convex HTTP integration requires regenerated `_generated` bindings and staging credentials. Not deployed or integration-tested here. The repository's pre-existing package/lock mismatch prevents `npm ci`; isolated pinned TypeScript/Convex dependencies were used for the scoped typecheck. No dependency versions were changed.

## Offer builder source review

Reviewed the owned `cault-creator/caleb-hub-flow` source at main `060a36b7fe9ede2288077174c4038e855ab24945`.

`OfferBuilder.tsx` saves offer fields and links existing records but does not consume a comp run or explain an underwriting-derived purchase price. `CompEngine.tsx` calls the legacy comp endpoint and shows its percentage-based ladder; its header advertises verified recent sales even when the response contains no verified comps. Both should consume V2 status and blockers before presenting a supported valuation or maximum offer.

`SendOfferDialog.tsx` reads listing-agent contacts, supports name/email/phone, validates recipient email and document attachments, invokes `send-offer-email`, then logs the transmission and marks the offer presented. When the listing agent has no valid email, its default recipient selection falls back to all valid contacts, including the seller. Change this to explicit selection or a missing-agent-contact prompt for on-market deals. Add contact-source freshness and the valuation run to the review screen. Check server-side delivery/idempotency separately before treating client-side success as delivery confirmation.

Live `/admin/offers/new` redirected to sign-in, and the sign-in attempt did not establish an authenticated session. Source review completed; live form and delivery behavior were not tested. No offers or emails were sent.
