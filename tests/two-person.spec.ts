import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// ─── Two people, one group ──────────────────────────────────────────────
// Pilot gate A7: the flows only a second person can see. Account A
// (playwright/.auth/session.json, the organiser) and account B
// (session2.json, a member) are both in the QA test group. Each signs in
// through tests/auth.setup.ts with Clerk's testing helpers — keys and the two
// addresses come from .env.test.local (see .env.test.local.example).
//
// Against production, so the rules are the gate's (§C):
//   · reads anywhere both accounts may read;
//   · writes only inside the QA test group, and only one: a night out A starts
//     and then calls off, in this file, whatever happens in between;
//   · the owner's demo plan is only ever read, and only to be refused.
//
// API calls run inside each signed-in page with its own fetch, not through a
// request context: Clerk's __session lasts a minute, and the page's Clerk
// keeps it fresh where a jar read once would not.

const BASE_URL = process.env.TEST_URL || 'https://www.alcanzar.io';
const A_STATE = path.resolve(__dirname, '../playwright/.auth/session.json');
const B_STATE = path.resolve(__dirname, '../playwright/.auth/session2.json');

const QA_GROUP = 'a9eba014-12cd-4220-af31-4442aa5a192b';
const QA_SOLO = '7cb00571-f26f-44a2-be1e-a33168e95967';
const DEMO_PLAN = 'b21bae42-36c5-4a30-b883-703b8cf44f8f';

type Answer = { status: number; json: any; html: boolean };

