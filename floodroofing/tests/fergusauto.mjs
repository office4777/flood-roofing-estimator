// "When I email a quote, push the pricing to Fergus and publish the quote so
//  Fergus marks the job quoted. Then whatever selections the customer
//  chooses, create a new quote version to match and publish it — but don't
//  accept it, we'll accept it manually."
//
// The office's push stamps a PLAN on the share (base sections as pushed, the
// line shape, where to push). The customer's picks come in on /q/:token/event;
// a little after they stop tapping, the server composes base + the priced
// deltas for their picks, creates the next version on the Fergus job, voids
// the earlier unaccepted ones and publishes it. It never accepts.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';
import { createRequire } from 'node:module';
const require = createRequire(_j(_ROOT, 'backend') + '/');
const jwt = require('jsonwebtoken');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const KEY = 'fergus-secret-key-0123456789-abcdefghijklmnop';
const fergus = [];               // every call the server makes to Fergus
let quoteSeq = 100;
let publishStatus = 200;         // what the publish endpoint answers
globalThis.__TEST_HTTPS = async (host, path, method, headers, body) => {
  fergus.push({ path, method, body, auth: (headers || {}).Authorization });
  const j = (status, obj) => ({ status, body: JSON.stringify(obj), headers: {} });
  if (method === 'POST' && /^\/jobs\/[^/]+\/quotes$/.test(path)) return j(201, { id: 'fq' + (++quoteSeq) });
  if (method === 'GET'  && /^\/jobs\/[^/]+\/quotes$/.test(path)) return j(200, { data: [
    { id: 'fq1', title: 'old draft' }, { id: 'fq2', title: 'accepted one', isAccepted: true },
    { id: 'fq' + quoteSeq, title: 'the new one' } ] });
  if (method === 'POST' && /\/void$/.test(path)) return j(200, {});
  if (method === 'POST' && /\/publish$/.test(path)) return j(publishStatus, {});
  if (method === 'POST' && /\/accept/.test(path)) return j(200, { NEVER: true });
  return j(404, { message: 'no' });
};

const now = new Date().toISOString();
const priced = { v: 1, gstRate: 15, base: 10000,
  grade: { maxam: 0, colorzen: -600 }, gradeLabel: { maxam: 'MAXAM', colorzen: 'ColorZen' },
  gaugeUpgrade: 400, profileLocks: {}, profileLabel: {},
  gutter: { none: 0, box125: 1500, marley_classic: 900 }, gutterLabel: { box125: '125mm Colorsteel Box Gutter', marley_classic: 'Marley Classic (PVC)' },
  gutterUplift: { box125: true, marley_classic: true }, gutterOverride: null, bracketExt: { box125: 120, marley_classic: 60 },
  scaffoldUplift: 250, downpipes: 300, extraRoof: [2000], extraRoofLabel: ['Garage'],
  extraRoofSplit: [{ materials: 1200, labour: 700, scaffold: 100 }], gutterExcluded: false, extras: {} };
const line = (name, qty, price, lab) => ({ itemName: name, itemQuantity: qty, itemPrice: price, itemRrp: price, itemCost: 0,
  unitOfMeasureSell: null, isLabour: !!lab, sortOrder: 10, discountRate: 0, isCombined: false });
const plan = { jobId: 'FJ-77', rev: 1, lastQuoteId: 'fq1', title: 'Quote 3231 — Matawaia Marae', dueDays: 30, notes: 'Re-roof',
  baseSections: [
    { name: 'Labour', sortOrder: 10, selectionMode: 'Fixed', lineItems: [line('Lead Roofer', 40, 150, true)] },
    { name: 'Materials', sortOrder: 20, selectionMode: 'Fixed', lineItems: [line('Roofing sheets', 100, 40), line('Scaffolding', 1, 0)] } ],
  template: { mat: line('', 1, 0), lab: line('', 1, 0, true) },
  selKey: JSON.stringify({ profile: 'corrugate', steelGrade: 'maxam', extras: {}, extraRoofsSel: {} }), publish: true };
