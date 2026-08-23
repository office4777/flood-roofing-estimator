// What a customer's browser is handed.
//
// /q/:token used to answer with the whole quote object, because the customer's
// page recomputed every option price locally. So the JSON in their browser
// carried the roofer's cost basis and margin — materialBase, the mark-ups,
// scaffoldBase, labourRatesCustom. Devtools on a quote you were sent showed
// what the job cost to buy and what the roofer was making.
//
// The office prices the options before sending; the page adds up sell prices.
// These fields never leave the office now. pricegold.mjs proves that changed no
// price; this proves it changed what is disclosed.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// A quote as the office sends it: sell prices stored, cost basis still on the
// record (the office needs it — it is only the customer's copy that must not
// carry it).
const PRICED = {
  v: 1, gstRate: 15, base: 28500,
  grade: { maxam: 0, colorzen: -1324.8, zincalume: -3139.2 },
  gradeLabel: { maxam: 'Colorsteel® MAXAM', colorzen: 'Armorsteel ColorZen', zincalume: 'Zincalume®' },
  gaugeUpgrade: 2112, profileLocks: { corrugate: '', '5rib': '55' },
  profileLabel: { corrugate: 'Corrugate', '5rib': '5-Rib' },
  gutter: { box125: 1260, marley_typhoon: 1680 },
  gutterLabel: { box125: '125mm Colorsteel Box Gutter', marley_typhoon: 'Marley Typhoon (PVC)' },
  gutterUplift: { box125: true, marley_typhoon: true },
  gutterOverride: null, bracketExt: { box125: 252, marley_typhoon: 126 },
  scaffoldUplift: 1050, downpipes: 450, extraRoof: [4800], extraRoofLabel: ['Garage'],
  gutterExcluded: false,
};
const SECRETS = {
  materialBase: 9600, scaffoldBase: 4200,
  roofMaterialMarkup: 5, gutterMaterialMarkup: 10,
  roofMatQtyBuffer: 7, gutterMatQtyBuffer: 3,
  labourRatesCustom: { lead: 180, app: 90 }, labourCalc: { hrs: 42 },
  roofLabour: { leadHrs: 30 }, gutterUnitPrices: { box: 30 }, selectionPrices: { colorzen: 0 },
};
const quote = Object.assign({
  client: 'A Customer', addr: '1 Test Rd', gstRate: 15, baseGrade: 'maxam',
  // things the proposal legitimately shows
  scope: 'Full re-roof', terms: 'Standard terms', notes: 'Access via side gate',
  proposalOptions: { steelGrade: 'colorzen', profile: 'corrugate', steelThickness: '40',
                     gutterType: 'box125', gutterBracket: 'external', downpipes: 'yes',
                     extraRoofsSel: { 0: true } },
  share: { token: 'qleaktest', status: 'sent', sentAt: new Date().toISOString(),
           sentTotal: 40000, priced: PRICED, events: [] },
}, SECRETS);

const { port } = await startFakePostgrest({
  profiles: [], user_settings: [], company_users: [], invoices: [],
  jobs: [{ id: 'j1', user_id: 'u1', company_id: 'c1', client_name: 'A Customer',
           site_address: '1 Test Rd', draw_state: { state: { quote } } }],
});
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34606';
process.env.PORT = PORT;
delete process.env.DATABASE_URL;
const log = console.log; console.log = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log;
await new Promise(r => setTimeout(r, 700));
const BASE = 'http://127.0.0.1:' + PORT;

// ── the leak ──────────────────────────────────────────────────────
const res = await fetch(BASE + '/q/qleaktest');
const body = await res.text();
const d = JSON.parse(body);

for (const f of Object.keys(SECRETS)) {
  check('the customer is not sent ' + f, d.quote[f] === undefined,
    d.quote[f] === undefined ? 'absent' : 'LEAKED: ' + JSON.stringify(d.quote[f]));
}
check('…and none of those names appear anywhere in the raw response',
  !/materialBase|roofMaterialMarkup|gutterMaterialMarkup|labourRatesCustom|scaffoldBase/.test(body),
  'raw body clean');

// ── while the proposal still has everything it needs to render ────
check('the customer still gets the quote itself', !!d.quote && d.quote.client === 'A Customer');
check('…the scope, terms and notes', !!d.quote.scope && !!d.quote.terms && !!d.quote.notes);
check('…their own selections', (d.quote.proposalOptions || {}).gutterType === 'box125');
check('…and the sell prices the page adds up',
  !!d.quote.share.priced && d.quote.share.priced.gutter.box125 === 1260);

// ── the sell prices disclose nothing the customer could not click to ──
check('a sell price is what the option costs, not what it cost the roofer',
  d.quote.share.priced.gutter.box125 !== SECRETS.gutterUnitPrices.box &&
  !JSON.stringify(d.quote.share.priced).includes('markup') &&
  !JSON.stringify(d.quote.share.priced).includes('Markup'));

// ── a quote sent BEFORE this shipped must not break ───────────────
const src = await readFile(_j(_ROOT, 'backend', 'server.js'), 'utf8');
check('a quote with no priced block is passed through untouched, not blanked',
  /if \(!priced \|\| priced\.v !== 1\) return quote;/.test(src));
check('the hidden list is a denylist, so a new DISPLAY field is never blanked by accident',
  /CUSTOMER_HIDDEN_FIELDS\.indexOf\(k\) < 0/.test(src));

// ── the accepted total can now be checked exactly ─────────────────
// base 28500 + garage 4800 + colorzen -1324.8 + box125 1260 + uplift 1050
// + ext brackets 252 + downpipes 450 = 34987.2 ex GST -> 40235.28 incl
const expect = (28500 + 4800 - 1324.8 + 1260 + 1050 + 252 + 450) * 1.15;
let r = await fetch(BASE + '/q/qleaktest/event', { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'accepted', name: 'Bob', total: Math.round(expect * 100) / 100 }) });
check('accepting at the right total is accepted', r.status === 200, 'status ' + r.status);
let after = await (await fetch(BASE + '/q/qleaktest')).json();
check('…and recorded as verified',
  (after.quote.accepted || {}).totalVerified === true,
  JSON.stringify((after.quote.accepted || {}).totalVerified));

check('the backend computes that total itself rather than trusting the browser',
  /function _expectedTotalFor/.test(src) &&
  /Math\.abs\(acceptedTotal - expected\) <= 0\.01/.test(src));
check('…and still falls back to the band when a quote has no priced block',
  /acceptedTotal >= sent \* 0\.2 && acceptedTotal <= sent \* 5/.test(src));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
