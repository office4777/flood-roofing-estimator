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

const state = {
  company: { id:'co1', name:'Flood Roofing', slug:'floodroofing' },
  me: { id:'u1', role:'owner' },
  members: [
    { id:'u1', role:'owner',  name:'Aaron', email:'aaron@floodroofing.co.nz', you:true },
    { id:'u2', role:'member', name:'Ethan', email:'ethan@floodroofing.co.nz', you:false },
  ],
  invites: [{ id:'inv1', email:'matt@floodroofing.co.nz', role:'member' }],
  domains: [],
  plan: { id:'team', label:'Team', seats:{ used:3, allowed:5 }, slug:true, domain:false, jms:false },
};
const calls = [];
async function open(role){
  state.me.role = role;
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    const q = r.request(), u = q.url(), m = q.method();
    const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if (/\/team\/slug-available/.test(u)){
      const slug = new URL(u).searchParams.get('slug');
      return j({ slug, ok: slug !== 'acmeroofing' && /^[a-z0-9-]{3,30}$/.test(slug), reason: slug === 'acmeroofing' ? 'taken' : '' });
    }
    if (/\/team\/slug$/.test(u) && m === 'POST'){ calls.push({u,m,body:q.postDataJSON()}); state.company.slug = q.postDataJSON().slug; return j({ ok:true, slug: state.company.slug }); }
    if (/\/team\/invites\/[^/]+$/.test(u) && m === 'DELETE'){ calls.push({u,m}); state.invites = []; return j({ok:true}); }
    if (/\/team\/invites$/.test(u) && m === 'POST'){
      calls.push({u,m,body:q.postDataJSON()});
      return j({ invite:{ id:'inv2', email:q.postDataJSON().email }, link:'https://roofmap.co.nz/?invite=abc', emailed: !q.postDataJSON().email.includes('nomail') });
    }
    if (/\/team\/members\/[^/]+\/role/.test(u)){ calls.push({u,m,body:q.postDataJSON()}); return j({ok:true}); }
    if (/\/team\/members\//.test(u) && m === 'DELETE'){ calls.push({u,m}); state.members = state.members.filter(x=>!u.endsWith(x.id)); return j({ok:true}); }
    if (/\/team\/domains\/[^/]+\/verify/.test(u)){ calls.push({u,m});
      state.domains[0].status = 'verified'; state.domains[0].verified_at = '2026-08-19T00:00:00Z';
      return j({ domain: state.domains[0] }); }
    if (/\/team\/domains\/[^/]+$/.test(u) && m === 'DELETE'){ calls.push({u,m}); state.domains = []; return j({ok:true}); }
    if (/\/team\/domains$/.test(u) && m === 'POST'){ calls.push({u,m,body:q.postDataJSON()});
      state.domains = [{ id:'dom1', domain:'quote.acmeroofing.co.nz', status:'pending',
        dns:{ type:'CNAME', name:'quote', value:'cname.vercel-dns.com' }, verification:[] }];
      return j({ domain: state.domains[0] }); }
    if (/\/team\/domains$/.test(u)) return j({ enabled: state.domainsEnabled !== false, domains: state.domains || [] });
    if (/\/team$/.test(u)) return j(state);
    if (/\/settings/.test(u) && m === 'GET') return j({ user_id:'u1', quote_defaults:{}, branding:{ company_name:'Flood Roofing LTD' }, jms_keys:{} });
    return j([]);
  });
  await pg.addInitScript(() => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_settings','null');
    localStorage.setItem('fr_company', JSON.stringify({ id:'co1', name:'Flood Roofing', slug:'floodroofing', role:'owner' }));
  });
  await pg.goto('file://'+DIR+'/index.html');
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { gotoTab('settings'); switchSettingsSub('set-team', document.querySelector('[onclick*="set-team"]')); loadTeam(); });
  await pg.waitForTimeout(900);
  return { ctx, pg };
}

