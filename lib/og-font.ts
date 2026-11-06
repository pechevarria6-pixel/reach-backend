// The brand's display face for link-preview images. next/og cannot read the
// woff2 that next/font serves, so it asks Google Fonts for a TrueType cut of
// just the letters it needs. Never fatal: without it the picture is drawn in
// the renderer's own sans, which is still a picture.
export async function frauncesFor(text: string, weight = 600): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Fraunces:wght@${weight}&text=${encodeURIComponent(text)}`,
      // An old agent is answered with TrueType or woff rather than woff2.
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30' }, signal: AbortSignal.timeout(4000) },
    ).then(r => (r.ok ? r.text() : ''));
    const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype|woff)'\)/.exec(css)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