async function api(page: Page, url: string, init?: { method?: string; body?: unknown }): Promise<Answer> {
  return page.evaluate(async ([u, i]) => {
    const r = await fetch(u as string, {
      method: (i as any)?.method || 'GET',
      headers: (i as any)?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: (i as any)?.body !== undefined ? JSON.stringify((i as any).body) : undefined,
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* an HTML page: the route is not deployed */ }
    return { status: r.status, json, html: json === null && /<html/i.test(text) };
  }, [url, init] as const);
}

async function signedIn(browser: Browser, state: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/home`);
  await page.waitForURL('**/home', { timeout: 20000 });
  return { ctx, page };
}

/** A route this branch adds answers JSON; production before the merge answers Next's HTML 404. */
function notDeployed(a: Answer) {
  return a.status === 404 && a.html;
}

/** Tomorrow on the pilot's clock (Southern Pines), as YYYY-MM-DD. */
function tomorrowInNewYork(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

test.describe('Two people, one group', () => {
  test.describe.configure({ mode: 'serial' });

  let A: { ctx: BrowserContext; page: Page };
  let B: { ctx: BrowserContext; page: Page };
  let aId = '';
  let bId = '';
  let planId: string | null = null;
  let calledOff = false;

  test.beforeAll(async ({ browser }, info) => {
    // Once per run: the iPhone project would start and call off a second plan.
    test.skip(info.project.name !== 'chromium', 'runs on the chromium project only');
    test.skip(!fs.existsSync(B_STATE), 'No second account: set TEST_EMAIL_2 in .env.test.local and run the setup project.');
    A = await signedIn(browser, A_STATE);
    B = await signedIn(browser, B_STATE);
    const [meA, meB] = await Promise.all([api(A.page, '/api/me'), api(B.page, '/api/me')]);
    expect(meA.status, 'account A is signed in').toBe(200);
    expect(meB.status, 'account B is signed in').toBe(200);
    aId = meA.json.id;
    bId = meB.json.id;
    expect(aId, 'two different people').not.toBe(bId);
  });

  test.afterAll(async () => {
    // Whatever failed above, nothing this file started is left running.
    if (planId && !calledOff && A?.page) {
      const r = await api(A.page, `/api/plans/${planId}`, { method: 'PATCH', body: { status: 'cancelled' } });
      console.log(`[two-person] cleanup: called off ${planId} → ${r.status}`);
    }
    await A?.ctx?.close();
    await B?.ctx?.close();
  });

  test('both are in the QA group, and each sees the other in it', async () => {
    const [ga, gb] = await Promise.all([api(A.page, `/api/groups/${QA_GROUP}`), api(B.page, `/api/groups/${QA_GROUP}`)]);
    expect(ga.status).toBe(200);
    expect(gb.status).toBe(200);
    const roles = (g: Answer) => Object.fromEntries((g.json.members as any[]).map(m => [m.user_id, m.role]));
    expect(roles(ga)[aId]).toBe('admin');
    expect(roles(ga)[bId]).toBe('member');
    // The same group, read by either person, is the same set of people.
    expect(Object.keys(roles(gb)).sort()).toEqual(Object.keys(roles(ga)).sort());
  });

  test('the group waits on both: the quiz count is two people, the same from either side', async () => {
    const [qa, qb] = await Promise.all([
      api(A.page, `/api/groups/${QA_GROUP}/quiz-status`),
      api(B.page, `/api/groups/${QA_GROUP}/quiz-status`),
    ]);
    expect(qa.status).toBe(200);
    expect(qa.json.totalCount).toBe(2);
    expect(Object.keys(qa.json.members).sort()).toEqual([aId, bId].sort());
    expect(qb.json.completedCount).toBe(qa.json.completedCount);
    expect(qb.json.allComplete).toBe(qa.json.completedCount === 2);
  });

  test('B is refused what is not B\'s: A\'s solo trip and the owner\'s demo plan', async () => {
    const [solo, demo] = await Promise.all([
      api(B.page, `/api/groups/${QA_SOLO}`),
      api(B.page, `/api/plans/${DEMO_PLAN}`),
    ]);
    expect(solo.status).toBe(403);
    expect([403, 404]).toContain(demo.status);
  });

  test('B sees the QA group on their own Groups screen', async () => {
    await B.page.locator('.nb-btn', { hasText: 'Groups' }).first().click();
    await expect(B.page.getByText('QA test group').first()).toBeVisible({ timeout: 20000 });
  });

  test('a night out A starts is one B can open', async () => {
    const created = await api(A.page, '/api/plans', {
      method: 'POST',
      body: {
        group_id: QA_GROUP,
        title: 'E2E two-person check (called off by the test)',
        type: 'restaurant',
        destination_style: 'undecided',
        start_date: tomorrowInNewYork(),
        budget_cents: 0,
      },
    });
    // One night out at a time per group: if one is already being planned in
    // the QA group, say which and stop, rather than call somebody else's off.
    test.skip(created.status === 409, `The QA group already has a night out in planning: ${JSON.stringify(created.json).slice(0, 200)}`);
    expect(created.status, JSON.stringify(created.json).slice(0, 300)).toBeLessThan(300);
    planId = created.json.plan?.id ?? created.json.id;
    expect(planId).toMatch(/^[0-9a-f-]{36}$/);

    const seen = await api(B.page, `/api/plans/${planId}`);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.json)).toContain(planId as string);
  });

  test('the organiser\'s debrief is never offered to the member, nor before the trip', async () => {
    test.skip(!planId, 'no plan to ask about');
    const [b, a] = await Promise.all([
      api(B.page, `/api/plans/${planId}/debrief`),
      api(A.page, `/api/plans/${planId}/debrief`),
    ]);
    test.skip(notDeployed(b), '/api/plans/[planId]/debrief is not on production yet (gate/verify not merged)');
    expect(b.status).toBe(200);
    expect(b.json.ask).toBe(false);
    expect(b.json.why).toBe('not_organiser');
    expect(a.status).toBe(200);
    expect(a.json.ask).toBe(false);
    expect(['not_over', 'nothing_held']).toContain(a.json.why);
    // And a member's answer is refused outright, not stored.
    const post = await api(B.page, `/api/plans/${planId}/debrief`, {
      method: 'POST', body: { hours: '1_3', nps: 9, would_run_again: true },
    });
    expect(post.status).toBe(409);
  });

  test('only the organiser can call it off, and then both see it off', async () => {
    test.skip(!planId, 'no plan to call off');
    const refused = await api(B.page, `/api/plans/${planId}`, { method: 'PATCH', body: { status: 'cancelled' } });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/can call this off/);

    const off = await api(A.page, `/api/plans/${planId}`, { method: 'PATCH', body: { status: 'cancelled' } });
    expect(off.status, JSON.stringify(off.json).slice(0, 300)).toBe(200);
    calledOff = true;

    const after = await api(B.page, `/api/plans/${planId}`);
    expect(after.status).toBe(200);
    expect(after.json.plan?.status ?? after.json.status).toBe('cancelled');
  });

  test('"When did you last see this group?" is each person\'s own, and refuses an invented answer', async () => {
    const [b, outsider] = await Promise.all([
      api(B.page, `/api/groups/${QA_GROUP}/reconnection`),
      api(B.page, `/api/groups/${QA_SOLO}/reconnection`),
    ]);
    test.skip(notDeployed(b), '/api/groups/[id]/reconnection is not on production yet (gate/verify not merged)');
    expect(b.status).toBe(200);
    expect(typeof b.json.ask).toBe('boolean');
    expect(outsider.status).toBe(403);
    // Validated before anything is read or written: nothing is recorded.
    const bad = await api(B.page, `/api/groups/${QA_GROUP}/reconnection`, { method: 'POST', body: { answer: 'last week' } });
    expect(bad.status).toBe(400);
  });
});