// ── owner ──
let { ctx, pg } = await open('owner');
let t = await pg.evaluate(() => (document.getElementById('teamWrap').textContent||'').replace(/\s+/g,' '));
check('the Team screen lists everyone in the business', /Aaron/.test(t) && /Ethan/.test(t) && /2 people/.test(t), t.slice(0,120));
check('…marks which one is you', /Aaron \(you\)/.test(t));
check('…shows the pending invitation', /matt@floodroofing\.co\.nz/.test(t) && /Invitations waiting/.test(t));
check('…and the business\'s RoofMap address', /floodroofing\.roofmap\.co\.nz/.test(t));
check('…and says which plan they are on and how many seats are left',
  /Team/.test(t) && /3 of 5 seats used/.test(t), t.slice(0, 60));
// A business that has filled its plan is told before it tries to add someone.
await pg.evaluate(() => { TEAM.plan = { id:'solo', label:'Solo', seats:{ used:1, allowed:1 }, slug:false, domain:false, jms:false }; renderTeam(); });
await pg.waitForTimeout(250);
check('…and a full plan says so up front, not at the moment they try',
  /Every seat is taken/.test(await pg.evaluate(() => document.getElementById('teamWrap').textContent)));
await pg.evaluate(() => { TEAM.plan = { id:'team', label:'Team', seats:{ used:3, allowed:5 }, slug:true, domain:false, jms:false }; renderTeam(); });
await pg.waitForTimeout(250);
await pg.locator('#set-team').screenshot({ path: S+'/team_owner.png' });

// the quote link is built from the slug
let link = await pg.evaluate(() => {
  S.quote = { share:{ token:'tok9' }, ref:'06121' };
  var jc = document.getElementById('jobClient'); if (jc) jc.value = 'Mrs Hale';
  return _customerLinkString();
});
check('customer quote links use the business\'s RoofMap address',
  link.startsWith('https://floodroofing.roofmap.co.nz/?q=tok9'), link);
link = await pg.evaluate(() => {
  S.settings = S.settings || {};
  S.settings.quote_defaults = { quote_domain: 'https://quote.floodroofing.co.nz' };
  return _customerLinkString();
});
check('…unless the business has its own domain, which still wins',
  link.startsWith('https://quote.floodroofing.co.nz/?q='), link);
await pg.evaluate(() => { S.settings.quote_defaults = {}; });

// availability check
await pg.fill('#teamSlug', 'acmeroofing');
await pg.waitForTimeout(800);
check('an address another business has is called out',
  /already has that address/.test(await pg.evaluate(() => document.getElementById('teamSlugMsg').textContent)));
await pg.fill('#teamSlug', 'floodroofingnz');
await pg.waitForTimeout(800);
check('…and a free one is confirmed with the full address',
  /floodroofingnz\.roofmap\.co\.nz is free/.test(await pg.evaluate(() => document.getElementById('teamSlugMsg').textContent)));
await pg.click('#teamWrap button[onclick^="saveTeamSlug"]');
await pg.waitForTimeout(700);
check('saving the address posts it', calls.some(c => /\/team\/slug$/.test(c.u) && c.body.slug === 'floodroofingnz'), JSON.stringify(calls.map(c=>c.u.split('/').pop())));
check('…and quote links follow it immediately',
  (await pg.evaluate(() => _customerLinkString())).startsWith('https://floodroofingnz.roofmap.co.nz/?q='),
  await pg.evaluate(() => _customerLinkString()));

// inviting
await pg.fill('#teamInviteEmail', 'matt2@floodroofing.co.nz');
await pg.click('#teamWrap button[onclick^="inviteTeamMember"]');
await pg.waitForTimeout(900);
check('inviting posts the email and role',
  calls.some(c => /invites$/.test(c.u) && c.body.email === 'matt2@floodroofing.co.nz' && c.body.role === 'member'),
  JSON.stringify(calls.filter(c=>/invites$/.test(c.u)).map(c=>c.body)));