const mkJob = (id, token) => ({ id, user_id: 'u-aron', company_id: 'c1', client_name: 'Matawaia Marae', site_address: 'Matawaia',
  created_at: now, updated_at: now, order_sent: null, status: 'quoted',
  draw_state: { state: { quote: { client: 'Matawaia Marae', ref: '3231', gstRate: 15, baseGrade: 'maxam',
    proposalOptions: { profile: 'corrugate', steelGrade: 'maxam' }, extraRoofs: [{ name: 'Garage', price: 2000, materials: 1200, labour: 700, scaffold: 100 }],
    share: { token, status: 'sent', sentAt: now, sentTotal: 11500, events: [], priced: JSON.parse(JSON.stringify(priced)), fergus: JSON.parse(JSON.stringify(plan)) } } } } });
const db = { __missing: [],
  profiles: [{ id: 'u-aron', company_id: 'c1', name: 'Aron', email: 'aron@floodroofing.co.nz' }],
  company_users: [{ company_id: 'c1', user_id: 'u-aron', role: 'owner' }],
  companies: [{ id: 'c1', name: 'Flood Roofing', plan: 'team' }],
  user_settings: [{ user_id: 'u-aron', company_id: 'c1', branding: { company_name: 'Flood Roofing' }, quote_defaults: {},
    jms_keys: { fergus: KEY }, price_book: {}, labour_pricing: {}, invoicing: {}, updated_at: now }],
  jobs: [ mkJob('j-3231', 'tok3231'), mkJob('j-noplan', 'toknoplan') ],
  invoices: [], platform_state: [], comms_tasks: [], schedule_rows: [], schedule_blocks: [], usage_events: [] };
delete db.jobs[1].draw_state.state.quote.share.fergus;   // a quote never pushed: nothing to version
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
const PORT = process.env.TEST_PORT || '34641';
process.env.PORT = PORT;
process.env.BILLING_ENABLED = 'false';
process.env.FERGUS_AUTO_VERSION_DELAY_MS = '120';
delete process.env.DATABASE_URL;
const log = console.log, warn = console.warn, cerr = console.error;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
console.log = log; console.warn = warn; console.error = cerr;
await new Promise(r => setTimeout(r, 700));

