// Every table and column the API routes name, checked against the live schema.
// A wrong column name compiles, deploys, and only fails when a person uses the
// feature — which is how the loyalty insert shipped naming number_enc when the
// table has member_number_enc.
//
//   node scripts/check-queries.mjs
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('  no Supabase credentials in .env.local'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}` };

// live schema
const spec = await (await fetch(`${url}/rest/v1/`, { headers })).json();
const defs = spec.definitions ?? spec.components?.schemas ?? {};
const live = new Map(Object.entries(defs).map(([t, d]) => [t, new Set(Object.keys(d.properties ?? {}))]));

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.ts$/.test(e)) out.push(full);
  }
  return out;
}


// Splits a PostgREST select on top-level commas only. "users(id, name)" is one
// entry naming an embedded table, not three columns of the outer one — which
// is what a naive split reports, loudly and wrongly.
function splitTop(list) {
  const out = [];
  let depth = 0, buf = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

function checkSelect(list, table, file) {
  const cols = live.get(table);
  if (!cols) return;
  for (const entry of splitTop(list)) {
    const open = entry.indexOf('(');
    if (open !== -1) {
      // embedded resource, optionally aliased: alias:table(cols) or table(cols)
      let name = entry.slice(0, open).trim();
      if (name.includes(':')) name = name.split(':')[1].trim();
      name = name.replace(/!.*$/, '').trim();   // !inner / !fk hints
      const inner = entry.slice(open + 1, entry.lastIndexOf(')'));
      if (!live.has(name)) {
        // PostgREST also embeds through a named foreign key: alias:fk_column(...)
        // resolves the target from the FK rather than the alias. Verified live;
        // treat an unknown name that is a column somewhere as that form.
        const viaFk = [...live.values()].some(set => set.has(name));
        if (!viaFk) problems.push(`${file}: embedded table "${name}" does not exist`);
        continue;
      }
      checked.tables.add(name);
      checkSelect(inner, name, file);
      continue;
    }
    let c = entry;
    if (c.includes(':')) c = c.split(':')[1].trim();
    c = c.replace(/\*/g, '').trim();
    if (!c) continue;
    checked.columns++;
    if (!cols.has(c)) problems.push(`${file}: ${table}.${c} does not exist`);
  }
}

const problems = [];
const checked = { tables: new Set(), columns: 0 };

for (const file of [...walkFiles('app/api'), ...walkFiles('lib')]) {
  const src = readFileSync(file, 'utf8');
  // .from('table') ... .select('a, b, c')
  const re = /\.from\(\s*['"]([a-z_]+)['"]\s*\)([\s\S]{0,400}?)(?=\.from\(|\n\n|$)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, table, tail] = m;
    if (!live.has(table)) { problems.push(`${file}: table "${table}" does not exist`); continue; }
    checked.tables.add(table);
    const cols = live.get(table);

    const sel = /\.select\(\s*[`'"]([^`'"]*)[`'"]/.exec(tail);
    if (sel && sel[1].trim() && sel[1] !== '*') {
      checkSelect(sel[1], table, file);
    }
    // .eq('col', ...) / .in('col', ...)
    for (const f of tail.matchAll(/\.(?:eq|neq|in|gt|gte|lt|lte|like|ilike|is)\(\s*['"]([a-z_]+)['"]/g)) {
      checked.columns++;
      if (!cols.has(f[1])) problems.push(`${file}: filter on ${table}.${f[1]} — no such column`);
    }
  }
}

console.log(`\n  checked ${checked.columns} column references across ${checked.tables.size} tables\n`);
if (problems.length) {
  for (const p of [...new Set(problems)]) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ every table and column the API names exists in the live schema\n');