check('…and confirms it was emailed',
  /Invitation emailed/.test(await pg.evaluate(() => (document.getElementById('teamInviteOut')||{}).textContent || '')));
await pg.fill('#teamInviteEmail', 'nomail@floodroofing.co.nz');
await pg.click('#teamWrap button[onclick^="inviteTeamMember"]');
await pg.waitForTimeout(900);
let out = await pg.evaluate(() => (document.getElementById('teamInviteOut')||{}).innerHTML || '');
check('when the email cannot be sent, the owner is handed the link instead',
  /Couldn.t send the email/.test(out) && /roofmap\.co\.nz\/\?invite=abc/.test(out), out.slice(0,110));

// roles + removal
await pg.selectOption('#teamWrap select[onchange*="setTeamRole"]', 'owner');
await pg.waitForTimeout(700);
check('a role change is posted', calls.some(c => /\/role$/.test(c.u) && c.body.role === 'owner'));
await pg.click('#teamWrap button[onclick^="removeTeamMember"]');
await pg.waitForTimeout(800);
check('removing a teammate is posted', calls.some(c => /members\/u2$/.test(c.u) && c.m === 'DELETE'));

// ── connecting your own domain ──
await pg.fill('#teamDomainInput', 'quote.acmeroofing.co.nz');
await pg.click('#teamWrap button[onclick^="addTeamDomain"]');
await pg.waitForTimeout(900);
let dt = await pg.evaluate(() => (document.getElementById('teamWrap').textContent||'').replace(/\s+/g,' '));
check('connecting a domain posts it', calls.some(c => /\/team\/domains$/.test(c.u) && c.body.domain === 'quote.acmeroofing.co.nz'));
check('…and the owner is shown the one DNS record to add',
  /Waiting for DNS/.test(dt) && /CNAME/.test(dt) && /cname\.vercel-dns\.com/.test(dt), dt.slice(dt.indexOf('Your own domain'), dt.indexOf('Your own domain')+220));
check('…and quote links do NOT move to it until it verifies',
  (await pg.evaluate(() => _customerLinkString())).indexOf('acmeroofing.co.nz') < 0,
  await pg.evaluate(() => _customerLinkString()));
await pg.locator('#set-team').screenshot({ path: S+'/team_domain_pending.png' });
await pg.click('#teamWrap button[onclick^="checkTeamDomain"]');
await pg.waitForTimeout(1000);
dt = await pg.evaluate(() => (document.getElementById('teamWrap').textContent||'').replace(/\s+/g,' '));
check('checking it flips to connected', /✓ Connected/.test(dt), dt.slice(dt.indexOf('Your own domain'), dt.indexOf('Your own domain')+200));
check('…and quote links move onto it', (await pg.evaluate(() => _customerLinkString())).startsWith('https://quote.acmeroofing.co.nz/?q='),
  await pg.evaluate(() => _customerLinkString()));
await pg.locator('#set-team').screenshot({ path: S+'/team_domain_ok.png' });
// a manual override must be called out rather than silently winning
await pg.evaluate(() => { S.settings = S.settings || {}; S.settings.quote_defaults = { quote_domain:'https://old.example.com' }; renderTeam(); });
await pg.waitForTimeout(300);
check('a manual quote-domain override is flagged, not left mysterious',
  /overrides everything here/.test(await pg.evaluate(() => document.getElementById('teamWrap').textContent)));
await pg.evaluate(() => { S.settings.quote_defaults = {}; renderTeam(); });

await ctx.close();

