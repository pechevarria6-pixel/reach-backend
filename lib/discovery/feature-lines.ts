// ─── One map feature per line, read the way osmium writes them ───────────
// osmium's geojsonseq export ends every record with "\n" and nothing else.
// It was read with Node's readline, which also breaks a line at a bare
// "\r". A name or description with a carriage return in it — one in Italy's
// centre, one in Russia's central district — cut its record in two, the
// first half failed JSON.parse with "Unterminated string", and the whole
// region stopped, every day, from 2026-09-25 on.
//
// Records are split on "\n" only. A raw control character inside a record
// is not valid JSON in a string anyway, so each is turned into a space before
// parsing: between tokens a space means the same thing, inside a name it is
// the gap the line break stood for. A record that still cannot be read is
// skipped and counted, never the reason a region of thirty thousand places
// is lost — but a download that is mostly unreadable is still a broken
// download, and the caller fails the run on that (tooManyUnreadable).

/** Lines of a stream split on "\n" alone. */
export async function* linesOf(input: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of input) {
    rest += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = rest.indexOf('\n')) >= 0) {
      yield rest.slice(0, at);
      rest = rest.slice(at + 1);
    }
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

export interface Unreadable { count: number; sample: string | null }

/** GeoJSON features from geojsonseq lines; what cannot be read is counted in `bad`. */
export async function* featureRecords<T = unknown>(lines: AsyncIterable<string>, bad: Unreadable): AsyncGenerator<T> {
  for await (const raw of lines) {
    // geojsonseq may open each record with an ASCII record separator.
    const line = raw.replace(/^\x1e/, '').replace(/[\u0000-\u001f]/g, ' ').trim();
    if (!line) continue;
    try {
      yield JSON.parse(line) as T;
    } catch (e) {
      bad.count++;
      if (!bad.sample) bad.sample = `${e instanceof Error ? e.message : e} — ${line.slice(0, 160)}`;
    }
  }
}

/** More than one record in a thousand unreadable is a broken export, not a stray character. */
export function tooManyUnreadable(bad: Unreadable, read: number): boolean {
  return bad.count > 0 && bad.count > Math.max(5, Math.floor(read / 1000));
}
