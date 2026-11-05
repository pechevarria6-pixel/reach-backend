// ─── GET /api/plans/[planId]/weather — every day of the plan's weather ───
// Read only, for any member of the plan. Each calendar day of the plan is one
// of three things, and says which:
//
//   kind 'forecast'  inside a forecast's range (MET Norway, ~9 days; the NWS
//                    for US trips, ~6½ days): the day's high and low, rain
//                    chance and amount, wind, conditions, morning / afternoon
//                    / evening, sunrise and sunset — with `source` (name,
//                    credit, link) and `fetchedAt`. Labelled "Forecast".
//                    The day's rain, wind, conditions and worries are its
//                    daytime's (`verdictHours`, [8, 20] local), so a figure
//                    is never shown beside a verdict it did not raise; the
//                    high and low are the whole day's.
//   kind 'usually'   past the range: what the month is usually like there,
//                    from NASA POWER's normals. Labelled "Usually", never
//                    "forecast", with its own credit.
//   kind 'none'      neither is held, and `why`.
//
// `credits` lists every credit the days need, once each; a screen showing any
// of them shows these. `forecastAvailable` is false until
// sql/forecast-2026-11-05.sql has run, and every day is then 'usually' or
// 'none'.
//
//   ?fahrenheitFirst=1  the 'usually' line reads °F first (the screen knows
//                       its reader's units; lib/climate.ts fahrenheitFirst)
//
// The forecast is fetched on Reach's server and cached (lib/forecast-store.ts),
// never by the device: MET Norway's terms forbid apps calling it directly.
import { NextRequest, NextResponse } from 'next/server';
import { requirePlanMember, isFail } from '@/lib/auth';
import { planWeather, type WeatherPlan } from '@/lib/forecast-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { planId: string } }) {
  const ctx = await requirePlanMember(params.planId);
  if (isFail(ctx)) return ctx.error;
  const fahrenheitFirst = req.nextUrl.searchParams.get('fahrenheitFirst') === '1';
  try {
    const weather = await planWeather(ctx.db, ctx.plan as unknown as WeatherPlan, { fahrenheitFirst });
    return NextResponse.json({ planId: params.planId, ...weather });
  } catch (e) {
    console.error('[plan weather] failed', { planId: params.planId, message: e instanceof Error ? e.message : 'failed' });
    return NextResponse.json({ error: "Couldn't check the weather just now." }, { status: 503 });
  }
}
