// A 5 MB app.html off file:// is not a 30-second page load — except on a CI
// runner with four shards competing for it, where it is, and Playwright's
// DEFAULT navigation timeout is exactly 30 s. `roofmenu` died at 30.4 s on a
// main run (2026-10-20) with nothing but `TimeoutError` to show for it, and a
// red main skips the promote, so one slow page load held a whole ship.
//
// Raising it in 200 goto calls across 100 suites is 200 chances to fumble an
// edit; this is the one place every suite already passes through. run.mjs
// preloads it with --require, so `playwright` is patched before any suite's
// own import of it binds a name.
//
// ONLY THE NAVIGATION TIMEOUT. The action timeout is left alone deliberately:
// waiting longer for a page to arrive costs nothing on a green run, while
// waiting longer for a button that will never appear just makes a real
// failure slower to find.
try {
  const pw = require('playwright');
  const NAV_MS = parseInt(process.env.TEST_NAV_TIMEOUT_MS || '', 10) || 90000;
  const arm = (o) => { try { o.setDefaultNavigationTimeout(NAV_MS); } catch (e) {} return o; };
  ['chromium', 'firefox', 'webkit'].forEach((name) => {
    const bt = pw[name];
    if (!bt || typeof bt.launch !== 'function') return;
    const launch = bt.launch.bind(bt);
    bt.launch = async function (...a) {
      const b = await launch(...a);
      const newContext = b.newContext.bind(b);
      b.newContext = async function (...c) { return arm(await newContext(...c)); };
      const newPage = b.newPage.bind(b);
      b.newPage = async function (...c) { return arm(await newPage(...c)); };
      return b;
    };
  });
} catch (e) { /* no playwright in this process — the server suites */ }
