// ─── The climate we hold for a place ─────────────────────────────────────
// GET /api/climate?city=Moab&country=US[&lat=&lng=]
//
// The twelve monthly normals held for the place (NASA POWER, see
// lib/climate.ts), or `climate: null` when we hold none — including before
// sql/climate-2026-09-24.sql has run. The screens work the months, the
// best-weather hint and a trip's dates out of these with lib/climate.ts, so
// what the When step says and what an idea card says come from the same
// numbers by the same rule. Never a call to NASA from here: the loader fills
// the table, a request only reads it.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isFail } from '@/lib/auth';
import { whereFrom } from '@/lib/discovery/where';
import { readClimate } from '@/lib/climate-store';

export async function GET(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const params = req.nextUrl.searchParams;
  const city = (params.get('city') || '').trim().slice(0, 120);
  if (!city) return NextResponse.json({ error: 'Name the place' }, { status: 400 });
  const country = (params.get('country') || '').trim().toUpperCase();
  const at = whereFrom(params);
  const read = await readClimate(ctx.db, {
    name: city, country: /^[A-Z]{2}$/.test(country) ? country : null,
    lat: at?.lat ?? null, lng: at?.lng ?? null,
  });
  return NextResponse.json({ climate: read.normals, held: !!read.normals, available: read.available });
}