const BASE = 'http://127.0.0.1:' + PORT;
const event = (t, body) => fetch(BASE + '/q/' + t + '/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const settle = (ms) => new Promise(r => setTimeout(r, ms || 600));
const quoteOf = (id) => db.jobs.find(j => j.id === id).draw_state.state.quote;
const creates = () => fergus.filter(c => c.method === 'POST' && /\/quotes$/.test(c.path));
const sum = (secs) => secs.reduce((a, s) => a + s.lineItems.reduce((b, li) => b + li.itemQuantity * li.itemPrice, 0), 0);

// ── the customer picks a gutter, a cheaper grade and the garage ──
let r = await event('tok3231', { type: 'update', selections: { proposalOptions: { gutterType: 'box125', gutterBracket: 'external', downpipes: 'yes', steelGrade: 'colorzen', extraRoofsSel: { 0: true } } } });
check('the customer’s update is accepted as before', r.status === 200, String(r.status));
check('…and nothing goes to Fergus straight away — they are still tapping', creates().length === 0, creates().length + ' creates');
await settle(700);
check('THE FEATURE: a little later, a new quote version is created on the linked Fergus job',
  creates().length === 1 && creates()[0].path === '/jobs/FJ-77/quotes', JSON.stringify(creates().map(c => c.path)));
const c1 = (creates()[0] || {}).body || {};
const expectDelta = 1500 + 250 + 120 + 300 + (-600) + 2000;
check('…priced as the base plus exactly the customer’s picks',
  Math.abs(sum(c1.sections || []) - (10000 + expectDelta)) < 0.02, '$' + sum(c1.sections || []).toFixed(2) + ' vs $' + (10000 + expectDelta));
check('…with the same total Fergus is told, GST on top',
  Math.abs((+c1.total || 0) - (10000 + expectDelta) * 1.15) < 0.02, '$' + c1.total);
const names = (c1.sections || []).map(s => s.name);
check('…the gutter, scaffold upgrade, downpipes and the garage in sections of their own',
  names.indexOf('Guttering') >= 0 && names.indexOf('Scaffolding') >= 0 && names.indexOf('Downpipes') >= 0 &&
  (c1.sections || []).some(s => s.name === 'Labour' && s.lineItems.some(li => /Garage — roof labour/.test(li.itemName) && li.isLabour)),
  names.join(', '));
check('…the base lines untouched', (c1.sections.find(s => s.name === 'Materials') || { lineItems: [] }).lineItems.some(li => li.itemName === 'Roofing sheets' && li.itemQuantity === 100));
check('…titled as the customer’s selections, a version up', /\(v2 — customer/.test(c1.title || ''), c1.title);
check('…as a draft that is then published', c1.status === 'Draft' && fergus.some(c => /\/fq10[0-9]\/publish$/.test(c.path) || /publish$/.test(c.path)),
  fergus.filter(c => /publish/.test(c.path)).map(c => c.path).join(', '));
check('…with the earlier unaccepted version voided and the accepted one left alone',
  fergus.some(c => c.path === '/jobs/quotes/fq1/void') && !fergus.some(c => c.path === '/jobs/quotes/fq2/void'),
  fergus.filter(c => /void/.test(c.path)).map(c => c.path).join(', '));
check('…and NEVER accepted — that stays a human decision', !fergus.some(c => /accept/i.test(c.path)));
check('…using the business’s own Fergus key, never printed', creates()[0].auth === 'Bearer ' + KEY);
let q = quoteOf('j-3231');
check('the quote remembers what Fergus now carries', !!(q.share.fergus.auto && q.share.fergus.auto.quoteId) && q.share.fergus.rev === 2, JSON.stringify(q.share.fergus.auto));
check('…and tells the office in the activity feed', q.share.events.some(e => e.type === 'fergus-version'), JSON.stringify(q.share.events.map(e => e.type)));

// ── the same picks again: Fergus already has them ──
fergus.length = 0;
await event('tok3231', { type: 'update', selections: { proposalOptions: { gutterType: 'box125', gutterBracket: 'external', downpipes: 'yes', steelGrade: 'colorzen', extraRoofsSel: { 0: true } } } });
await settle(700);
check('the same selections sent again do not make another version', creates().length === 0, creates().length + ' creates');

// ── tapping around: many updates, one version ──
fergus.length = 0;
for (const g of ['marley_classic', 'none', 'box125', 'marley_classic']){
  await event('tok3231', { type: 'update', selections: { proposalOptions: { gutterType: g } } });
  await new Promise(r => setTimeout(r, 30));
}
await settle(700);
check('four taps in a few seconds make ONE new version, for the last pick',
  creates().length === 1 && (creates()[0].body.sections || []).some(s => s.name === 'Guttering' && s.lineItems.some(li => /Marley Classic/.test(li.itemName))),
  creates().length + ' creates');

// ── the customer accepts: one more version with what they accepted, still not accepted in Fergus ──
fergus.length = 0;
await event('tok3231', { type: 'accepted', name: 'Matawaia Marae', total: 12000, selections: { proposalOptions: { gutterType: 'marley_classic', steelGrade: 'maxam' } } });
await settle(700);
check('acceptance creates a version named as the accepted selections', creates().length === 1 && /accepted selections/.test(creates()[0].body.title), (creates()[0] || { body: {} }).body.title);
check('…and still does not accept it in Fergus', !fergus.some(c => /accept/i.test(c.path)));

// ── a quote that was never pushed has no plan: nothing happens ──
fergus.length = 0;
await event('toknoplan', { type: 'update', selections: { proposalOptions: { gutterType: 'box125' } } });
await settle(600);
check('a quote never pushed to Fergus is left alone', creates().length === 0, creates().length + ' creates');

// ── the publish route the office uses after its own push ──
const tok = jwt.sign({ id: 'u-aron', email: 'aron@floodroofing.co.nz', cid: 'c1' }, 'test-secret', { expiresIn: '1h' });
const pub = (body) => fetch(BASE + '/fergus-quote/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + tok }, body: JSON.stringify(body) }).then(r => r.json());
fergus.length = 0; publishStatus = 200;
let p = await pub({ quoteId: 'fq55' });
check('the office can publish a quote it just pushed', p.ok === true && /fq55/.test(p.path.replace('{id}', 'fq55') + fergus[0].path), JSON.stringify(p));
fergus.length = 0; publishStatus = 404;
p = await pub({ quoteId: 'fq56' });
check('when Fergus answers nothing 2xx, it says so rather than pretending', p.ok === false && p.attempts.length > 1, JSON.stringify(p.attempts));
fergus.length = 0; publishStatus = 403;
p = await pub({ quoteId: 'fq57' });
check('a rejected key is not hammered through every candidate path', p.ok === false && fergus.length === 1, fergus.length + ' calls');

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
