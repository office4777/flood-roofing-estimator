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
check('…with fifteen seats on Business and the inbox only there', /seats: 15/.test(row('business')) && /inbox: true/.test(row('business')) && /inbox: false/.test(row('team')));

// ── the homepage says the same ───────────────────────────────────
for (const [name, html] of [['homepage', landing], ['pricing page', pricing]]){
  const team = card(html, 'Team'), biz = card(html, 'Business'), trade = card(html, 'Trade');
  check('the ' + name + ' puts Fergus and the schedule board on Team',
    /Fergus/.test(team) && /schedule board/i.test(team), name);
  check('…and does not sell either as Business-only', !/<li>[^<]*Fergus[^<]*<\/li>/.test(biz) && !/<li>[^<]*[Ss]chedule board[^<]*<\/li>/.test(biz), biz.match(/<li>[^<]*<\/li>/g)?.join(' | ').slice(0, 200));
  check('…caps Business at fifteen, with Enterprise above', /15|fifteen/.test(biz) && !/unlimited (users|logins|people)/i.test(biz), name);
  check('…and gives Trade the notifications and the follow-up', /opens|Notifications/.test(trade) && /follow-up/i.test(trade), name);
  check('…with both prices on every card: the founding rate and what it goes to',
    /\$104\.30[\s\S]{0,120}\$149/.test(trade) && /\$209\.30[\s\S]{0,120}\$299/.test(team) && /\$384\.30[\s\S]{0,120}\$549/.test(biz), name);
  check('…and says yearly is instead of the 30%, not on top', /one or the other, not both/.test(html), name);
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
check('the sign-up page says what the trial is and what stays after it', /14 days of Team/.test(signup) && /stay yours/.test(signup));
check('the trial really is Team', /trial:\s*\{[^}]*seats: 5[^}]*jms: true[^}]*schedule: true/.test(plans));

// ── the savings comparison ───────────────────────────────────────
check('the savings block quotes the range its own table shows', /\$800 to \$1,300/.test(pricing) && !/past a thousand/.test(pricing));
check('…with the trace-it-yourself difference right above the table', pricing.indexOf('One honest difference before the table') < pricing.indexOf('<table class="data">') && pricing.indexOf('One honest difference') > 0);
check('…and answers what the trial holds, what stays after, and that the prices are a starting point',
  /What is in the trial\?/.test(pricing) && /when the trial ends\?/.test(pricing) && /starting point, not\s+your prices/.test(pricing));

// ── the product, under the opening ───────────────────────────────
const demoAt = landing.indexOf('<section class="demo"'), howAt = landing.indexOf('<section id="how">'), heroAt = landing.indexOf('<div class="hero">');
check('the homepage shows the product in motion straight under the opening',
  demoAt > heroAt && demoAt < howAt && /loom\.com\/embed\//.test(landing.slice(demoAt, howAt)));
check('…and it is the 90-second one, not the six-minute walkthrough', /loom\.com\/embed\/cb3a3197f06d46e98e1c76261cc1fa51/.test(landing));
check('…with the six-minute walkthrough offered underneath for the detail', /loom\.com\/share\/57f969a8894c4e438dc30f7482058b7e/.test(landing) && /full six-minute walkthrough/.test(landing));
check('…as one job in four steps', ['Draw the roof', 'Generate the job pack', 'picks an option', 'Send the material order'].every(t => landing.slice(demoAt, howAt).includes(t)));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
