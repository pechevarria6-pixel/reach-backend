// ─── What one model call cost ────────────────────────────────────────────
// Contribution margin per trip is take earned minus payment fees minus AI
// cost minus concierge minutes (business model §3, §4G M4). The first two
// live on rows; this is the third, and until now it lived only on an
// invoice nobody could split by trip.
//
// Every call through /api/trips/generate is logged as an `ai_generation`
// event: which model, which stage, the token counts the API reported, and
// the cost at published prices. Computed here rather than in SQL so a price
// change is one edit beside its source, and so the event says what the call
// cost on the day it ran rather than what today's price table says.
//
// The prices are an estimate in the same way a hotel price is: published
// list rates, first-party API, standard (not batch, not fast) service. They
// are not the bill. An unknown model is recorded with `priced: false` and no
// cost rather than a guessed one — a margin that silently assumes a price is
// a margin nobody can trust.
import type { SupabaseClient } from '@supabase/supabase-js';
import { track } from '../track.ts';

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Writing a prompt-cache entry (5-minute TTL): 1.25x input. */
  cacheWrite: number;
  /** Reading one back: 0.1x input. */
  cacheRead: number;
}

/**
 * Published per-million-token list prices, first-party Claude API.
 * Source: the Claude API reference's current-models table, cached
 * 2026-10-06, read 2026-11-08. Check it again before trusting a margin built
 * on these; they are constants precisely so the check is one place.
 *
 * Output includes any thinking tokens, which the API bills as output.
 */
export const PRICES_CHECKED = '2026-11-08';
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // The options stage (FAST_MODEL in app/api/trips/generate/route.ts).
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  // The itinerary and single-slot stages, and the knowledge cron.
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  // Listed so a model change is priced on the day it lands, not discovered
  // as `priced: false` a month later.
  'claude-sonnet-5-5': { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-5-5': { input: 4.0, output: 20.0, cacheWrite: 5.0, cacheRead: 0.2 },
  // Prompts up to 100K tokens; ours are a fraction of that. Beyond it the
  // rate is $0.50 / $2.50, which this table does not model.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/** A dated snapshot id ("claude-haiku-4-5-20251001") prices as its alias. */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const id = String(model).trim();
  return MODEL_PRICES[id] ?? MODEL_PRICES[id.replace(/-\d{8}$/, '')] ?? null;
}

/** The usage block on a Messages API response; every field may be absent. */
export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Dollars, to the millionth. Null when the model is not in the table. */
export function costUsd(model: string, usage: Usage | null | undefined): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const u = usage ?? {};
  const dollars = (n(u.input_tokens) * p.input
    + n(u.output_tokens) * p.output
    + n(u.cache_creation_input_tokens) * p.cacheWrite
    + n(u.cache_read_input_tokens) * p.cacheRead) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

/** Which part of planning a call served, from the label the route gives it. */
export type Stage = 'options' | 'itinerary' | 'slot' | 'other';
export function stageOf(label: string): Stage {
  if (/slot/.test(label)) return 'slot';
  if (/itinerary/.test(label)) return 'itinerary';
  if (/generate/.test(label)) return 'options';
  return 'other';
}

/**
 * The event's props. Short scalars only, so every one survives scrubProps:
 * the model id is a category, the counts are numbers, and nothing from the
 * prompt or the answer is ever here.
 */
export function generationProps(
  model: string, label: string, usage: Usage | null | undefined,
  extra: { attempt?: string; stop?: string | null; max_tokens?: number } = {},
): Record<string, unknown> {
  const cost = costUsd(model, usage);
  return {
    model,
    stage: stageOf(label),
    attempt: extra.attempt ?? 'first',
    input_tokens: n(usage?.input_tokens),
    output_tokens: n(usage?.output_tokens),
    cache_write_tokens: n(usage?.cache_creation_input_tokens),
    cache_read_tokens: n(usage?.cache_read_input_tokens),
    ...(extra.max_tokens ? { max_tokens: extra.max_tokens } : {}),
    ...(extra.stop ? { stop: extra.stop } : {}),
    priced: cost !== null,
    ...(cost !== null ? { cost_usd: cost } : {}),
  };
}

export interface MeterContext {
  userId?: string | null;
  groupId?: string | null;
  /** A saved plan's id, or null — the column is a foreign key to plans. */
  planId?: string | null;
}

/** What the route hands each model call: record this response's cost. */
export type Meter = (
  res: { usage?: Usage | null; stop_reason?: string | null } | null | undefined,
  model: string, label: string, attempt: string, maxTokens: number,
) => void;

/**
 * One per request. Never throws and is never awaited: a cost log that took
 * down the itinerary it was costing would be the most expensive line here.
 */
export function aiMeter(db: SupabaseClient, ctx: MeterContext): Meter {
  return (res, model, label, attempt, maxTokens) => {
    try {
      if (!res) return;
      void track(db, 'ai_generation', {
        userId: ctx.userId ?? null,
        groupId: ctx.groupId ?? null,
        planId: ctx.planId ?? null,
        props: generationProps(model, label, res.usage, { attempt, stop: res.stop_reason ?? null, max_tokens: maxTokens }),
      });
    } catch (e) {
      console.error('[ai-cost] could not record a generation', { label, error: e instanceof Error ? e.message : 'unknown' });
    }
  };
}
