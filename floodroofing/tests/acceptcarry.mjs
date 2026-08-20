// Resolved from this file, so the suite runs from any checkout.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const b = await chromium.launch();
const results = [];
function check(n, ok, d){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// The quote exactly as the office SENT it: MAXAM steel, corrugate, no gutter,
// and both optional extra roofs ticked in.
const sent = () => ({
  ref:'FR-30011', client:'Mr Aiono', accepted:false,
  extraRoofs:[{name:'Veranda', price:2400},{name:'Garage', price:3900}],
  proposalOptions:{ extraRoofsSel:{ 0:true, 1:true }, steelGrade:'maxam', profile:'corrugate',
                    steelThickness:'40', gutterType:'none', disposal:'dispose' },
  baseGrade:'maxam',
  roofMapGeom:{ bbox:{minX:-40,minY:0,maxX:150,maxY:100}, roofs:[
    { name:'Main Roof', area:109.3, mode:'main',  idx:0, lines:[], gutters:[], pts:[[0,0],[100,0],[100,80],[0,80]] },
    { name:'Veranda',   area:7.9,   mode:'extra', idx:1, extraPos:0, lines:[], gutters:[], pts:[[-40,0],[-5,0],[-5,40],[-40,40]] },
    { name:'Garage',    area:11.3,  mode:'extra', idx:2, extraPos:1, lines:[], gutters:[], pts:[[110,60],[150,60],[150,100],[110,100]] },
  ]},
  options:[{id:'a',selected:true}],
  lineItems:[], total:0,
});

// Stand in for the backend: hold the stored quote, and run the REAL
// /q/:token/event apply-logic (lifted verbatim from server.js) over whatever
// the customer's browser posts. If the payload doesn't carry a choice, or the
// server refuses it, the store keeps the value the quote was SENT with —
// which is precisely the bug being tested for.
import { readFileSync } from 'node:fs';
const srv = readFileSync(DIR + '/../backend/server.js', 'utf8');
const applySrc = srv.split("    // Apply customer selections (only the safe, customer-controlled fields).")[1]
                    .split("    if (type === 'accepted')")[0];
const applySelections = new Function('quote', 'selections', 'if (!selections) return;' + applySrc.replace(/^\s*if \(selections\) \{/, '').replace(/\}\s*$/, ''));

async function run(){
  const store = { quote: sent() };
  const posts = [];
  const ctx = await b.newContext({ viewport:{width:1200,height:900} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request(), u = q.url();
    if (/\/q\/[^/]+\/event/.test(u)) {
      const body = JSON.parse(q.postData() || '{}');
      posts.push(body);
      try { applySelections(store.quote, body.selections); } catch(e){ console.log('APPLY ERR', e.message); }
      if (body.type === 'accepted') store.quote.accepted = { name: body.name, total: body.total, options: body.acceptedOptions };
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    }
    if (/\/q\//.test(u))
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ quote: store.quote, branding:{} })});
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.goto('file://'+DIR+'/index.html?q=tok&j=FR-30011');
  await pg.waitForTimeout(3000);
  return { ctx, pg, store, posts };
}

const { ctx, pg, store, posts } = await run();
check('the customer link opened', await pg.evaluate(() => !!window.__CUSTOMER_MODE));

// ── the customer changes their mind: drop the Veranda, take Zincalume,
//    5-Rib in 0.55, and add Marley Typhoon guttering with external brackets ──
await pg.evaluate(() => {
  _toggleProposalExtraRoof(0, false);
  _setProposalOption_grade('zincalume');
  _setProposalOption_profile('5rib');
  _setProposalOption_gutter('marley_typhoon');
  _setProposalOption_bracket('external');
  _setProposalOption_downpipes('yes');
});
await pg.waitForTimeout(1600);

const local = await pg.evaluate(() => JSON.parse(JSON.stringify(S.quote.proposalOptions)));
check('the customer\'s browser holds their new picks',
  local.steelGrade === 'zincalume' && local.profile === '5rib' && local.gutterType === 'marley_typhoon' && local.extraRoofsSel['0'] === false,
  JSON.stringify(local));

check('a spec change is actually posted to the office', posts.length > 0, posts.length + ' posts');
const last = posts[posts.length-1] || {};
check('…and the payload carries the spec, not just the option packages',
  !!(last.selections && last.selections.proposalOptions && last.selections.proposalOptions.steelGrade === 'zincalume'),
  JSON.stringify((last.selections||{}).proposalOptions || null));

// ── accept ──
await pg.evaluate(() => { try { _acceptQuoteFinalize('Mr Aiono'); } catch(e){ console.log('ACCEPT', e.message); } });
await pg.waitForTimeout(1800);

const st = store.quote.proposalOptions || {};
check('the office now holds the customer\'s STEEL GRADE, not the sent default',
  st.steelGrade === 'zincalume', 'stored: ' + st.steelGrade);
check('…their roof PROFILE', st.profile === '5rib', 'stored: ' + st.profile);
check('…the 0.55 gauge that 5-Rib forces', st.steelThickness === '55', 'stored: ' + st.steelThickness);
check('…their GUTTERING', st.gutterType === 'marley_typhoon', 'stored: ' + st.gutterType);
check('…their gutter BRACKETS', st.gutterBracket === 'external', 'stored: ' + st.gutterBracket);
check('…their DOWNPIPES', st.downpipes === 'yes', 'stored: ' + st.downpipes);
check('…and the roof they took OFF is off, with the one they kept still on',
  !st.extraRoofsSel['0'] && st.extraRoofsSel['1'] === true, JSON.stringify(st.extraRoofsSel));
check('the acceptance itself was recorded', !!store.quote.accepted, JSON.stringify(store.quote.accepted||null));
const accOpts = ((store.quote.accepted||{}).options)||[];
check('the accepted itemisation lists the roof they kept and not the one they dropped',
  accOpts.some(o=>/Garage/.test(o.title)) && !accOpts.some(o=>/Veranda/.test(o.title)),
  JSON.stringify(accOpts.map(o=>o.title)));
await pg.screenshot({ path: S+'/acceptcarry.png', fullPage:false });
await ctx.close();

// ── the server must not swallow a crafted payload ──
const junk = { quote: sent() };
applySelections(junk.quote, { proposalOptions: {
  steelGrade:'free', profile:'<script>', steelThickness:'999', gutterType:'gold',
  gutterBracket:'x', downpipes:'maybe', disposal:'burn',
  extraRoofsSel:{ 0:true, 7:true, '__proto__':true, 'abc':true, '-1':true }
}});
const j = junk.quote.proposalOptions;
check('a rubbish grade is refused and the quote keeps what it had',
  j.steelGrade === 'maxam' && j.profile === 'corrugate' && j.steelThickness === '40' && j.gutterType === 'none' && j.disposal === 'dispose',
  JSON.stringify(j));
check('roof ticks past the end of the job, and non-numeric keys, are dropped',
  Object.keys(j.extraRoofsSel).join(',') === '0', JSON.stringify(j.extraRoofsSel));
check('…without polluting the prototype', ({}).polluted === undefined && Object.getPrototypeOf({}).x === undefined);

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
