// The public pages agree with each other, and with the plan table the server
// enforces. They did not: the homepage sold Fergus and the schedule board on
// Business while pricing sold them on Team, Business was "unlimited" on one
// page and fifteen on the other, the setup-call page handed out "access
// codes" for a trial that is open, and the savings block said "past a
// thousand" over a table that said $800 to $1,300.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { readFileSync } from 'node:fs';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }
const read = f => readFileSync(_j(_ROOT, 'frontend', f), 'utf8');
const landing = read('landing.html'), pricing = read('pricing.html'), fergus = read('fergus.html'),
      ea = read('early-access.html'), signup = read('signup.html'), server = readFileSync(_j(_ROOT, 'backend', 'server.js'), 'utf8');
// A tier card, by its heading.
const card = (html, name) => { const i = html.indexOf('<h3>' + name + '</h3>'); return i < 0 ? '' : html.slice(i, html.indexOf('</div>\n', html.indexOf('</ul>', i))); };

// ── the plan table is the truth ──────────────────────────────────
const plans = /const PLANS = \{([\s\S]*?)\n\};/.exec(server)[1];
const row = k => /\b(\w+):\s*\{([^}]*)\}/g[Symbol.replace] && new RegExp(k + ':\\s*\\{([^}]*)\\}').exec(plans)[1];
check('the server sells Fergus and the schedule board on Team', /jms: true/.test(row('team')) && /schedule: true/.test(row('team')));
check('…and not on Trade', /jms: false/.test(row('solo')) && /schedule: false/.test(row('solo')));
// 2026-10-23: Business is off sale and Team carries everything it had, at
// five seats. The Business row stays for the businesses already on it.
check('…and Team carries the inbox and the domain now, at five seats', /seats: 5/.test(row('team')) && /inbox: true/.test(row('team')) && /domain: true/.test(row('team')));
check('…while Business is off sale but still resolves for those on it', /seats: 15/.test(row('business')) && /PLANS_ON_SALE = \['measure', 'solo', 'team'\]/.test(server));

// ── the homepage says the same ───────────────────────────────────
for (const [name, html] of [['homepage', landing], ['pricing page', pricing]]){
  const team = card(html, 'Team'), biz = card(html, 'Business'), trade = card(html, 'Trade');
  check('the ' + name + ' puts Fergus and the schedule board on Team',
    /Fergus/.test(team) && /schedule board/i.test(team), name);
  check('…and does not sell either as Business-only', !/<li>[^<]*Fergus[^<]*<\/li>/.test(biz) && !/<li>[^<]*[Ss]chedule board[^<]*<\/li>/.test(biz), biz.match(/<li>[^<]*<\/li>/g)?.join(' | ').slice(0, 200));
  check('…has no Business card any more', biz === '' && !/\$549/.test(html) && !/"name": "Business"/.test(html), name);
  check('…and sells Team with the inbox and the domain, Enterprise above five',
    /inbox/i.test(team) && /own domain/i.test(team) && /five|5 users|5 logins/i.test(team) && !/unlimited (users|logins|people)/i.test(team), name);
  check('…and gives Trade the notifications and the follow-up', /opens|Notifications/.test(trade) && /follow-up/i.test(trade), name);
  // No founding discount since 2026-10-23: one price per card, nothing struck through.
  check('…with one price on every card and no founding rate anywhere',
    /<div class="amt">\$149<\/div>/.test(trade) && /<div class="amt">\$299<\/div>/.test(team) &&
    !/class="was"/.test(html) && !/founding/i.test(html) && !/30%/.test(html) && !/(55|104|209|384)\.30/.test(html), name);
  check('…and states the trial as 3 real roofs or 30 days', /3 real roofs or 30 days/.test(html) && !/14 days|Fourteen days/.test(html), name);
  // Measure is sold (2026-09-19) — the homepage left it off until 2026-10-01.
  const measure = card(html, 'Measure');
  check('…and carries the Measure plan at $79, with merchant orders in it and no customer quotes',
    /<div class="amt">\$79<\/div>/.test(measure) && /class="off">[^<]*[Qq]uotes/.test(measure) && /<li>Merchant orders<\/li>/.test(measure), name);
  check('…in its structured data too', /"name": "Measure", "price": "79\.00"/.test(html), name);
}
check('nothing on the homepage says "unlimited users" or "unlimited logins"', !/unlimited (users|logins)/i.test(landing));

