// A roofing business that doesn't run Fergus (or any JMS) must get an app
// that reads as complete — not one studded with buttons that error at them.
// html.no-jms is the switch; _jmsLinked() keeps it honest. Settings keeps
// the linking CTA, because that's where linking lives.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const _ROOT = _j(_d(_f(import.meta.url)), '..');

import { chromium } from 'playwright';
const S = process.env.SCRATCH || _j(_ROOT, '..', '.test-artifacts');
const DIR = _j(_ROOT, 'frontend');
const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

const b = await chromium.launch();
async function boot(linked){
  const ctx = await b.newContext({ viewport:{width:1500,height:1000} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  pg.on('dialog', d => d.accept());
  const counts = { fergus: 0 };
  await pg.route('**/flood-roofing-estimator-production.up.railway.app/**', r => {
    // Fergus endpoints must FAIL, or the app concludes Fergus is connected
    // and the unlinked case can't be tested at all.
    if (/fergus/i.test(r.request().url())){
      counts.fergus++;
      return r.fulfill({status:502,contentType:'application/json',body:'{"error":"no fergus"}'});
    }
    r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await pg.addInitScript((lk) => {
    localStorage.setItem('fr_token','t'); localStorage.setItem('fr_setup_done','1'); /* the first-run setup guide is modal — opt out unless the suite is about it */ localStorage.setItem('fr_settings','null');
    if (lk) localStorage.setItem('fr_jms_linked','1'); else { localStorage.removeItem('fr_jms_linked'); localStorage.removeItem('fr_jms'); }
  }, linked);
  await pg.goto('file://'+DIR+'/app.html');
  await pg.waitForTimeout(2500);
  return { ctx, pg, counts };
}
// The element's OWN computed display — what the jms-only rule controls —
// not its layout box, which is 0 for anything on a non-active tab.
const visible = (pg, sel) => pg.evaluate(s => {
  const els = [...document.querySelectorAll(s)];
  if (!els.length) return 'absent';
  return els.some(e => getComputedStyle(e).display !== 'none') ? 'visible' : 'hidden';
}, sel);

// ── with nothing linked ───────────────────────────────────────────
let { ctx, pg, counts } = await boot(false);
let v = await pg.evaluate(() => document.documentElement.classList.contains('no-jms'));
check('the app knows no JMS is linked', v === true);

// A fresh account never probes a JMS it hasn't picked — the boot
// auto-connect used to fire for everyone, and with the key being global
// it CONNECTED, showing one business's Fergus jobs to another.
check('a fresh account fires zero Fergus requests at boot', counts.fergus === 0, counts.fergus + ' calls');
// The dropdown and the Configure modal read the same state: None. They
// used different fallbacks, so a new account's dropdown said "Fergus"
// while Configure insisted no JMS was picked.
v = await pg.evaluate(() => ({
  sel: (document.getElementById('jmsSelect')||{}).value,
  prov: _jmsProvider(),
}));
check('the JMS dropdown starts on None and matches _jmsProvider',
  v.sel === 'none' && v.prov === 'none', JSON.stringify(v));

check('Quote: no "Push pricing to Fergus"', await visible(pg, 'button[onclick^="pushQuotePricingToFergus"]') === 'hidden');
await pg.evaluate(() => gotoTab('materials'));
await pg.waitForTimeout(700);
check('Job Pack: no "Push to Fergus" / "Open in Fergus"',
  await visible(pg, 'button[onclick^="pushJobPackToFergus"]') === 'hidden' &&
  await visible(pg, 'button[onclick^="openFergusJob"]') === 'hidden' &&
  await visible(pg, 'button[onclick^="pushMaterialsToFergus"]') === 'hidden');

await pg.evaluate(() => gotoTab('roof'));
await pg.waitForTimeout(700);
check('Map Roof: no "Import from Fergus" on the upload zone',
  await visible(pg, 'button[onclick*="openFergusPhotoPicker"]') === 'hidden');
v = await pg.evaluate(() => document.querySelector('.uz-sub').textContent);
check('…and the drop hint doesn\'t assume a Fergus tab', !/Fergus/.test(v), v);

// the photos side panel: job photos + files remain, the Fergus section goes
await pg.evaluate(() => _fergusPanelOpen(true));
await pg.waitForTimeout(500);
v = await pg.evaluate(() => {
  const panel = document.getElementById('fergusRoofPanel');
  const vis = s => { const e = panel.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
  return {
    jobPhotos: vis('#jobPhotosSec'),
    files: vis('.jobFilesList'),
    fergusGrid: vis('#fergusRoofPhotoScroll'),
    fergusLabel: /Fergus job photos/.test(panel.innerText),
    close: vis('button[onclick^="_fergusPanelClose"]'),
  };
});
check('the photos panel keeps job photos, files and its close button',
  v.jobPhotos && v.files && v.close, JSON.stringify(v));
check('…but carries nothing labelled Fergus', !v.fergusGrid && !v.fergusLabel, JSON.stringify(v));
await pg.screenshot({ path: S + '/nojms_photos.png' });

// Select Job: lands on saved jobs, offers no Fergus tab
await pg.evaluate(() => openSelectJobModal('fergus'));
await pg.waitForTimeout(700);
v = await pg.evaluate(() => ({
  ferg: getComputedStyle(document.getElementById('selectJobFergBtn')).display !== 'none',
  localOn: document.querySelector('#selectJobModal .tab-row .tab-sm.on') === document.querySelector('#selectJobModal .tab-row .tab-sm'),
}));
check('Select Job lands on saved jobs with no Fergus tab', !v.ferg && v.localOn, JSON.stringify(v));

// Settings still offers the way IN
await pg.evaluate(() => { try{ document.getElementById('selectJobOverlay').style.display='none'; document.getElementById('selectJobModal').style.display='none'; }catch(e){} gotoTab('settings'); });
await pg.waitForTimeout(600);
check('Settings still carries the big "link your JMS" invitation',
  await visible(pg, '#jmsBigLinkCard') === 'visible');
// …and clicking it lands on a PICKER, not a "pick one first" dead end.
await pg.evaluate(() => _openJmsLink());
await pg.waitForTimeout(400);
v = await pg.evaluate(() => ({
  title: document.getElementById('jmsSetupTitle').textContent,
  picker: !!document.getElementById('jmsSetupPick') &&
    getComputedStyle(document.getElementById('jmsSetupNone')).display !== 'none',
}));
check('…whose dialog offers the JMS picker itself',
  v.picker && /Link your job management/i.test(v.title), JSON.stringify(v));
await ctx.close();

// ── with Fergus linked, everything comes back ─────────────────────
({ ctx, pg, counts } = await boot(true));
v = await pg.evaluate(() => document.documentElement.classList.contains('no-jms'));
check('linking flips the switch back', v === false);
// A browser that linked Fergus before the picker existed carries only the
// linked flag — it must keep auto-connecting.
check('…and a legacy linked browser still auto-connects', counts.fergus > 0, counts.fergus + ' calls');
check('…and the Fergus buttons return', await visible(pg, 'button[onclick^="pushQuotePricingToFergus"]') === 'visible');
await pg.evaluate(() => _fergusPanelOpen(true));
await pg.waitForTimeout(400);
v = await pg.evaluate(() => {
  const panel = document.getElementById('fergusRoofPanel');
  return /Fergus job photos/.test(panel.textContent);
});
check('…including the Fergus photos section in the side panel', v === true);
await ctx.close();

await b.close();
const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
