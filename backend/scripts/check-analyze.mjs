#!/usr/bin/env node
// Phase 2 acceptance checks against a running backend (local or deployed).
//
//   API=http://localhost:8787 CODE=your-invite node scripts/check-analyze.mjs fixtures/selfies/person1.jpg
//
// Checks: schema-valid response under 15 s; the same photo 3x gives the same
// skin type and main concern with zone scores within 1 point; en vs ar give
// identical enums and scores. Prints results only (never the photo).

import { readFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:8787';
const CODE = process.env.CODE ?? '';
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-analyze.mjs <selfie.jpg>  (≈1024px JPEG)');
  process.exit(1);
}
const image_base64 = readFileSync(file).toString('base64');
// Photo decides type and focus, so the check measures the model, not the answers.
const answers = {
  skin_feel: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
  reactivity: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
  main_bother: null,
  avoid: ['nothing'],
  avoid_other: '',
  conditions: ['none'],
  budget_aed: 50,
};

async function analyze(language) {
  const t0 = Date.now();
  const res = await fetch(`${API}/analyze?debug=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-invite-code': CODE, 'x-device-id': 'acceptance-check-01' },
    body: JSON.stringify({ image_base64, answers, language }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return { ms, p: body.profile, obs: body.debug_observations };
}

const ZONES = ['forehead', 'nose', 'left_cheek', 'right_cheek', 'chin'];
const FIND = ['oil', 'redness', 'breakouts', 'dark_spots', 'dryness', 'texture'];
const enums = (p) => ({
  usable: p.photo_quality.usable,
  issue: p.photo_quality.issue,
  skin_type: p.skin_type,
  sensitivity: p.sensitivity,
  confidence: p.confidence,
  main_concern: p.main_concern,
  red_flags: p.red_flags.map((f) => f.type).sort().join(','),
});
const maxScoreDiff = (a, b) => Math.max(...ZONES.flatMap((z) => FIND.map((f) => Math.abs(a.zones[z][f] - b.zones[z][f]))));
const sameScores = (a, b) => maxScoreDiff(a, b) === 0;

let ok = true;
const check = (label, pass, detail = '') => {
  ok &&= pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const runs = [];
for (let i = 0; i < 3; i++) runs.push(await analyze('en'));
runs.forEach((r, i) => check(`run ${i + 1} under 15 s`, r.ms < 15_000, `${r.ms} ms`));
const base = enums(runs[0].p);
console.log('run 1:', base);
if (runs[0].obs) {
  // What Gemini saw before scoring, next to the scores it gave: check these make sense.
  const o = runs[0].obs;
  console.log(`\nwhat Gemini saw (run 1)\n  lighting:  ${o.lighting}\n  skin tone: ${o.skin_tone}`);
  for (const z of ZONES) {
    const s = FIND.map((f) => runs[0].p.zones[z][f]).map((v, i) => (v ? `${FIND[i]} ${v}` : null)).filter(Boolean).join(', ') || 'all 0';
    console.log(`  ${z.padEnd(11)} ${o.zones[z]}\n  ${' '.repeat(11)} → ${s}`);
  }
  console.log('');
}
for (let i = 1; i < 3; i++) {
  const e = enums(runs[i].p);
  check(`run ${i + 1} same skin type + main concern`, e.skin_type === base.skin_type && e.main_concern === base.main_concern, `${e.skin_type}/${e.main_concern}`);
  const d = maxScoreDiff(runs[0].p, runs[i].p);
  check(`run ${i + 1} zone scores within 1`, d <= 1, `max diff ${d}`);
}

const ar = await analyze('ar');
check('ar: identical enums to en', JSON.stringify(enums(ar.p)) === JSON.stringify(base), JSON.stringify(enums(ar.p)));
check('ar: identical zone scores to en', sameScores(ar.p, runs[0].p), `max diff ${maxScoreDiff(ar.p, runs[0].p)}`);
check('ar: noon queries stay English', ar.p.products.every((x, i) => x.noon_query === runs[0].p.products[i]?.noon_query));

process.exit(ok ? 0 : 1);
