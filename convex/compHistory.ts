import type { Valuation } from "./engineCore";

interface CompRun {
  _id?: unknown;
  address: string;
  folio?: string;
  valuation?: unknown;
  createdAt: number;
}

function moneyValue(v: unknown): number | null {
  const maybe = v as { mostLikely?: unknown } | null;
  return typeof maybe?.mostLikely === "number" ? maybe.mostLikely : null;
}

function summarizeCompRun(run: CompRun) {
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

export function buildCompHistory(current: CompRun, previousRuns: CompRun[]) {
  const currentSummary = summarizeCompRun(current);
  const previous = previousRuns.filter((r) => moneyValue(r.valuation) !== null).map(summarizeCompRun);
  const prior = previous[0] ?? null;
  // Optional chaining returns undefined when there is no prior run. A strict
  // !== null check alone would pass, then dereference prior on the first comp.
  const amount =
    currentSummary.mostLikely != null && prior?.mostLikely != null
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