// ── the Fergus page ──────────────────────────────────────────────
check('the Fergus page puts the integration on Team', /Team plan and up/.test(fergus) && !/integration is on the Business plan/.test(fergus));
check('…and no longer says RoofMap has no scheduling', /Forward schedule board/.test(fergus) && !/Fergus handles scheduling/.test(fergus));

// ── trial and setup call, one story ──────────────────────────────
check('the setup-call page hands out no access codes and speaks of no batches', !/access code/i.test(ea) && !/batches/i.test(ea));
check('…is a request, and says when the reply comes', /Request my setup call/.test(ea) && /within one working day/.test(ea) && /<title>Request/.test(ea));
check('…and its form no longer asks roof volume, software or plan', !/eaVolume|eaSoftware|eaPlan/.test(ea));
check('those questions are asked inside the app instead, optionally', /aboutYouCard/.test(read('app.html')) && /app\.post\('\/auth\/about'/.test(server));
check('the sign-up page says what the trial is and what stays after it', /3 real roofs or 30 days of Team/.test(signup) && /stay yours/.test(signup) && !/14 days|Fourteen/.test(signup));
check('the trial really is Team', /trial:\s*\{[^}]*seats: 5[^}]*jms: true[^}]*schedule: true/.test(plans));
check('…and a new trial is 3 roofs or 30 days', /parseInt\(process\.env\.TRIAL_ROOFS == null \? '3'/.test(server) && /TRIAL_ROOF_DAYS = Number\(process\.env\.TRIAL_ROOF_DAYS \|\| 30\)/.test(server));
// Measure is sold: on the pricing page, in the JSON-LD, in the intro and
// on the app's billing screen. The server only ever refuses the checkout
// when STRIPE_PRICE_MEASURE is missing, and says so by name.
check('the Measure card is on the pricing page, at $79',
  /<div class="tier" data-plan="measure">[\s\S]{0,200}<h3>Measure<\/h3>/.test(pricing) && !/tier" hidden/.test(pricing) && /<div class="amt">\$79<\/div>/.test(card(pricing, 'Measure')));
check('…and its Offer is in the pricing JSON-LD', /"name": "Measure", "price": "79\.00"/.test(pricing) && !/"price": "55\.30"/.test(pricing));
check('…and the app\'s billing screen lists it like the other plans', /key: 'measure',[^\n]*name: 'Measure'/.test(read('app.html')) && !/key: 'measure',[^\n]*offered: true/.test(read('app.html')));
check('…and the server\'s Measure sends merchant orders but no customer quote', /quote: false/.test(row('measure')) && /order: true/.test(row('measure')) && /seats: 1/.test(row('measure')));
check('…while every other plan does both', ['solo', 'team', 'business', 'trial'].every(k => /quote: true/.test(row(k)) && /order: true/.test(row(k))));
check('…and the public intro names the three prices', /\$79, \$149 or \$299/.test(pricing) && /The three plans/.test(pricing) && !/four plans/.test(pricing));

// ── the savings comparison ───────────────────────────────────────
check('the savings block quotes the range its own table shows', /\$800 to \$1,300/.test(pricing) && !/past a thousand/.test(pricing));
check('…with the trace-it-yourself difference right above the table', pricing.indexOf('One honest difference before the table') < pricing.indexOf('<table class="data">') && pricing.indexOf('One honest difference') > 0);
check('…and answers what the trial holds, what stays after, and that the prices are a starting point',
  /What is in the trial\?/.test(pricing) && /when the trial ends\?/.test(pricing) && /starting point, not\s+your prices/.test(pricing));

// ── the product, under the opening ───────────────────────────────
const demoAt = landing.indexOf('<section class="demo"'), howAt = landing.indexOf('<section id="how">'), heroAt = landing.indexOf('<div class="hero">');
check('the homepage shows the product in motion straight under the opening',
  demoAt > heroAt && demoAt < howAt && /<video[\s\S]{0,400}roofmap-demo\.mp4/.test(landing.slice(demoAt, howAt)));
// Ours, from our own domain: no third-party embed to load, nothing tracking
// the visitor, and it still plays on the day Loom is down.
check('…and it is our own file, not an embed', !/loom\.com\/embed\//.test(landing) &&
  /src="\/media\/roofmap-demo\.mp4"/.test(landing));
check('…with a poster frame, so the block is not a black hole before it plays',
  /poster="\/media\/roofmap-demo-poster\.jpg"/.test(landing));
check('…and preload="none", so a phone on data pays for it only if it is watched',
  /preload="none"/.test(landing));
check('…with the six-minute walkthrough offered underneath for the detail', /loom\.com\/share\/57f969a8894c4e438dc30f7482058b7e/.test(landing) && /full six-minute walkthrough/.test(landing));
check('…as one job in four steps', ['Draw the roof', 'Generate the job pack', 'picks an option', 'Send the material order'].every(t => landing.slice(demoAt, howAt).includes(t)));

// ── the homepage leads with the cost, not the feature ─────────────
// "Map roofs faster" is a feature. The reason a roofer pays is the half-day
// lost measuring a job that went to someone else — so that is what the first
// screenful says, and this is here so it does not quietly drift back into
// feature-speak on the next edit.
const h1 = (/<h1>([\s\S]*?)<\/h1>/.exec(landing) || [])[1] || '';
const heroSub = (/<p class="hero-sub">([\s\S]*?)<\/p>/.exec(landing) || [])[1] || '';
check('the homepage opens on the roofs you DON\'T win, not on the software',
  /never going to win|you.ll never win|might never win/i.test(h1), h1.replace(/<[^>]+>/g, '').trim());
check('…and the first paragraph names what that costs — the drive, the time, the lost job',
  /half a day|drive/i.test(heroSub) && /someone else|never win/i.test(heroSub),
  heroSub.replace(/\s+/g, ' ').trim().slice(0, 120));
check('…before it says what to do instead', /aerial/i.test(heroSub) && /minutes/i.test(heroSub));
check('…and the search result says the same thing',
  /measuring|aerial/i.test((/<meta name="description" content="([^"]*)"/.exec(landing) || [])[1] || ''));

// ── the conflict of interest, answered where it is felt ───────────
// RoofMap Limited is its own company, but the roofer who runs it also runs a
// roofing business — so a careful subscriber goes straight to
// the privacy page before signing up. tests/adminblind.mjs is the enforcement
// (no admin route can return a job, a price or a homeowner); these pin that
// the answer is actually PRINTED, in both places somebody looks for it, and
// that it keeps the caveat rather than overclaiming.
const privacy = read('privacy.html');
check('the privacy policy answers the competing-roofer conflict in its own section',
  /id="roofer"/.test(privacy) && /run by a roofer/i.test(privacy));
check('…says plainly that nobody there can open a subscriber\'s work',
  /nobody here can open your jobs/i.test(privacy));
check('…backs it with the support tools, not with a promise about manners',
  /do not show a\s+single job/i.test(privacy) && /fails the build/i.test(privacy));
check('…and keeps the caveat about database access instead of overclaiming',
  /will not dress up/i.test(privacy) && /restore a backup/i.test(privacy));
check('the pricing page answers it too, where the doubt actually forms',
  /Can you see my jobs and my prices\?/.test(pricing) && /privacy#roofer/.test(pricing));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
