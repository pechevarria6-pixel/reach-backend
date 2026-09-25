// ─── Weather no-gos, which nothing can check yet ─────────────────────────
// "Cold weather" was offered as an absolute no on four screens — the trip
// quiz, the taste quiz, the onboarding quiz's hard nos and the create-plan
// dealbreakers — under "We will never suggest these". Reach holds no climate
// data, so nothing ever checked it: the model was told "NEVER INCLUDE:
// coldWeather" and whatever it wrote was taken on trust. (The dealbreakers
// list also mapped "Extreme heat" to coldWeather, so somebody avoiding heat
// was planned away from the cold.)
//
// Until there is data to check against, the options are hidden and the
// prompt treats a saved one as a wish it cannot verify, never a rule it
// keeps. Answers already saved are kept, and a plan that carries one says,
// quietly, that we cannot check weather.
//
// CLIMATE_CHECKS_ENABLED is the switch for the climate work (feat/climate,
// NASA POWER normals). Turn it on in the same commit that makes a cold
// no-go checkable — and not before, because turning it on brings the
// options back under "We will never suggest these".

export const CLIMATE_CHECKS_ENABLED = false;

export const CANT_CHECK_WEATHER = "We can't check weather yet.";

/** Every spelling a weather no-go has been stored under. */
const WEATHER = new Set(['coldweather', 'cold weather', 'cold', 'extreme heat']);

export function isWeatherNoGo(v: unknown): boolean {
  const s = String(v ?? '').replace(/^custom:/, '').trim().toLowerCase();
  return WEATHER.has(s);
}

/**
 * The options a screen may offer. `key` reads an option's stored value or
 * label. With climate checks off, weather no-gos are not offered.
 */
export function offeredNoGos<T>(options: readonly T[], key: (o: T) => unknown, enabled = CLIMATE_CHECKS_ENABLED): T[] {
  return enabled ? [...options] : options.filter(o => !isWeatherNoGo(key(o)));
}

/** Whether a plan, or the viewer's own answers for it, carry a weather no-go. */
export function savedWeatherNoGo(p: { dealbreakers?: unknown; noWayJose?: unknown }): boolean {
  const all = [
    ...(Array.isArray(p.dealbreakers) ? p.dealbreakers : []),
    ...(Array.isArray(p.noWayJose) ? p.noWayJose : []),
  ];
  return all.some(isWeatherNoGo);
}

/**
 * Splits the vetoes a prompt carries. The hard ones stay "never include";
 * weather ones, while nothing can check them, become one line that says so.
 */
export function splitVetoes(vetoes: string[], enabled = CLIMATE_CHECKS_ENABLED): { hard: string[]; weather: string[] } {
  if (enabled) return { hard: vetoes, weather: [] };
  return { hard: vetoes.filter(v => !isWeatherNoGo(v)), weather: vetoes.filter(isWeatherNoGo) };
}

/**
 * The prompt's line for a weather no-go it cannot enforce. It is a wish,
 * said as one, and the model is told not to claim anything about weather.
 */
export function weatherLine(weather: string[]): string {
  if (!weather.length) return '';
  const cold = weather.some(w => /cold/i.test(w));
  const heat = weather.some(w => /heat/i.test(w));
  const what = cold && heat ? 'cold weather or extreme heat' : heat ? 'extreme heat' : 'cold weather';
  return `\nWEATHER (a wish, not a rule): at least one of them would rather avoid ${what}. Nothing here holds climate data, so this cannot be checked: never say a place or date will be warm, mild or cool, and never say the weather was checked, avoided or taken into account.`;
}
