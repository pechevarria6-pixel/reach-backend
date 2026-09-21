// ─── Asking the model for JSON, and surviving the ways that goes wrong ──
// The two failures this exists for both happened here, in production:
//
//   · a schema the API will not accept is a 400 on every single request.
//     `minItems: 3` is rejected outright, and trip generation was down
//     until it was removed. A malformed schema has to degrade to an
//     unconstrained prompt, not take the feature with it.
//   · a response cut off at max_tokens is valid JSON right up to where the
//     tokens ran out, so it parses as nothing at all. Asking again with
//     more room and an instruction to be brief recovers it.
//
// This is the same pattern `app/api/trips/generate` has carried inline since
// those were fixed. It is copied rather than moved because that route is
// frozen while other work is in flight on it; when it is next open, its
// local `withSchemaFallback` and `anthropicOrNull` can be deleted in favour
// of these two with no change in behaviour.
import Anthropic from '@anthropic-ai/sdk';

/** A missing key disables a lane with a clean message rather than a crash. */
export function anthropicOrNull(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export interface JSONRequest {
  client: Anthropic;
  model: string;
  maxTokens: number;
  prompt: string;
  schema: Record<string, unknown>;
  /** What the logs call this, so a failure can be found. Never a key. */
  label: string;
  effort?: 'low' | 'medium' | 'high';
}

/**
 * One constrained call, with both recoveries above.
 *
 * Only a rejected request falls back to the unconstrained prompt. A 429 or a
 * 5xx is transient and belongs to the caller, which knows whether to retry
 * it now or leave it for the next run.
 */
export async function askForJSON(req: JSONRequest) {
  const { client, model, maxTokens, prompt, schema, label, effort } = req;

  const call = (tokens: number, extra: string, constrained: boolean) =>
    client.messages.create({
      model,
      max_tokens: tokens,
      messages: [{ role: 'user' as const, content: prompt + extra }],
      ...(constrained
        ? { output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema' as const, schema } } }
        : effort ? { output_config: { effort } } : {}),
    });

  let res;
  try {
    res = await call(maxTokens, '', true);
  } catch (e: any) {
    if (e?.status !== 400) throw e;
    console.error(`[${label}] schema rejected, retrying unconstrained:`, e?.message);
    res = await call(maxTokens, '', false);
  }

  if (res.stop_reason === 'max_tokens') {
    console.error(`[${label}] truncated at ${maxTokens} tokens, retrying briefer`);
    const briefer = '\n\nBe significantly briefer than you would normally be. ' +
      'Every prose field must be one short sentence or less. The complete ' +
      'response must fit well within the limit.';
    try {
      const retry = await call(Math.round(maxTokens * 1.5), briefer, true);
      if (retry.stop_reason !== 'max_tokens') return retry;
      console.error(`[${label}] truncated again at ${Math.round(maxTokens * 1.5)} tokens`);
      return retry;
    } catch (e: any) {
      console.error(`[${label}] briefer retry failed:`, e?.message);
      return res;
    }
  }

  return res;
}
