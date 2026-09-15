// ─── Backfill itineraries ────────────────────────────────────────────────
// Regenerates the day-by-day plan and the full cost breakdown for existing
// trips. Plans made before each of these features landed have partial data or
// none: days with no prices, no booking mode, no payment notes, or no days at
// all.
//
//   node scripts/backfill-itineraries.mjs            what would change
//   node scripts/backfill-itineraries.mjs --apply    do it
//   node scripts/backfill-itineraries.mjs --apply --only <planId>
//
// Replaces a plan's itinerary_items wholesale, so it is destructive by design
// and refuses to run without --apply.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!url || !key) { console.error('  no Supabase credentials'); process.exit(1); }
if (!anthropicKey) { console.error('  no ANTHROPIC_API_KEY'); process.exit(1); }

const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rest = (path, init) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });
const client = new Anthropic({ apiKey: anthropicKey });

const str = { type: 'string' }, num = { type: 'number' };
const slot = {
  type: 'object',
  properties: { plan: str, cost: num, booking: { type: 'string', enum: ['reach', 'ahead', 'walk_in'] }, payment: str },
  required: ['plan', 'cost', 'booking', 'payment'], additionalProperties: false,
};
// Fixed costs come back in the same call: a plan made before the cost
// breakdown existed has nowhere else to get flights and beds from.
const SCHEMA = {
  type: 'object',
  properties: {
    fixed: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: str, detail: str, cost: num,
          type: { type: 'string', enum: ['flight', 'hotel', 'transport'] } },
        required: ['label', 'detail', 'cost', 'type'], additionalProperties: false,
      },
    },
    itinerary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: num, title: str, morning: slot, afternoon: slot, evening: slot,
          cost_today: num, insider_tip: str },
        required: ['day', 'title', 'morning', 'afternoon', 'evening', 'cost_today', 'insider_tip'],
        additionalProperties: false,
      },
    },
  },
  required: ['fixed', 'itinerary'], additionalProperties: false,
};
const Slot = z.object({ plan: z.string(), cost: z.number(), booking: z.enum(['reach','ahead','walk_in']), payment: z.string() });
const Result = z.object({
  fixed: z.array(z.object({ label: z.string(), detail: z.string(), cost: z.number(),
    type: z.enum(['flight','hotel','transport']) })),
  itinerary: z.array(z.object({ day: z.number(), title: z.string(), morning: Slot, afternoon: Slot,
    evening: Slot, cost_today: z.number(), insider_tip: z.string() })),
});

const nightsOf = (p) => p.start_date && p.end_date
  ? Math.max(1, Math.round((new Date(p.end_date) - new Date(p.start_date)) / 86400000)) : 5;

async function generate(plan, groupName, heads) {
  const nights = nightsOf(plan);
  const budget = Math.round((plan.budget_cents || 0) / 100) || null;
  const solo = heads <= 1;
  const res = await client.messages.create({
    model: 'claude-sonnet-5', max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content:
`Plan a ${nights}-night trip to ${plan.title}.
${solo ? 'Travelling alone.' : `A group of ${heads} called "${groupName}".`}
${budget ? `Budget: about $${budget} per person, everything in.` : ''}

"fixed" is what gets booked before departure: flights, the place they stay,
airport transfers. Per person, in whole dollars, realistic for these dates.

"itinerary" is one entry per day for all ${nights} days. Real venue names, real
neighbourhoods — make it feel like a local planned it. insider_tip is the thing
you only know the second time.

Every slot needs:
- "cost": what that one thing costs per person, whole dollars. A free walk is 0.
- "booking": "reach" if it can be reserved through a booking system, "ahead" if
  it needs reserving direct, "walk_in" if you just turn up.
- "payment": what they actually take, in a few words — "Cash only", "Cards, no
  Amex", "Contactless everywhere". Say so when a place is known for cash only.
${solo ? 'On their own: counter and bar seating, neighbourhoods comfortable alone, nothing needing a second person.' : ''}
Make each day's three costs add up to roughly that day's cost_today.` }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = Result.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('shape did not validate: ' + parsed.error.issues[0]?.message);
  return { ...parsed.data, stop: res.stop_reason, tokens: res.usage.output_tokens };
}

function rows(planId, out) {
  const fixed = out.fixed.map((f, i) => ({
    plan_id: planId, type: f.type, title: f.label, subtitle: f.detail,
    scheduled_time: 'Before you go', cost_cents: Math.round(f.cost * 100),
    booking_mode: 'reach', payment_note: 'Paid through Reach when the group funds the trip',
    is_confirmed: false, sort_order: i,
  }));
  const days = out.itinerary.flatMap((d, di) =>
    [['Morning', d.morning, 'activity', d.title], ['Afternoon', d.afternoon, 'activity', ''],
     ['Evening', d.evening, 'restaurant', d.insider_tip]]
      .filter(([, s]) => s?.plan)
      .map(([when, s, type, sub], si) => ({
        plan_id: planId, type, title: s.plan, subtitle: sub || '',
        scheduled_time: `Day ${d.day} · ${when}`, cost_cents: Math.round((s.cost || 0) * 100),
        booking_mode: s.booking, payment_note: s.payment,
        is_confirmed: false, sort_order: fixed.length + di * 3 + si,
      })));
  return [...fixed, ...days];
}

const plans = await (await rest('plans?select=id,title,group_id,start_date,end_date,budget_cents&order=created_at.desc')).json();
const groups = await (await rest('groups?select=id,name')).json();
const members = await (await rest('group_members?select=group_id,user_id')).json();
const gName = Object.fromEntries(groups.map(g => [g.id, g.name]));
const gHeads = members.reduce((a, m) => ({ ...a, [m.group_id]: (a[m.group_id] || 0) + 1 }), {});

const targets = ONLY ? plans.filter(p => p.id === ONLY) : plans;
console.log(`\n  ${targets.length} plan(s)${APPLY ? '' : ' — dry run, nothing will be written'}\n`);

let done = 0, failed = 0;
for (const p of targets) {
  const heads = gHeads[p.group_id] || 1;
  process.stdout.write(`  ${String(p.title).slice(0, 30).padEnd(30)} `);
  if (!APPLY) { console.log(`${nightsOf(p)}n, ${heads} traveller(s) — would regenerate`); continue; }
  try {
    const out = await generate(p, gName[p.group_id] || 'the group', heads);
    const toWrite = rows(p.id, out);
    await rest(`itinerary_items?plan_id=eq.${p.id}`, { method: 'DELETE' });
    const ins = await rest('itinerary_items', { method: 'POST', body: JSON.stringify(toWrite) });
    if (!ins.ok) throw new Error(`insert ${ins.status}: ${(await ins.text()).slice(0, 120)}`);
    const fixedTotal = out.fixed.reduce((a, f) => a + f.cost, 0);
    const varTotal = out.itinerary.flatMap(d => [d.morning, d.afternoon, d.evening]).reduce((a, s) => a + s.cost, 0);
    console.log(`${out.itinerary.length} days, ${toWrite.length} items · $${fixedTotal} booked + $${varTotal} on the day`);
    done++;
  } catch (e) {
    console.log(`FAILED — ${e.message}`);
    failed++;
  }
}
console.log(`\n  ${done} regenerated, ${failed} failed\n`);
