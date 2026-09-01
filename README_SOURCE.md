# Miami Comp Engine — Convex backend source

Source of the backend deployed at https://judicious-cassowary-306.convex.site
(Viktor Space `miami-value-engine`, dev deployment `dev:judicious-cassowary-306`).

- convex/http.ts — HTTP routes: /api/value, /api/comp, /api/import-sales, /api/lead, /api/offer, /api/offer-notified, /api/track, /api/report
- convex/engine.ts + engineCore.ts — valuation/comp-matching engine
- convex/schema.ts — tables (sales, leads, offers, properties...)
- convex/functions.ts — queries/mutations
- convex/county.ts — Miami-Dade county PA data pulls

Note: `convex.json` is not used in this project; `convex/_generated/` is auto-created
by `npx convex dev`/`deploy` and is not committed. Env vars (ENGINE_API_KEY,
LEAD_SYNC_SECRET, etc.) live in the Convex dashboard / space env, not in this repo.