// ── member: same list, no controls ──
state.members = [
  { id:'u1', role:'owner',  name:'Aaron', email:'aaron@floodroofing.co.nz', you:false },
  { id:'u2', role:'member', name:'Ethan', email:'ethan@floodroofing.co.nz', you:true },
];
state.me = { id:'u2', role:'member' };
({ ctx, pg } = await open('member'));
const m = await pg.evaluate(() => {
  const w = document.getElementById('teamWrap');
  return { txt:(w.textContent||'').replace(/\s+/g,' '),
           invite: !!document.getElementById('teamInviteEmail'),
           remove: /Remove/.test(w.textContent||''),
           slugDisabled: (document.getElementById('teamSlug')||{}).disabled,
           domainInput: !!document.getElementById('teamDomainInput') };
});
check('a member sees the same team list', /Aaron/.test(m.txt) && /Ethan/.test(m.txt));
check('…but cannot invite, remove, or change the address',
  !m.invite && !m.remove && m.slugDisabled === true && !m.domainInput, JSON.stringify(m));
check('…and is told why', /Only an owner can add or remove people/.test(m.txt));
await pg.locator('#set-team').screenshot({ path: S+'/team_member.png' });
await ctx.close();

// ── the invite link itself ──
const ictx = await b.newContext({ viewport:{width:900,height:800} });
const ipg = await ictx.newPage();
ipg.on('pageerror', e => console.log('PAGEERROR', e.message));
let accepted = null;
await ipg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
  const q = r.request(), u = q.url();
  const j = (x) => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if (/\/auth\/invite\//.test(u)) return j({ email:'matt@floodroofing.co.nz', role:'member', company:'Flood Roofing' });
  if (/\/auth\/accept-invite/.test(u)){ accepted = q.postDataJSON();
    return j({ token:'t', user:{ id:'u9', email:'matt@floodroofing.co.nz' }, company:{ id:'co1', name:'Flood Roofing', slug:'floodroofing', role:'member' } }); }
  return j([]);
});
await ipg.goto('file://'+DIR+'/index.html?invite=abc123');
await ipg.waitForTimeout(2200);
let iv = await ipg.evaluate(() => ({
  shown: getComputedStyle(document.getElementById('login-invite-view')).display !== 'none',
  intro: document.getElementById('inv-intro').textContent,
  form: getComputedStyle(document.getElementById('inv-form')).display !== 'none',
}));
check('an invite link opens the join screen', iv.shown && iv.form, JSON.stringify(iv));
check('…naming the business and the email it was sent to',
  /Flood Roofing/.test(iv.intro) && /matt@floodroofing\.co\.nz/.test(iv.intro), iv.intro);
await ipg.screenshot({ path: S+'/team_invite.png' });
await ipg.fill('#inv-name', 'Matt');
await ipg.fill('#inv-pass', 'short');
await ipg.fill('#inv-pass2', 'short');
await ipg.click('#inv-btn');
await ipg.waitForTimeout(400);
check('a short password is refused before it reaches the server',
  accepted === null && /at least 8/.test(await ipg.evaluate(() => document.getElementById('login-err').textContent)));
await ipg.fill('#inv-pass', 'a-good-password');
await ipg.fill('#inv-pass2', 'a-different-one');
await ipg.click('#inv-btn');
await ipg.waitForTimeout(400);
check('…so is a mismatch', accepted === null && /don.t match/.test(await ipg.evaluate(() => document.getElementById('login-err').textContent)));
await ipg.fill('#inv-pass2', 'a-good-password');
await ipg.click('#inv-btn');
await ipg.waitForTimeout(900);
check('accepting posts the token and password', accepted && accepted.token === 'abc123' && accepted.name === 'Matt', JSON.stringify(accepted));
iv = await ipg.evaluate(() => ({
  app: getComputedStyle(document.querySelector('.app')).display !== 'none',
  login: getComputedStyle(document.getElementById('login-screen')).display === 'none',
  co: JSON.parse(localStorage.getItem('fr_company')||'{}'),
}));
check('…and lands them in the app, in the business that invited them',
  iv.app && iv.login && iv.co.slug === 'floodroofing' && iv.co.role === 'member', JSON.stringify(iv));
await ictx.close();

await b.close();
const bad = results.filter(x=>!x).length;
console.log('\n'+(results.length-bad)+'/'+results.length+' passed');
process.exit(bad?1:0);
