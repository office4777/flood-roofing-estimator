// Verify the new Send Job Pack tab + the tabbed Select Job modal.

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGE_ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto('file://' + path.resolve('floodroofing/frontend/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.querySelector('.app').style.display = '';
    document.getElementById('login-screen').style.display = 'none';
    if (!window.S.settings) window.S.settings = window.defaultSettings();

    // Seed a job + draw something on the canvases so the preview has
    // real content to capture.
    const jc = document.getElementById('jobClient'); if (jc) jc.value = 'R. Henry';
    const ja = document.getElementById('jobAddr');   if (ja) ja.value = '123 Test Rd, Whangarei';
    const jd = document.getElementById('jobDate');   if (jd) jd.value = '17/05/2026';

    // Draw on the roof canvas — a simple roof outline so the capture
    // isn't blank.
    const cv = document.getElementById('roofCanvas');
    if (cv){
      const ctx2 = cv.getContext('2d');
      ctx2.fillStyle = '#fafaf8'; ctx2.fillRect(0,0,cv.width,cv.height);
      ctx2.strokeStyle = '#0a1628'; ctx2.lineWidth = 3;
      ctx2.beginPath();
      ctx2.moveTo(150,400); ctx2.lineTo(450,150); ctx2.lineTo(750,400);
      ctx2.lineTo(750,520); ctx2.lineTo(150,520); ctx2.closePath();
      ctx2.stroke();
      ctx2.fillStyle = '#0099cc'; ctx2.font='bold 18px Inter'; ctx2.fillText('12.4 m', 450, 100);
    }
    const sc = document.getElementById('sheetCanvas');
    if (sc){
      const ctx3 = sc.getContext('2d');
      ctx3.fillStyle = '#ffffff'; ctx3.fillRect(0,0,sc.width,sc.height);
      ctx3.strokeStyle = '#0a1628'; ctx3.lineWidth = 1.5;
      for (let i=0; i<8; i++){
        ctx3.strokeRect(60 + i*100, 80, 90, 360);
      }
      ctx3.fillStyle = '#0a1628'; ctx3.font='bold 14px Inter';
      ctx3.fillText('Sheet plan: 8 × 3.9m', 60, 60);
    }

    // Seed order data so cut list + flashings show real content
    window.S.order = window.S.order || {};
    Object.assign(window.S.order, {
      jobNumber:'FR-1234', deliveryMode:'site', deliveryAddr:'123 Test Rd',
      colour:'Ironsand', pitch:'15', profile:'Trapezoidal 5-rib',
      product:'Colorsteel Maxam', underlay:'Thermakraft 215',
      screws:'12g × 65mm Tek', rivets:'200',
      dektites:'3× DK04, 1× DK08', ridging:'standard',
      gutter:'24m Quarter-round 125mm Ironsand + 3 downpipes',
      cutList:[
        {desc:'SHORT @ 3900mm', qty:8, length:3900},
        {desc:'LONG (orange) @ 7650mm', qty:5, length:7650},
        {desc:'LONG (blue) @ 7650mm', qty:3, length:7650},
      ],
      flashings:[
        {type:'Apron flashing', qty:2, faces:[{label:'Vertical', length:180},{label:'Top', length:120}], lineBreaks:'', notes:'90° bend', sketch:''},
        {type:'Ridge flashing', qty:1, faces:[{label:'Left slope', length:200},{label:'Right slope', length:200}], lineBreaks:'', notes:'', sketch:''}
      ],
      extras:'Need by Thursday — install Friday morning.'
    });
    // Also populate the order tab DOM so _collectOrderFromUI picks it up.
    function _set(id,v){var el=document.getElementById(id); if(el) el.value=v;}
    _set('orderJobNumber','FR-1234'); _set('orderColour','Ironsand');
    _set('orderPitch','15'); _set('orderProfile','Trapezoidal 5-rib');
    _set('orderDektites','3× DK04, 1× DK08');
    _set('orderGutter','24m Quarter-round 125mm Ironsand + 3 downpipes');
    _set('orderRivets','200');
    _set('orderExtras','Need by Thursday — install Friday morning.');

    window.gotoTab('jobpack');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v11_jobpack.png', fullPage: false });
  console.log('wrote redesign_v11_jobpack.png');

  // Show the tabbed Select Job modal as well
  await page.evaluate(() => {
    window.gotoTab('roof');
    window.openSelectJobModal();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'floodroofing/docs/redesign_v11_select_modal.png', fullPage: false });
  console.log('wrote redesign_v11_select_modal.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
