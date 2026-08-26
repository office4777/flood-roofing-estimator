// The content of the guide library. Prose here, layout in build-guides.mjs.
//
// Sourcing rule, and it is not negotiable: everything on these pages comes
// either from the Roofing entries in frontend/help-bot.js — written by a
// roofer who does this work — or from arithmetic that has been run and
// checked. Nothing is invented to fill a table. Where a number depends on the
// job, the page says what it depends on instead of picking one that would be
// wrong half the time.
//
// Every multiplier in the pitch tables below was generated from
// 1/cos(pitch) and sqrt(1 + tan²(pitch)/2) and rounded, not typed from
// memory.
const REVIEWED = '26 August 2026';
const DATE = '2026-08-26';

const NEXT_APP = [
  { href: '/features/roof-measuring', title: 'Measuring it without a ladder',
    blurb: 'Trace the roof over an aerial and let the pitch arithmetic happen by itself.' },
  { href: '/features/job-pack', title: 'The counts, done for you',
    blurb: 'Sheets by run length, flashings piece by piece, back-trays included.' },
  { href: '/guides', title: 'The rest of the guides',
    blurb: 'Flashings, sheet lengths, pitch, steel grades — the estimating knowledge, written down.' },
];

const base = {
  published: DATE, modified: DATE, reviewed: REVIEWED,
  eyebrow: 'Guide',
};

// ─────────────────────────────────────────────────────────────────────
const GUIDES_INDEX = {
  file: 'guides.html',
  url: '/guides',
  kind: 'index',
  eyebrow: 'Guides',
  title: 'Roofing estimating guides for NZ roofers',
  description: 'Flashings, sheet lengths, roof pitch and steel grades — how a New Zealand roof is measured and priced, written by roofers who do it.',
  h1: 'Roofing estimating guides',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }],
  stand: `How a New Zealand roof is actually measured, counted and priced — the arithmetic,
    the trade vocabulary, and the parts that cost people money when they get them wrong.`,
  answer: `<strong>These guides cover the estimating side of long-run steel roofing in New
    Zealand:</strong> what each flashing is and where it goes, how sheet lengths and counts are
    worked out, what pitch changes and by how much, and how the steel grades differ once you are
    near the coast. They are written by a working roofing company, and every figure in them has
    been checked.`,
  items: [
    { url: '/guides/how-to-quote-a-re-roof', title: 'How to quote a re-roof',
      blurb: 'The whole method end to end — measure, count, price, and write the scope that protects you.' },
    { url: '/guides/roof-flashings-explained', title: 'Roof flashings explained',
      blurb: 'Ridge, hip, valley, barge, apron and change-of-pitch: what each one does and where it goes.' },
    { url: '/guides/calculating-sheet-lengths', title: 'Calculating sheet lengths and counts',
      blurb: 'Run length, cover width, overhang and laps — the arithmetic behind a cut list.' },
    { url: '/guides/roof-pitch-explained', title: 'Roof pitch explained',
      blurb: 'Degrees, ratios, and every single length on the roof that pitch quietly changes.' },
    { url: '/guides/colorsteel-grades-compared', title: 'Colorsteel grades compared',
      blurb: 'MAXAM, ColorCote, ColorZen and Zincalume — and how far from the sea each one belongs.' },
    { url: '/guides/coastal-zones-and-warranties', title: 'Coastal zones and warranties',
      blurb: 'Establishing the zone for a real address, and the details that void a warranty after it is written.' },
    { url: '/guides/flashing-wastage', title: 'Flashing wastage, done per piece',
      blurb: 'Why a flat percentage over-allows on the easy roof and under-allows on the hard one.' },
    { url: '/guides/pipe-flashings-and-back-trays', title: 'Pipe flashings and back-trays',
      blurb: 'Dektites, trays and the five-piece boxed set — the items that go missing off a docket.' },
    { url: '/guides/re-roof-scope-of-work', title: 'Writing a re-roof scope of work',
      blurb: 'What to include, and the exclusions that are the half protecting you.' },
  ],
  tools: [
    { url: '/tools/roof-pitch-calculator', title: 'Roof pitch calculator',
      blurb: 'Degrees to ratio, and the multipliers for rafters, hips and valleys.' },
    { url: '/tools/roofing-sheet-calculator', title: 'Roofing sheet calculator',
      blurb: 'Face size and pitch in, sheet length and count out.' },
  ],
  get body(){
    const card = i => `      <a class="next-card" href="${i.url}"><b>${i.title}</b><span>${i.blurb}</span></a>`;
    return `      <h2>The guides</h2>
      <p>Each one is the long version of a question that gets asked on site, written out properly
        rather than answered in a text message.</p>
      <div class="next-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
${this.items.map(card).join('\n')}
      </div>

      <h2>The calculators</h2>
      <p>Two working tools. Both explain their arithmetic on the page, so you can check the answer
        by hand rather than trusting a box.</p>
      <div class="next-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
${this.tools.map(card).join('\n')}
      </div>

      <h2>Who writes these</h2>
      <p>Flood Roofing Limited, a roofing company in Northland. RoofMap is the estimating software
        we built for our own jobs; these guides are the knowledge behind it, in plain form. If a
        figure here is wrong, we would rather hear about it than have it sit on the internet —
        <a href="mailto:support@roofmap.co.nz">support@roofmap.co.nz</a>.</p>`;
  },
  faq: [
    { q: 'Are these guides specific to New Zealand?',
      a: ['Yes. The profiles, the steel grades, the coastal corrosion zones, the warranty tiers and the vocabulary are all New Zealand. Metric throughout — millimetres and metres, square metres for area.',
          'The arithmetic — pitch factors, cover widths, sheet counts — is the same anywhere. The material and the environment are not.'] },
    { q: 'Do I need RoofMap to use them?',
      a: ['No. Everything in these guides can be done with a tape, a calculator and a pad, and for a century it was. The guides describe the method; the software just does it faster and does not forget the back-trays.'] },
    { q: 'How often are they reviewed?',
      a: ['Each guide carries the date it was last reviewed at the bottom of the page. Where a figure comes from a manufacturer — warranty terms, coating specifications — check the current published document before you rely on it in a quote, because those change and this page will not change with them.'] },
  ],
  faqHeading: 'About these guides.',
  next: [],
};

// ─────────────────────────────────────────────────────────────────────
const FLASHINGS = {
  ...base,
  file: 'guides-roof-flashings-explained.html',
  url: '/guides/roof-flashings-explained',
  kind: 'guide',
  title: 'Roof flashings explained: every type, NZ',
  description: 'Ridge, hip, valley, barge, apron, change-of-pitch and penetration flashings — what each one does, where it goes, and how to count them for an order.',
  h1: 'Roof flashings explained',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Roof flashings explained', url: '/guides/roof-flashings-explained' }],
  about: ['Roof flashing', 'Long-run steel roofing', 'New Zealand'],
  stand: `Every line on a roof is a flashing, and every flashing is a piece at a length. This is
    what each type does, where it goes, and how to count them so the order is right.`,
  answer: `<strong>A flashing is the folded steel that closes a join in a roof.</strong> Six cover
    the lines: <strong>ridge</strong> along the top, <strong>hip</strong> down each external
    corner, <strong>valley</strong> up each internal one, <strong>barge</strong> along a gable
    edge, <strong>apron</strong> where a roof meets a wall, and <strong>change-of-pitch</strong>
    where the slope breaks. Penetrations get their own set. Count them as pieces at lengths, never
    as a total in metres.`,
  body: `      <h2>The six line flashings</h2>
      <p>Draw a roof and every line you drew is a flashing, except the gutter line. Name them the
        same way every time and nothing gets missed:</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Flashing</th><th>Where it goes</th><th>What it is doing</th></tr></thead>
        <tbody>
          <tr><td><b>Ridge</b></td><td>The horizontal line at the top, where two slopes meet</td><td>Caps the open ends of the sheets on both sides and keeps water and wind-driven rain out of the gap</td></tr>
          <tr><td><b>Hip</b></td><td>The sloping line down an external corner, where two slopes meet outwards</td><td>Same job as a ridge, but on a diagonal — and every sheet arriving at it is cut on the rake</td></tr>
          <tr><td><b>Valley</b></td><td>The sloping line up an internal corner, where two slopes meet inwards</td><td>Carries water. It is the only flashing that is a drain, which is why it sits under the sheets rather than over them</td></tr>
          <tr><td><b>Barge</b></td><td>The raking edge of a gable</td><td>Closes the side of the roof, holds the sheet edge down, and finishes the line you actually see from the street</td></tr>
          <tr><td><b>Apron</b></td><td>Where a roof runs into a wall</td><td>Turns water back out onto the roof instead of down the wall junction. Needs a proper upstand behind the cladding</td></tr>
          <tr><td><b>Change-of-pitch</b></td><td>Where one slope breaks into another on the same run</td><td>Bridges two different angles in one fold — a verandah off a main roof, or a bullnose</td></tr>
        </tbody>
      </table>
      </div>

      <p>Two of those need a note. A <strong>valley</strong> is the one people under-order, because
        it is the longest single piece on most cut-up roofs and it is easy to forget it runs the
        full rake and then some. And a <strong>change-of-pitch</strong> is the one people forget
        exists at all until the sheets are up.</p>

      <h2>The penetration flashings</h2>
      <p>Anything coming through the roof needs flashing, and this is where orders go short.</p>
      <ul>
        <li><strong>Dektite</strong> — the moulded boot that seals around a round pipe: flue,
          vent, waste pipe. Sized by the pipe diameter.</li>
        <li><strong>Back-tray</strong> — a folded tray that sits behind the penetration, under
          the sheets, and takes the water around it. <strong>Every pipe penetration needs both.</strong>
          The tray is the item that is left off the docket and discovered on the roof.</li>
        <li><strong>Boxed penetration</strong> — a chimney, a skylight upstand, a boxed flue.
          That is <strong>five pieces, not one</strong>: a back flashing, two sides, a front apron,
          and a saddle running from the ridge down to the top of the box.</li>
      </ul>
      <p>If you take nothing else from this page: a back-tray for every dektite, and five pieces
        for every box.</p>

      <h2>Girth and folds — what the price is per</h2>
      <p>A flashing is priced off two things: its <strong>girth</strong>, which is the total
        developed width of the flat sheet before it is folded, and the number of
        <strong>folds</strong> or bends in it. Both come from the profile drawing, not from the
        finished appearance — a barge that shows 100 mm on the face might have a 300 mm girth once
        the return and the upstand are counted.</p>
      <p>The merchant folds and cuts to your schedule, so the schedule needs girth, folds, length
        and quantity for each type. A flashing described only by name and metres is not an order.</p>

      <h2>Count pieces, not metres</h2>
      <p>This is the whole point, and it is the thing that most often costs money.</p>
      <p>Write flashings as <code>1 @ 6.8 m</code>, <code>1 @ 3.7 m</code>, <code>2 @ 4.2 m</code>
        — quantities at lengths. Not <q>42 m of barge</q>. Forty-two metres of barge could be six
        pieces or fifteen, and the two orders cost different money and arrive as different steel.</p>
      <p>Then two counting rules:</p>
      <ul>
        <li><strong>A shared edge is one flashing.</strong> Where two roofs meet, that ridge or
          that apron belongs to the join, not to each roof. Counting it on both is the standard way
          a take-off comes out over.</li>
        <li><strong>Round up, per piece.</strong> Allow roughly 0.3 to 0.5 m on a run for laps and
          end trims, rounded up to the next 0.1 m, and allow it on <em>each piece</em>. A flat
          percentage on a total runs generous on a simple roof and short on a cut-up one, which is
          exactly the wrong way round.</li>
      </ul>

      <h2>Flashings and pitch</h2>
      <p>Anything that slopes is longer than it looks on a plan. Hips, valleys, barges and
        change-of-pitch flashings all need the pitch factor; ridges and gutters do not, because
        they are level.</p>
      <p>Hips and valleys need more care again, because they run diagonally as well as up: at 25°
        a rafter is 10.3 per cent longer than its plan length, but a hip on a square corner is only
        5.3 per cent longer than <em>its</em> plan length, since the diagonal already carries most
        of the distance. Applying the rafter factor to a hip over-orders it. There is a table of
        both in <a href="/guides/roof-pitch-explained">roof pitch explained</a>.</p>

      <h2>Where flashings meet other trades</h2>
      <p>Two items sit next to flashings and are worth naming in the scope so nobody assumes:</p>
      <ul>
        <li><strong>Fascia and soffit.</strong> The fascia is the board the gutter fixes to; the
          soffit is the lining underneath. Neither is a flashing, and neither is included unless
          you say so.</li>
        <li><strong>Ventilation.</strong> Ridge vents and eave intake manage condensation under
          steel. If the roof needs venting, it is a scope line and often a flashing line as well.</li>
      </ul>`,
  faq: [
    { q: 'What is the difference between a hip and a valley?',
      a: ['They are the same line seen from opposite sides. A hip is where two slopes meet pointing outwards, so it sheds water away from the join. A valley is where they meet pointing inwards, so it collects water and has to carry it.',
          'That difference is why a valley goes <em>under</em> the sheets and a hip goes <em>over</em> them, and why a valley is the flashing you never skimp on.'] },
    { q: 'Do I need a back-tray behind every dektite?',
      a: ['Yes. The dektite seals the pipe; the back-tray takes the water that runs down the roof and steers it around the penetration before it reaches the boot.',
          'It is the single most-forgotten item on a roofing order, because the drawing shows the pipe and the docket shows the dektite, and the tray is only obvious once you are on the roof with the sheets up.'] },
    { q: 'How much extra should I allow on a flashing run?',
      a: ['Roughly 0.3 to 0.5 m per run for laps and end trims, rounded up to the next 0.1 m — allowed per piece, not as a percentage of a total.',
          'A percentage gives a simple roof more than it needs and a cut-up roof less, because a cut-up roof has more joins per metre. That is the opposite of what you want.'] },
    { q: 'What is a change-of-pitch flashing?',
      a: ['A flashing folded to bridge two different angles where one slope breaks into another on the same run — a verandah coming off a main roof, or a bullnose.',
          'It is specified by the two pitches it joins, so it cannot be ordered as a standard fold. Measure both pitches on site.'] },
    { q: 'Why is my flashing quote so much more than the metre rate suggested?',
      a: ['Because the metre rate depends on girth and folds. A wide flashing with five bends is a different product from a narrow one with two, even though both are sold by the lineal metre.',
          'Check the girth on the profile drawing before comparing rates. A flashing that shows 100 mm on the face can easily have a 300 mm girth.'] },
  ],
  next: NEXT_APP,
};

// ─────────────────────────────────────────────────────────────────────
const SHEETS = {
  ...base,
  file: 'guides-calculating-sheet-lengths.html',
  url: '/guides/calculating-sheet-lengths',
  kind: 'guide',
  title: 'Calculating roofing sheet lengths and counts',
  description: 'How to work out long-run steel sheet lengths and quantities: run length at the pitch, overhang, cover width versus sheet width, and where the count goes wrong.',
  h1: 'Calculating sheet lengths and counts',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Calculating sheet lengths', url: '/guides/calculating-sheet-lengths' }],
  about: ['Roof estimating', 'Long-run steel roofing', 'New Zealand'],
  stand: `Long-run steel is cut to length, so what you are ordering is a set of lengths and
    quantities — not an area. Here is how both numbers are worked out, and the two places they
    go wrong.`,
  answer: `<strong>Sheet length is the plan run from ridge to gutter, multiplied by the pitch
    factor <code>1 / cos(pitch)</code>, plus the overhang into the gutter, rounded up.</strong>
    Sheet count is the face width divided by the profile's <strong>cover width</strong> — not its
    sheet width — rounded up. On corrugate, cover is 762 mm against a nominal 860 mm sheet, and
    using the wrong one leaves you short by about one sheet in nine.`,
  body: `      <h2>The two numbers</h2>
      <p>Every roof face reduces to a length and a count. Do those per face, then group identical
        lengths together for the order.</p>

      <h2>1. Sheet length</h2>
      <p>Start with the <strong>plan run</strong>: the horizontal distance from the ridge line to
        the gutter line, measured on the flat. Then:</p>
      <ol>
        <li>Multiply by the pitch factor, <code>1 / cos(pitch)</code>, to get the true slope length</li>
        <li>Add the <strong>overhang</strong> into the gutter — typically 50 mm, and it is your
          call, not a constant</li>
        <li>Round up to the next 100 mm, or to whatever increment your merchant rolls to</li>
      </ol>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Step</th><th>Worked example</th></tr></thead>
        <tbody>
          <tr><td>Plan run, ridge to gutter</td><td>4.20 m</td></tr>
          <tr><td>Pitch</td><td>25°</td></tr>
          <tr><td>Pitch factor, <code>1 / cos 25°</code></td><td>1.1034</td></tr>
          <tr><td>True slope length</td><td>4.20 × 1.1034 = <b>4.634 m</b></td></tr>
          <tr><td>Overhang into the gutter</td><td>+ 0.050 m</td></tr>
          <tr><td>Sheet length, rounded up to 100 mm</td><td><b>4.70 m</b></td></tr>
        </tbody>
      </table>
      </div>

      <p>A gable roof has two of those runs. A mono-pitch has one, running the full width. A hip
        roof has a rectangular face and two triangular ones, and the triangular faces are a set of
        different lengths rather than one repeated length — which is why hip roofs take longer to
        take off and why the cut list matters more.</p>

      <h3>The trap: measuring to the wrong gutter</h3>
      <p>A sheet run must be measured to <strong>the gutter that actually catches it</strong>. On a
        roof with a wing or a step-down, the nearest gutter in a straight line is often not the one
        the water reaches, and a run measured to the wrong one comes out metres long. It survives
        right through to the delivery, and you find out when the sheets are on the ground.</p>

      <h2>2. Sheet count — cover width, not sheet width</h2>
      <p>A sheet covers less than it measures, because it side-laps into the one beside it. The
        number that matters is the <strong>cover width</strong>, and it is on the manufacturer's
        datasheet for every profile.</p>
      <p>New Zealand corrugate is the one everybody knows: a nominal <strong>860 mm</strong> sheet
        with <strong>762 mm</strong> of cover. Divide by 860 instead of 762 and you order 88.6 per
        cent of the sheets you need — about <strong>one sheet short in every nine</strong>. On a
        100-sheet roof that is eleven sheets, which is a second delivery and a day lost.</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Face width</th><th>÷ 0.762 m cover</th><th>Sheets, rounded up</th></tr></thead>
        <tbody>
          <tr><td>6.00 m</td><td>7.87</td><td>8</td></tr>
          <tr><td>9.60 m</td><td>12.60</td><td>13</td></tr>
          <tr><td>12.00 m</td><td>15.75</td><td>16</td></tr>
          <tr><td>15.20 m</td><td>19.95</td><td>20</td></tr>
        </tbody>
      </table>
      </div>

      <p>Trapezoidal profiles — 5-rib, and the wider decks like Multidek — cover differently again,
        and the cover width is a property of the profile rather than something to remember. Look it
        up once per profile and keep it with your price book. Getting it from the sheet width is
        the mistake; getting it from the datasheet is the method.</p>
      <p>Round <em>up</em>, always, and round per face rather than on a total. Half a sheet does
        not arrive.</p>

      <h2>3. Laps, and when a sheet is not full length</h2>
      <p>Long-run steel side-laps by one rib, which is what the cover width already accounts for.
        End-laps only come into it when a run is longer than the sheet you can get on site — then
        the lap follows the profile and pitch rules, and on low pitches it is longer or sealed.</p>
      <p>Aim for single lengths wherever the run allows. Two sheets end-lapped is two chances of a
        leak and an extra row of fixings, and on a re-roof it is rarely worth it.</p>

      <h2>4. What the counts then give you</h2>
      <p>Once you have lengths and quantities, the consumables are arithmetic off them:</p>
      <ul>
        <li><strong>Underlay</strong> by roof area at the true pitch, with the lap allowed</li>
        <li><strong>Screws</strong> by sheet metres and purlin spacing — count the ridge and eave
          rows separately, because they are denser</li>
        <li><strong>Sealant</strong> by the number of laps and penetrations</li>
        <li><strong>Rivets</strong> by flashing metres, which is a separate count entirely</li>
      </ul>
      <p>Fixing centres themselves depend on the profile, the wind zone and the purlin layout, per
        the manufacturer and the code. An estimate assumes typical residential spacing; the roof
        gets fixed to what is actually up there.</p>

      <h2>5. Wastage on sheets is small</h2>
      <p>Because long-run is cut to length, sheet wastage is the off-cut at the end of a run and
        the occasional sheet ruined in handling. <strong>Two to five per cent</strong> covers most
        roofs. It is flashings, not sheets, that need a real allowance — and those are allowed per
        piece. That is covered in
        <a href="/guides/roof-flashings-explained">roof flashings explained</a>.</p>

      <h2>Do it once, then check it</h2>
      <p>The <a href="/tools/roofing-sheet-calculator">roofing sheet calculator</a> runs the whole
        thing — pitch factor, overhang, rounding, cover width — and shows the working, so you can
        check it against your own take-off rather than trusting it.</p>`,
  faq: [
    { q: 'What is the cover width of NZ corrugate?',
      a: ['762 mm, from a nominal 860 mm sheet. The 98 mm difference is the side lap.',
          'That is the number to divide a face width by. Dividing by 860 gives you 88.6 per cent of the sheets you need — roughly one short in every nine.'] },
    { q: 'How much overhang into the gutter should I allow?',
      a: ['Around 50 mm is typical, but it depends on the gutter, the fascia and how the eave is detailed. It is a decision, not a constant — set it once for the way you detail your roofs and use it consistently.',
          'Whatever you choose, add it after the pitch factor. The overhang is a real horizontal-ish distance at the bottom of the sheet, not something to be multiplied up.'] },
    { q: 'Do I apply the pitch factor to the sheet count as well?',
      a: ['No. Pitch makes sheets <em>longer</em>, not more numerous.',
          'The face width across the roof — the direction you count sheets in — is level, so it is the same in plan as it is on the roof. Multiplying the count by the pitch factor as well as the length double-counts the pitch and over-orders the whole roof.'] },
    { q: 'What length sheets can I actually get?',
      a: ['Long-run is rolled to order, so length is limited by transport and handling rather than by the machine. Very long sheets are awkward to get onto a roof and easy to damage; discuss anything unusual with the merchant before you price it.',
          'Rounding up to the next 100 mm is a safe default for an estimate. Confirm the increment your supplier rolls to before the order goes.'] },
    { q: 'How do I count sheets on a hip roof?',
      a: ['The rectangular faces count normally. The triangular hip ends are a series of decreasing lengths, each cut on the rake, so the count is the same — face width divided by cover — but the cut list is a set of individual lengths rather than one repeated one.',
          'That is where hand take-offs get slow, and where an off-plan cut list earns its keep.'] },
  ],
  next: NEXT_APP,
};

// ─────────────────────────────────────────────────────────────────────
const PITCH = {
  ...base,
  file: 'guides-roof-pitch-explained.html',
  url: '/guides/roof-pitch-explained',
  kind: 'guide',
  title: 'Roof pitch explained: degrees, ratios, lengths',
  description: 'What roof pitch is in degrees and in rise-over-run, and every length on a roof that it changes — rafters, hips, valleys, barges and area, with the multipliers.',
  h1: 'Roof pitch explained',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Roof pitch explained', url: '/guides/roof-pitch-explained' }],
  about: ['Roof pitch', 'Roof estimating', 'New Zealand'],
  stand: `Pitch is the one number that changes almost every other number on a roof — and it does
    not change all of them by the same amount, which is where take-offs go wrong.`,
  answer: `<strong>Roof pitch is the angle of the slope, given in degrees in New Zealand and as
    rise-over-run elsewhere.</strong> It makes every sloping length longer than it looks on a
    plan, by <code>1 / cos(pitch)</code> — 1.035 at 15°, 1.103 at 25°, 1.221 at 35°. It does
    <strong>not</strong> change level lengths: ridges, gutters and the width you count sheets
    across are the same in plan as on the roof.`,
  body: `      <h2>Two ways of saying the same angle</h2>
      <p>New Zealand roofing works in <strong>degrees</strong>. Plans, pitch gauges and
        manufacturers' minimum-pitch tables are all in degrees. You will still meet
        <strong>rise over run</strong> — a ratio like 1:3, meaning the roof rises one for every
        three it runs — on older drawings and in imported detailing.</p>
      <p>They convert: <code>pitch = atan(rise ÷ run)</code>, and <code>rise ÷ run = tan(pitch)</code>.</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Pitch</th><th>Rise per 1 m of run</th><th>As a ratio</th><th>What it looks like</th></tr></thead>
        <tbody>
          <tr><td>5°</td><td>0.087 m</td><td>1 : 11.4</td><td>Near-flat — check the profile's minimum pitch</td></tr>
          <tr><td>10°</td><td>0.176 m</td><td>1 : 5.7</td><td>Low-pitch modern, trapezoidal territory</td></tr>
          <tr><td>15°</td><td>0.268 m</td><td>1 : 3.7</td><td>Common on newer NZ housing</td></tr>
          <tr><td>20°</td><td>0.364 m</td><td>1 : 2.7</td><td>The everyday residential pitch</td></tr>
          <tr><td>25°</td><td>0.466 m</td><td>1 : 2.1</td><td>Also very common; walkable</td></tr>
          <tr><td>30°</td><td>0.577 m</td><td>1 : 1.7</td><td>Getting steep underfoot</td></tr>
          <tr><td>35°</td><td>0.700 m</td><td>1 : 1.4</td><td>Roof ladders and harnesses</td></tr>
          <tr><td>40°</td><td>0.839 m</td><td>1 : 1.2</td><td>Steep; work slows noticeably</td></tr>
          <tr><td>45°</td><td>1.000 m</td><td>1 : 1</td><td>Rise equals run</td></tr>
        </tbody>
      </table>
      </div>

      <h2>What pitch changes, and by how much</h2>
      <p>This is the part worth knowing cold. Two different multipliers apply, and using the wrong
        one is not a rounding error.</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Pitch</th><th>Rafter, sheet run, barge, area<br><code>1 / cos θ</code></th><th>Hip or valley on a square corner<br><code>√(1 + tan²θ ⁄ 2)</code></th></tr></thead>
        <tbody>
          <tr><td>5°</td><td>1.004</td><td>1.002</td></tr>
          <tr><td>10°</td><td>1.015</td><td>1.008</td></tr>
          <tr><td>15°</td><td>1.035</td><td>1.018</td></tr>
          <tr><td>20°</td><td>1.064</td><td>1.033</td></tr>
          <tr><td>25°</td><td>1.103</td><td>1.053</td></tr>
          <tr><td>30°</td><td>1.155</td><td>1.080</td></tr>
          <tr><td>35°</td><td>1.221</td><td>1.116</td></tr>
          <tr><td>40°</td><td>1.305</td><td>1.163</td></tr>
          <tr><td>45°</td><td>1.414</td><td>1.225</td></tr>
        </tbody>
      </table>
      </div>

      <p>Read that second column carefully, because it surprises people. At 25° a rafter is
        <strong>10.3 per cent</strong> longer than its plan length, but a hip is only
        <strong>5.3 per cent</strong> longer than <em>its</em> plan length. The hip is already
        running diagonally across the plan, so it has picked up most of its extra distance before
        the pitch is applied at all. Multiply a hip by the rafter factor and you over-order it;
        apply nothing and you under-order it.</p>
      <p>The hip column assumes the two planes meet at a square corner and share a pitch, which is
        the normal case. An odd-angled corner or two different pitches needs the geometry doing
        properly rather than a table.</p>

      <h3>What pitch does not change</h3>
      <ul>
        <li><strong>Ridge length.</strong> Level.</li>
        <li><strong>Gutter and fascia length.</strong> Level.</li>
        <li><strong>The face width you count sheets across.</strong> Level, so the sheet
          <em>count</em> is unaffected — only the sheet <em>length</em> moves.</li>
        <li><strong>The building footprint.</strong> Obviously, but worth saying: plan area is not
          roof area. A quote priced off the footprint at 35° buys 82 per cent of the roof.</li>
      </ul>

      <h2>Roof area at the true pitch</h2>
      <p>Roof area uses the same <code>1 / cos θ</code> factor, because the roof is only stretched
        in one direction. A 120 m² footprint at 30° is 120 × 1.155 = <strong>138.6 m²</strong> of
        roof. That is 18.6 m² of steel and underlay that a plan-area estimate does not buy.</p>

      <h2>Measuring pitch on site</h2>
      <ul>
        <li><strong>A pitch gauge or a phone level</strong> laid on a sheet or a rafter. Take it in
          a couple of places — old roofs sag, and a verandah is often a different pitch from the
          main roof.</li>
        <li><strong>Rise over run with a level and a tape</strong>: hold the level horizontal
          against the slope, measure a metre along it, drop to the roof, and that vertical is the
          rise. <code>atan(rise ÷ 1)</code> is the pitch.</li>
        <li><strong>Off the plans</strong>, if there are plans and the roof was built to them.</li>
      </ul>
      <p>Record the pitch <strong>per roof</strong>, not per job. A house with a lean-to at a
        different pitch has two pitch factors, and averaging them is a way of being wrong twice.</p>

      <h2>Low pitch is a specification question</h2>
      <p>Long-run steel goes down to low residential pitches, but the lower it gets the more the
        laps, the underlay and the fixing detail matter. Below the profile's stated minimum it is
        not a judgement call — check the manufacturer's minimum pitch for that profile and follow
        the code of practice. Confirm the site pitch before you specify the profile, not after.</p>

      <h2>Steepness costs hours</h2>
      <p>Above about 35° the work slows noticeably, the access requirements change, and the labour
        rate that worked on a 20° gable stops working. Pitch belongs in the labour calculation as
        well as the material one.</p>
      <p>The <a href="/tools/roof-pitch-calculator">roof pitch calculator</a> converts between
        degrees and ratios and gives both multipliers for any pitch, with the formulas on the page.</p>`,
  faq: [
    { q: 'What is a normal roof pitch in New Zealand?',
      a: ['Most residential long-run steel roofs sit somewhere between about 15° and 30°, with 20–25° the everyday range. Low-pitch modern designs run down towards 10° and below, usually on a trapezoidal profile.',
          'There is no single right answer — it is set by the design, and your job is to measure what is actually there rather than assume.'] },
    { q: 'How do I convert a 1:3 pitch to degrees?',
      a: ['Take the arctangent of rise divided by run. 1 ÷ 3 = 0.333, and atan(0.333) = 18.4°.',
          'The other direction: tan(18.4°) = 0.333, so the roof rises 333 mm for every metre it runs.'] },
    { q: 'Does pitch change the number of sheets?',
      a: ['No — only their length. You count sheets across the face of the roof, and that direction is level, so it measures the same in plan as it does up on the roof.',
          'Applying the pitch factor to the count as well as the length is a double-count, and it over-orders the entire roof by the pitch factor.'] },
    { q: 'Why is the hip multiplier smaller than the rafter one?',
      a: ['Because a hip is already travelling diagonally in plan. On a square corner its plan length is √2 times the run, so most of its extra distance is horizontal, not vertical, and the pitch adds proportionally less.',
          'At 25° the rafter factor is 1.103 and the hip factor is 1.053. Using 1.103 on a hip over-orders it by about five per cent, on the longest and most expensive flashing on the roof.'] },
    { q: 'Can I measure pitch from an aerial photo?',
      a: ['Not reliably. An aerial gives you the plan shape, which is everything except the pitch — the one number a photo taken from directly above cannot show you.',
          'Measure it on site with a gauge, or take it off the plans. Then the plan shape and the pitch together give you every length on the roof.'] },
  ],
  next: NEXT_APP,
};

// ─────────────────────────────────────────────────────────────────────
const GRADES = {
  ...base,
  file: 'guides-colorsteel-grades-compared.html',
  url: '/guides/colorsteel-grades-compared',
  kind: 'guide',
  title: 'Colorsteel, ColorCote and Zincalume compared',
  description: 'How NZ roofing steels differ: Colorsteel MAXAM, ColorCote, Armorsteel ColorZen and plain Zincalume, and which belongs how far from breaking surf.',
  h1: 'Colorsteel grades compared',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Colorsteel grades compared', url: '/guides/colorsteel-grades-compared' }],
  about: ['Colorsteel', 'Zincalume', 'Coastal corrosion', 'New Zealand'],
  stand: `Four steels, one decision, and it is mostly decided by how far the house is from
    breaking surf. Here is what actually separates them.`,
  answer: `<strong>The choice is driven by the coastal zone, not by colour.</strong> Colorsteel
    <strong>MAXAM</strong> is the premium coastal option; <strong>ColorCote</strong> is a
    comparable pre-painted range; <strong>Armorsteel ColorZen</strong> is a cheaper pre-painted
    steel that gives away corrosion protection near the sea; plain <strong>Zincalume</strong> is
    unpainted, self-weathering and the lowest cost where appearance does not matter. Distance to
    breaking surf sets the zone, the zone sets the warranty, and gauge — 0.40 mm or 0.55 mm — is
    a separate decision again.`,
  body: `      <h2>The four, side by side</h2>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Product</th><th>What it is</th><th>Where it belongs</th></tr></thead>
        <tbody>
          <tr>
            <td><b>Colorsteel MAXAM</b></td>
            <td>NZ Steel's premium pre-painted line, built on the <b>Activate™</b> aluminium-zinc-magnesium coating. Rolled and painted at Glenbrook from New Zealand iron sand.</td>
            <td>The one to specify near the coast. The magnesium in the coating slows corrosion where salt is in the air.</td>
          </tr>
          <tr>
            <td><b>ColorCote</b></td>
            <td>A separate pre-painted range with comparable coastal performance, sold in its own colour and coating tiers.</td>
            <td>A genuine alternative to MAXAM. Match the specific tier to the zone rather than treating the brand as one product.</td>
          </tr>
          <tr>
            <td><b>Armorsteel ColorZen</b></td>
            <td>A cheaper pre-painted steel with a solid coating and a full colour range.</td>
            <td>Inland and sheltered work where budget matters. It gives away corrosion protection in coastal zones — that is the trade.</td>
          </tr>
          <tr>
            <td><b>Zincalume</b></td>
            <td>Unpainted aluminium-zinc alloy-coated steel — natural silver. The coating self-weathers, so it needs no painting.</td>
            <td>Sheds, farm buildings, anywhere appearance is not the point. Lowest cost, and long-lived for what it is.</td>
          </tr>
        </tbody>
      </table>
      </div>

      <h2>Coastal zones — the number that decides it</h2>
      <p>New Zealand is a thin country and most of it is near the sea. Corrosion severity is set by
        <strong>distance to breaking surf</strong> — breaking surf, not just water, because it is
        the airborne salt from the break that does the damage. A sheltered harbour is a milder
        environment than an open west-coast beach at the same distance.</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Zone</th><th>Distance to breaking surf</th><th>What it means for the spec</th></tr></thead>
        <tbody>
          <tr><td><b>Mild</b></td><td>5 km or more</td><td>The full range is available. Warranties are at their longest.</td></tr>
          <tr><td><b>Moderate</b></td><td>500 m – 1 km</td><td>Pre-painted, and pay attention to the coating tier.</td></tr>
          <tr><td><b>Severe</b></td><td>100 – 500 m</td><td>Coastal-grade coating. Warranty periods shorten.</td></tr>
          <tr><td><b>Very severe</b></td><td>25 – 100 m</td><td>MAXAM or equivalent, heavier gauge worth considering, and check the warranty statement before you quote it.</td></tr>
        </tbody>
      </table>
      </div>

      <p>Closer to the coast means a shorter perforation warranty, on every product. That is not a
        catch — it is the manufacturer being honest about a harder environment. What it means for
        you is that <strong>the zone has to be established before the material is specified</strong>,
        because the two are the same decision.</p>

      <h2>What the warranties actually cover</h2>
      <p>Indicative figures, and they are the reason the zone matters:</p>
      <ul>
        <li><strong>MAXAM</strong> — up to a 50-year perforation warranty in mild zones, reducing
          as the zone gets more severe.</li>
        <li><strong>ColorZen</strong> — around 30 years in mild environments.</li>
        <li><strong>Zincalume</strong> — a 20-year non-perforation warranty. Repainting at around
          twenty years extends its life further, though the whole point of it is that it does not
          need painting.</li>
      </ul>
      <p><strong>Check the current published warranty for the product, the tier and the specific
        zone before you put a number in a quote.</strong> Manufacturers revise these, they vary by
        colour and coating tier, and they are usually conditional on installation detail —
        compatible fixings, no dissimilar metals, and washing down where the roof is sheltered from
        rain. A warranty quoted from memory is a warranty you are personally underwriting.</p>

      <h2>Gauge: 0.40 or 0.55</h2>
      <p>A separate decision from grade, and a simpler one.</p>
      <ul>
        <li><strong>0.40 mm</strong> is standard on a normal residential roof.</li>
        <li><strong>0.55 mm</strong> buys stiffness underfoot, better performance across wider
          purlin spacings, and more metal between the weather and the inside. It is worth having in
          a severe coastal zone, in a high wind zone, and on any roof people will walk on
          regularly — a roof with a lot of servicing on it, or one you know you will be back to.</li>
      </ul>
      <p>Wind zone feeds into this as well: high and very-high wind sites need closer fixing
        centres, and sometimes the heavier gauge is the cheaper way to get there.</p>

      <h2>Colour is not only appearance</h2>
      <p>Dark colours run hotter, which matters for thermal movement on long runs and for the
        expansion detail at the fixings. It is not a reason to talk a customer out of a dark roof —
        it is a reason to detail it properly and to mention it when they are choosing.</p>

      <h2>How to have the conversation</h2>
      <p>Homeowners ask <q>which is the good one</q>. The honest answer is that the good one depends
        on where they live, and it is worth saying so:</p>
      <ol>
        <li>Establish the distance to breaking surf. That gives the zone.</li>
        <li>The zone rules out what cannot go there and sets the warranty they will get.</li>
        <li>Within what is left, colour and price are their choice, and gauge is yours to
          recommend.</li>
      </ol>
      <p>Put the grade, the gauge and the colour in the quote in writing. A quote that says
        <q>new Colorsteel roof</q> and nothing else is a quote that can be undercut by a cheaper
        steel and lose on price to something that is not the same product.</p>`,
  faq: [
    { q: 'What is the difference between Colorsteel and Zincalume?',
      a: ['Zincalume is the unpainted aluminium-zinc alloy-coated steel — the natural silver one. Colorsteel is pre-painted steel, and MAXAM is its premium line, built on the Activate™ aluminium-zinc-magnesium coating.',
          'Zincalume self-weathers and needs no painting; it is the cheapest option and it lasts well where looks are not the point. Colorsteel is what goes on a house.'] },
    { q: 'How close to the sea can I use ColorZen?',
      a: ['It is a mild-environment product. In coastal zones it gives away corrosion protection compared with MAXAM or a coastal ColorCote tier, and that is the whole reason it is cheaper.',
          'Establish the zone first, then check the manufacturer’s current warranty statement for that zone. If the warranty will not be written, the product does not belong there.'] },
    { q: 'Does Zincalume need painting?',
      a: ['No. The aluminium-zinc coating self-weathers to resist corrosion, and it carries a 20-year non-perforation warranty unpainted.',
          'Repainting at around twenty years extends its life further if you want it to, but the product is designed to be left alone.'] },
    { q: 'What does "distance to breaking surf" mean exactly?',
      a: ['The straight-line distance from the building to where the waves break, not to the nearest water. Airborne salt comes off the break, so an open surf beach at 300 m is a far harder environment than a sheltered harbour edge at the same distance.',
          'Prevailing wind matters too. A house downwind of an open coast sees more salt than one the same distance away in the lee of a hill.'] },
    { q: 'Should I use 0.55 gauge?',
      a: ['On a normal residential roof, 0.40 is standard and fine. Go to 0.55 for stiffness underfoot, for wider purlin spacings, in a severe coastal zone, in a high wind zone, or on a roof that will be walked on regularly.',
          'It is a small proportion of the job cost and it is the kind of upgrade a customer understands when you explain what it buys.'] },
    { q: 'Can I mix brands on one roof?',
      a: ['Avoid it. Different coatings and different fixings sitting against each other is how you get a corrosion problem at the junction, and it complicates any warranty claim later — each manufacturer can point at the other.',
          'Specify one system, with its own compatible flashings and fixings, and keep it consistent across the whole roof.'] },
  ],
  next: NEXT_APP,
};

// ─────────────────────────────────────────────────────────────────────
// The calculators. Their explanation and worked example live in the HTML;
// the script only recomputes the answer when the inputs change, and the
// values it writes on load are the same ones already in the markup. With
// scripting off the page still reads as a complete, correct explanation —
// which is the point, since a tool page a crawler cannot read is a tool page
// that will never be found.
const CALC_PITCH = {
  ...base,
  eyebrow: 'Calculator',
  file: 'tools-roof-pitch-calculator.html',
  url: '/tools/roof-pitch-calculator',
  kind: 'tool',
  title: 'Roof pitch calculator — degrees and ratios',
  description: 'Convert roof pitch between degrees and rise-over-run, and get the multipliers for rafter, sheet run, area, hip and valley lengths. Formulas shown.',
  h1: 'Roof pitch calculator',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Roof pitch calculator', url: '/tools/roof-pitch-calculator' }],
  about: ['Roof pitch', 'Roof estimating'],
  stand: `Enter a pitch in degrees or a rise over a run. It gives you the other one, plus the
    multipliers for every sloping length on the roof — with the formulas, so you can check it.`,
  answer: `<strong>A sloping length equals its plan length times <code>1 / cos(pitch)</code>.</strong>
    A hip or valley on a square corner uses a different, smaller factor —
    <code>√(1 + tan²(pitch) ⁄ 2)</code> — because it is already running diagonally across the
    plan. Roof area uses the rafter factor. Ridges and gutters are level and use neither.`,
  body: `      <div class="calc" id="calc">
        <div class="calc-in">
          <div class="field">
            <label for="cpDeg">Pitch, in degrees</label>
            <input type="number" id="cpDeg" value="25" min="0" max="85" step="0.5" inputmode="decimal">
          </div>
          <div class="calc-or">or</div>
          <div class="field">
            <label for="cpRise">Rise, per 1.000 m of run</label>
            <input type="number" id="cpRise" value="0.466" min="0" step="0.001" inputmode="decimal">
          </div>
        </div>
        <div class="calc-out">
          <div class="calc-row"><span>Pitch</span><b id="cpOutDeg">25.0°</b></div>
          <div class="calc-row"><span>Rise per 1 m of run</span><b id="cpOutRise">0.466 m</b></div>
          <div class="calc-row"><span>As a ratio</span><b id="cpOutRatio">1 : 2.14</b></div>
          <div class="calc-row hi"><span>Rafter, sheet run, barge, area <span class="calc-f">1 / cos θ</span></span><b id="cpOutRaf">1.103</b></div>
          <div class="calc-row hi"><span>Hip or valley, square corner <span class="calc-f">√(1 + tan²θ ⁄ 2)</span></span><b id="cpOutHip">1.053</b></div>
          <div class="calc-row"><span>A 4.000 m plan rafter becomes</span><b id="cpOutEg">4.414 m</b></div>
        </div>
        <p class="calc-note">Ridge and gutter lengths are level — no factor applies to them.</p>
      </div>

      <h2>The worked example, by hand</h2>
      <p>Those default numbers are a 25° roof, and here is the whole calculation without the
        calculator:</p>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>What</th><th>Formula</th><th>At 25°</th></tr></thead>
        <tbody>
          <tr><td>Rise per metre of run</td><td><code>tan θ</code></td><td>0.466 m</td></tr>
          <tr><td>As a ratio</td><td><code>1 : 1 / tan θ</code></td><td>1 : 2.14</td></tr>
          <tr><td>Rafter / sheet run / barge / area factor</td><td><code>1 / cos θ</code></td><td>1.103</td></tr>
          <tr><td>Hip or valley factor, square corner</td><td><code>√(1 + tan²θ ⁄ 2)</code></td><td>1.053</td></tr>
          <tr><td>A 4.000 m plan rafter</td><td><code>4.000 × 1.103</code></td><td>4.414 m</td></tr>
        </tbody>
      </table>
      </div>

      <h2>Which factor goes where</h2>
      <p>Getting this wrong is the most common estimating error there is, so it is worth being
        explicit about every line on a roof:</p>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Measurement</th><th>Factor</th></tr></thead>
        <tbody>
          <tr><td>Sheet run, ridge to gutter</td><td><code>1 / cos θ</code></td></tr>
          <tr><td>Rafter length</td><td><code>1 / cos θ</code></td></tr>
          <tr><td>Barge, along a gable rake</td><td><code>1 / cos θ</code></td></tr>
          <tr><td>Roof area from footprint area</td><td><code>1 / cos θ</code></td></tr>
          <tr><td>Hip, from its plan length</td><td><code>√(1 + tan²θ ⁄ 2)</code></td></tr>
          <tr><td>Valley, from its plan length</td><td><code>√(1 + tan²θ ⁄ 2)</code></td></tr>
          <tr><td>Ridge</td><td>none — level</td></tr>
          <tr><td>Gutter, fascia, eave</td><td>none — level</td></tr>
          <tr><td>Face width, for counting sheets</td><td>none — level</td></tr>
        </tbody>
      </table>
      </div>
      <p>The hip and valley formula assumes the two planes meet at a square corner and share a
        pitch. An odd-angled corner, or two roofs at different pitches meeting in a valley, needs
        the geometry worked properly — the table is not a substitute for that.</p>

      <h2>Why the hip factor is smaller</h2>
      <p>A hip runs diagonally in plan as well as sloping. On a square corner its plan length is
        already √2 times the run, so it has picked up most of its extra distance horizontally
        before pitch is applied. At 25° a rafter gains 10.3 per cent and a hip gains 5.3 per cent.</p>
      <p>Multiply a hip by the rafter factor and you over-order the longest, most expensive
        flashing on the roof by about five per cent. The full explanation is in
        <a href="/guides/roof-pitch-explained">roof pitch explained</a>.</p>

      <h2>Measuring the pitch to put in</h2>
      <p>A pitch gauge or a phone level on a rafter or a sheet, taken in more than one place —
        old roofs sag, and a lean-to is usually not the same pitch as the roof it hangs off. Or
        rise over run with a level and a tape: hold the level horizontal against the slope, measure
        1 m along it, drop to the roof, and that vertical is the rise.</p>
      <p>An aerial photo cannot give you pitch. It gives you the plan shape, which is everything
        else.</p>`,
  faq: [
    { q: 'How do I convert roof pitch from degrees to a ratio?',
      a: ['The rise per unit of run is tan(pitch), so the ratio is 1 : 1/tan(pitch). At 25°, tan is 0.466, so the ratio is 1 : 2.14 — the roof rises 466 mm for every metre it runs.',
          'Going the other way, pitch = atan(rise ÷ run).'] },
    { q: 'What multiplier do I use for a hip or a valley?',
      a: ['√(1 + tan²θ ⁄ 2) applied to the hip’s plan length, for two equally-pitched planes meeting at a square corner. At 25° that is 1.053.',
          'Not the rafter factor. The hip is already diagonal in plan, so the rafter factor over-states it — by about five per cent at 25°.'] },
    { q: 'Does the pitch factor apply to roof area?',
      a: ['Yes, the rafter factor does. The roof is stretched in one direction only, so area scales by the same 1 / cos θ.',
          'A 120 m² footprint at 30° is 138.6 m² of roof — 18.6 m² of steel and underlay that a footprint estimate does not buy.'] },
    { q: 'Is this calculator accurate enough to order from?',
      a: ['The arithmetic is exact. What decides whether the order is right is the pitch and the plan lengths you put in, and both come off the roof.',
          'Take the pitch in more than one place, measure critical lengths on site before anything is cut, and treat any single number as something to sanity-check rather than trust.'] },
  ],
  faqHeading: 'Using this calculator.',
  next: [
    { href: '/tools/roofing-sheet-calculator', title: 'Roofing sheet calculator',
      blurb: 'Face size and pitch in, sheet length and count out.' },
    { href: '/guides/roof-pitch-explained', title: 'Roof pitch explained',
      blurb: 'The long version — every length pitch changes, and the ones it does not.' },
    { href: '/features/roof-measuring', title: 'Skip the arithmetic',
      blurb: 'Trace the roof over an aerial, enter the pitch once, and every length follows.' },
  ],
  script: `(function(){
  var deg = document.getElementById('cpDeg'), rise = document.getElementById('cpRise');
  if (!deg || !rise) return;
  var out = function(id){ return document.getElementById(id); };
  var f = function(x, n){ return x.toFixed(n); };
  function paint(d){
    var r = d * Math.PI / 180, t = Math.tan(r);
    out('cpOutDeg').textContent   = f(d, 1) + '\\u00b0';
    out('cpOutRise').textContent  = f(t, 3) + ' m';
    out('cpOutRatio').textContent = t > 0 ? '1 : ' + f(1 / t, 2) : 'flat';
    out('cpOutRaf').textContent   = f(1 / Math.cos(r), 3);
    out('cpOutHip').textContent   = f(Math.sqrt(1 + t * t / 2), 3);
    out('cpOutEg').textContent    = f(4 / Math.cos(r), 3) + ' m';
  }
  function fromDeg(){
    var d = parseFloat(deg.value);
    if (!isFinite(d) || d < 0 || d >= 85) return;
    rise.value = Math.tan(d * Math.PI / 180).toFixed(3);
    paint(d);
  }
  function fromRise(){
    var v = parseFloat(rise.value);
    if (!isFinite(v) || v < 0) return;
    var d = Math.atan(v) * 180 / Math.PI;
    deg.value = Math.round(d * 10) / 10;
    paint(d);
  }
  deg.addEventListener('input', fromDeg);
  rise.addEventListener('input', fromRise);
})();`,
};

const CALC_SHEET = {
  ...base,
  eyebrow: 'Calculator',
  file: 'tools-roofing-sheet-calculator.html',
  url: '/tools/roofing-sheet-calculator',
  kind: 'tool',
  title: 'Roofing sheet calculator for long-run steel',
  description: 'Work out long-run steel sheet lengths, counts, lineal metres and true roof area from the face width, plan run, pitch and cover width. Working shown.',
  h1: 'Roofing sheet calculator',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Roofing sheet calculator', url: '/tools/roofing-sheet-calculator' }],
  about: ['Roof estimating', 'Long-run steel roofing'],
  stand: `One roof face at a time: how wide it is, how far it runs, and at what pitch. Out comes
    the sheet length, the count, the lineal metres and the true area — with the working.`,
  answer: `<strong>Sheet length is the plan run × <code>1 / cos(pitch)</code> + the gutter
    overhang, rounded up.</strong> Sheet count is the face width ÷ the profile's cover width,
    rounded up — <strong>762 mm</strong> on New Zealand corrugate, from a nominal 860 mm sheet.
    Do it per face, then group identical lengths for the order.`,
  body: `      <div class="calc" id="calc">
        <div class="calc-in wide">
          <div class="field">
            <label for="csWidth">Face width, across the roof (m)</label>
            <input type="number" id="csWidth" value="9.60" min="0" step="0.01" inputmode="decimal">
          </div>
          <div class="field">
            <label for="csRun">Plan run, ridge to gutter (m)</label>
            <input type="number" id="csRun" value="4.20" min="0" step="0.01" inputmode="decimal">
          </div>
          <div class="field">
            <label for="csPitch">Pitch (degrees)</label>
            <input type="number" id="csPitch" value="25" min="0" max="85" step="0.5" inputmode="decimal">
          </div>
          <div class="field">
            <label for="csCover">Cover width (mm)</label>
            <input type="number" id="csCover" value="762" min="1" step="1" inputmode="numeric">
          </div>
          <div class="field">
            <label for="csOver">Overhang into the gutter (mm)</label>
            <input type="number" id="csOver" value="50" min="0" step="5" inputmode="numeric">
          </div>
        </div>
        <div class="calc-out">
          <div class="calc-row"><span>Pitch factor <span class="calc-f">1 / cos θ</span></span><b id="csFac">1.103</b></div>
          <div class="calc-row"><span>True slope length</span><b id="csSlope">4.634 m</b></div>
          <div class="calc-row hi"><span>Sheet length, rounded up to 100 mm</span><b id="csLen">4.70 m</b></div>
          <div class="calc-row"><span>Sheets before rounding</span><b id="csRaw">12.60</b></div>
          <div class="calc-row hi"><span>Sheets to order</span><b id="csCount">13</b></div>
          <div class="calc-row"><span>Lineal metres</span><b id="csLineal">61.1 m</b></div>
          <div class="calc-row"><span>Roof area at the true pitch</span><b id="csArea">44.49 m²</b></div>
        </div>
        <p class="calc-note">One roof face. A gable has two; a hip roof has two rectangular faces
          and two triangular ones, and the triangles are a set of different lengths rather than one
          repeated length.</p>
      </div>

      <h2>The worked example, by hand</h2>
      <p>Those defaults are a 9.60 m wide face running 4.20 m in plan at 25°, in corrugate. Here it
        is without the calculator:</p>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Step</th><th>Working</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td>Pitch factor</td><td><code>1 / cos 25°</code></td><td>1.1034</td></tr>
          <tr><td>True slope length</td><td>4.20 × 1.1034</td><td>4.634 m</td></tr>
          <tr><td>Plus overhang</td><td>4.634 + 0.050</td><td>4.684 m</td></tr>
          <tr><td>Sheet length, rounded up</td><td>up to the next 100 mm</td><td><b>4.70 m</b></td></tr>
          <tr><td>Sheets, before rounding</td><td>9.60 ÷ 0.762</td><td>12.60</td></tr>
          <tr><td>Sheets to order</td><td>rounded up</td><td><b>13</b></td></tr>
          <tr><td>Lineal metres</td><td>13 × 4.70</td><td>61.1 m</td></tr>
          <tr><td>Roof area at the true pitch</td><td>9.60 × 4.634</td><td>44.49 m²</td></tr>
        </tbody>
      </table>
      </div>
      <p>Note that the area uses the <em>true slope length</em>, not the rounded sheet length. The
        rounding is an ordering allowance; it is not roof.</p>

      <h2>The two inputs people get wrong</h2>
      <h3>Cover width, not sheet width</h3>
      <p>A sheet covers less than it measures, because it side-laps into its neighbour. New Zealand
        corrugate is a nominal <strong>860 mm</strong> sheet with <strong>762 mm</strong> of cover.
        Put 860 in the box above and you will order 88.6 per cent of the sheets you need — about
        one short in every nine.</p>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Face width</th><th>Right: ÷ 762 mm cover</th><th>Wrong: ÷ 860 mm sheet</th><th>Sheets short</th></tr></thead>
        <tbody>
          <tr><td>6.00 m</td><td>8</td><td>7</td><td>1</td></tr>
          <tr><td>9.60 m</td><td>13</td><td>12</td><td>1</td></tr>
          <tr><td>18.00 m</td><td>24</td><td>21</td><td>3</td></tr>
          <tr><td>30.00 m</td><td>40</td><td>35</td><td>5</td></tr>
          <tr><td>76.20 m</td><td>100</td><td>89</td><td>11</td></tr>
        </tbody>
      </table>
      </div>

      <p>Trapezoidal profiles cover differently again. The cover width is on the manufacturer's
        datasheet for the profile; look it up once and keep it with your price book rather than
        working it out from the sheet width.</p>

      <h3>Plan run, not slope length</h3>
      <p>The run this calculator wants is the <strong>horizontal</strong> distance from the ridge
        line to the gutter line — what you would measure off a plan or an aerial. If you have
        already climbed up and measured along the slope, that number is the slope length: skip the
        pitch factor rather than applying it twice.</p>

      <h2>Measuring to the right gutter</h2>
      <p>A sheet run has to be measured to the gutter that actually catches it. On a roof with a
        wing or a step-down, the nearest gutter in a straight line is often not the one the water
        reaches, and a run measured to the wrong one comes out metres long. It is a mistake that
        survives all the way to the delivery.</p>

      <h2>What this does not include</h2>
      <ul>
        <li><strong>Wastage.</strong> Sheet wastage on long-run is small — two to five per cent
          covers the off-cuts and the odd damaged sheet — but it is a judgement about the roof, so
          it is not built in here.</li>
        <li><strong>Flashings.</strong> A separate count entirely, and done as pieces at lengths
          rather than metres. See
          <a href="/guides/roof-flashings-explained">roof flashings explained</a>.</li>
        <li><strong>Consumables.</strong> Screws, underlay, sealant and rivets all follow from the
          sheet and flashing counts, and from the purlin layout and wind zone on the day.</li>
        <li><strong>End laps.</strong> This assumes single-length sheets, which is what you want
          wherever the run allows it.</li>
      </ul>
      <p>The full method, including all of the above, is in
        <a href="/guides/calculating-sheet-lengths">calculating sheet lengths and counts</a>.</p>`,
  faq: [
    { q: 'What cover width should I use for corrugate?',
      a: ['762 mm, from a nominal 860 mm sheet. The 98 mm difference is the side lap.',
          'Using 860 instead gives you 88.6 per cent of the sheets you need — roughly one short in every nine, or eleven short on a hundred-sheet roof.'] },
    { q: 'Should I add the overhang before or after the pitch factor?',
      a: ['After. Multiply the plan run by the pitch factor first, then add the overhang.',
          'The overhang is a fixed distance past the gutter line, not a plan measurement waiting to be stretched. Adding it first multiplies it up as well, which quietly lengthens every sheet on the roof.'] },
    { q: 'How do I use this on a hip roof?',
      a: ['Run it once for each rectangular face. The triangular hip ends do not reduce to a single length — each sheet is cut on the rake and gets shorter as it goes, so the count is the same but the cut list is a series of individual lengths.',
          'That is exactly the part that makes hand take-offs slow, and where a cut list generated off the plan shape saves the most time.'] },
    { q: 'Why is the area smaller than sheets × sheet length?',
      a: ['Because the sheet length has been rounded up for ordering and it includes the gutter overhang, and because the last sheet is usually cut down the length.',
          'The area figure uses the true slope length and the actual face width, so it is roof — which is what underlay and labour should be priced off.'] },
    { q: 'Does it handle a mono-pitch roof?',
      a: ['Yes — a mono-pitch is a single face, so run it once with the full plan run from the high side to the gutter. A gable is two faces; run it twice, or once and double the count if both sides are identical.',
          'The thing to avoid on a mono-pitch is treating it like a gable and halving the run. That gives you twice as many sheets at half the length, which is the same lineal metres and completely the wrong order.'] },
  ],
  faqHeading: 'Using this calculator.',
  next: [
    { href: '/tools/roof-pitch-calculator', title: 'Roof pitch calculator',
      blurb: 'Degrees to ratio, and the multipliers for rafters, hips and valleys.' },
    { href: '/guides/calculating-sheet-lengths', title: 'The full method',
      blurb: 'Run length, cover width, laps and what the counts feed into next.' },
    { href: '/features/job-pack', title: 'The whole cut list at once',
      blurb: 'Every face, every length, every flashing — off the roof you traced.' },
  ],
  script: `(function(){
  var ids = ['csWidth','csRun','csPitch','csCover','csOver'], el = {};
  for (var i = 0; i < ids.length; i++){ el[ids[i]] = document.getElementById(ids[i]); if (!el[ids[i]]) return; }
  var out = function(id){ return document.getElementById(id); };
  function calc(){
    var w = parseFloat(el.csWidth.value), run = parseFloat(el.csRun.value),
        p = parseFloat(el.csPitch.value), cover = parseFloat(el.csCover.value),
        over = parseFloat(el.csOver.value);
    if (!isFinite(w) || !isFinite(run) || !isFinite(p) || !isFinite(cover) || !isFinite(over)) return;
    if (w <= 0 || run <= 0 || cover <= 0 || p < 0 || p >= 85 || over < 0) return;
    var fac = 1 / Math.cos(p * Math.PI / 180);
    var slope = run * fac;
    var len = Math.ceil((slope + over / 1000) * 10) / 10;
    var raw = w / (cover / 1000);
    var n = Math.ceil(raw - 1e-9);
    out('csFac').textContent    = fac.toFixed(3);
    out('csSlope').textContent  = slope.toFixed(3) + ' m';
    out('csLen').textContent    = len.toFixed(2) + ' m';
    out('csRaw').textContent    = raw.toFixed(2);
    out('csCount').textContent  = n;
    out('csLineal').textContent = (n * len).toFixed(1) + ' m';
    out('csArea').textContent   = (w * slope).toFixed(2) + ' m\\u00b2';
  }
  for (var j = 0; j < ids.length; j++) el[ids[j]].addEventListener('input', calc);
})();`,
};

// ── the second four ──────────────────────────────────────────────────
// Every number below was computed, not typed:
//   allowance % = allowance per piece ÷ average piece length
//   rake at 25° = 4.00 × 1.1034 = 4.41 m
//   simple gable: 6 pieces, 29.65 m, 4.94 m average → 0.4 m/piece = 8.1%
//   cut-up roof: 22 pieces, 62 m, 2.82 m average → 0.4 m/piece = 14.2%

const WASTAGE = {
  ...base,
  file: 'guides-flashing-wastage.html',
  url: '/guides/flashing-wastage',
  kind: 'guide',
  title: 'Flashing wastage: per piece, not per cent',
  description: 'Why a flat wastage percentage over-allows on a simple roof and under-allows on a cut-up one, and how to allow for flashing laps and trims per piece instead.',
  h1: 'Flashing wastage, done per piece',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Flashing wastage', url: '/guides/flashing-wastage' }],
  about: ['Roof estimating', 'Roof flashing', 'New Zealand'],
  stand: `A flat percentage on a flashing total is the wrong shape for the problem. Here is the
    arithmetic that shows why, and what to do instead.`,
  answer: `<strong>Allow flashing wastage per piece, not as a percentage.</strong> Roughly 0.3 to
    0.5 m on each run for laps and end trims, rounded up to the next 0.1 m. A flat percentage is
    only ever correct for one average piece length — at 0.4 m a piece, a 10 per cent allowance is
    right when your pieces average 4 m, generous above that and short below it. Cut-up roofs have
    short pieces, so a percentage fails exactly where the risk is.`,
  body: `      <h2>The arithmetic behind the rule</h2>
      <p>An allowance per piece, expressed as a percentage of the total, is just this:</p>
      <p><code>allowance % = allowance per piece ÷ average piece length</code></p>
      <p>Nothing else is in it. The percentage that is <em>correct</em> for a roof is decided
        entirely by how long its flashing pieces average — which is another way of saying it is
        decided by how cut-up the roof is. At a 0.4 m allowance:</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Average piece length</th><th>0.4 m per piece is</th><th>What kind of roof</th></tr></thead>
        <tbody>
          <tr><td>6.0 m</td><td>6.7%</td><td>Long straight runs — a simple gable</td></tr>
          <tr><td>5.0 m</td><td>8.0%</td><td>Straightforward residential</td></tr>
          <tr><td>4.0 m</td><td>10.0%</td><td>The only roof a flat 10% is right for</td></tr>
          <tr><td>3.0 m</td><td>13.3%</td><td>Hips, valleys, a few penetrations</td></tr>
          <tr><td>2.5 m</td><td>16.0%</td><td>Cut-up: dormers, steps, verandahs</td></tr>
          <tr><td>2.0 m</td><td>20.0%</td><td>Very cut-up, or lots of short apron runs</td></tr>
        </tbody>
      </table>
      </div>

      <p>So a flat ten per cent is not a safe middle. It is a bet that every roof you quote has
        4 m flashings on it.</p>

      <h2>Two roofs, same rule, different answers</h2>
      <p>Take a plain 12 m × 8 m gable at 25°. The rake is 4.00 m in plan, so 4.41 m on the slope.
        Six flashings: two lengths of ridge and four barges.</p>

      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Per roof</th><th>Simple gable</th><th>Cut-up hip-and-valley</th></tr></thead>
        <tbody>
          <tr><td>Flashing pieces</td><td>6</td><td>22</td></tr>
          <tr><td>Total flashing</td><td>29.65 m</td><td>62.00 m</td></tr>
          <tr><td>Average piece</td><td>4.94 m</td><td>2.82 m</td></tr>
          <tr><td>At 0.4 m a piece</td><td>2.4 m — <b>8.1%</b></td><td>8.8 m — <b>14.2%</b></td></tr>
          <tr><td>A flat 10% would give</td><td>2.97 m — <b>0.6 m too much</b></td><td>6.20 m — <b>2.6 m short</b></td></tr>
        </tbody>
      </table>
      </div>

      <p>Read the last row. The flat percentage hands free material to the easy roof and takes it
        off the hard one. On the cut-up roof that 2.6 m is two or three short pieces you have to go
        back for, on the job that was already going to be tight.</p>

      <h2>What the allowance is actually for</h2>
      <p>It is not waste in the sense of off-cuts. It is three real things, and all three happen
        <em>per piece</em>:</p>
      <ul>
        <li><strong>Laps.</strong> Where two lengths of the same flashing meet, they overlap. Two
          pieces of ridge covering 12 m are not 6 m each.</li>
        <li><strong>End trims and stop-ends.</strong> Cutting to fit at the ends of a run, and
          folding or notching where a flashing meets another one.</li>
        <li><strong>Rounding.</strong> Every piece is rounded up to the next 0.1 m for the order,
          which adds an average of 0.05 m a piece on top. Small, but it compounds the same way —
          by piece count, not by metres.</li>
      </ul>
      <p>None of those scales with how much flashing there is. All of them scale with how many
        separate pieces there are.</p>

      <h2>How to write it up</h2>
      <ol>
        <li>List every flashing as a quantity at a length — <code>2 @ 6.4 m</code>,
          <code>4 @ 4.9 m</code> — not as a total.</li>
        <li>Add the allowance to each piece before rounding, not to the total afterwards.</li>
        <li>Round each piece up to the next 0.1 m.</li>
        <li>Group identical lengths for the merchant.</li>
      </ol>
      <p>The order that comes out of that is one the merchant can fold straight from. A total in
        metres is not an order — forty-two metres of barge could be six pieces or fifteen, and
        they are different steel at a different price.</p>

      <h2>Sheets are the opposite case</h2>
      <p>All of the above is about flashings. Long-run <em>sheets</em> are cut to length, so their
        waste really is small and really is roughly proportional: two to five per cent covers the
        off-cut at the end of a run and the odd sheet ruined in handling.</p>
      <p>The reason people reach for a flat percentage on flashings is that it works on sheets. It
        works there because sheets are ordered as long single lengths and flashings are not.</p>

      <h2>When to allow more</h2>
      <ul>
        <li><strong>Complicated junctions.</strong> A valley running into an apron, or three
          flashings meeting at a corner, eats more than a plain lap.</li>
        <li><strong>Change-of-pitch and bullnose.</strong> Folded to two specific angles, so a
          mistake is a whole new piece rather than a trim.</li>
        <li><strong>Anything you are measuring off a plan you have not stood on.</strong> Round up
          harder, and check the critical pieces before they are folded.</li>
      </ul>
      <p>The full survey of what each flashing is and where it goes is in
        <a href="/guides/roof-flashings-explained">roof flashings explained</a>.</p>`,
  faq: [
    { q: 'What percentage should I allow for flashing wastage?',
      a: ['The honest answer is that a percentage is the wrong unit. Allow 0.3 to 0.5 m per piece for laps and end trims, rounded up to the next 0.1 m.',
          'If you must have a number: the allowance as a percentage equals your per-piece allowance divided by your average piece length. At 0.4 m a piece, that is 6.7 per cent on 6 m pieces and 20 per cent on 2 m pieces. There is no single figure that covers both.'] },
    { q: 'Why does a flat percentage go wrong on cut-up roofs?',
      a: ['Because the things the allowance pays for — laps, end trims, rounding — happen once per piece, and a cut-up roof has far more pieces per metre than a simple one.',
          'A 62 m flashing schedule made of 22 pieces needs 8.8 m at 0.4 m each. A flat ten per cent gives it 6.2 m. That is 2.6 m short on the roof that could least afford it.'] },
    { q: 'Does the same rule apply to sheets?',
      a: ['No. Long-run steel sheets are cut to length, so their waste is genuinely small and roughly proportional to the quantity — two to five per cent covers most roofs.',
          'That is why the percentage habit exists. It works on sheets, and people carry it across to flashings where it does not.'] },
    { q: 'Should I add the allowance before or after rounding?',
      a: ['Before. Add the lap and trim allowance to the measured length, then round the result up to the next 0.1 m.',
          'Rounding first and then adding gives you the same total by accident on some pieces and leaves you short on others, and it makes the schedule harder to check.'] },
    { q: 'How do I count pieces I have not decided how to lap yet?',
      a: ['Count the runs first — every separate line on the roof is at least one piece. Then split any run longer than the merchant will fold in one length, and count the split as an extra piece with its own allowance.',
          'That is the number the allowance multiplies. If you do not know the fold limit, ask before you price it rather than after.'] },
  ],
  next: NEXT_APP,
};

const PIPES = {
  ...base,
  file: 'guides-pipe-flashings-and-back-trays.html',
  url: '/guides/pipe-flashings-and-back-trays',
  kind: 'guide',
  title: 'Pipe flashings and back-trays explained',
  description: 'Dektites, back-trays and boxed penetration sets: what each one does, how to count them, and why the back-tray is the most-forgotten item on a roofing order.',
  h1: 'Pipe flashings and back-trays',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Pipe flashings and back-trays', url: '/guides/pipe-flashings-and-back-trays' }],
  about: ['Roof flashing', 'Roof penetrations', 'Long-run steel roofing'],
  stand: `Every hole in a roof is two items, not one — and the second one is the one that goes
    missing off the docket. This is how penetrations are flashed and how they are counted.`,
  answer: `<strong>A pipe penetration needs a dektite <em>and</em> a back-tray.</strong> The
    dektite is the moulded boot that seals around the pipe; the back-tray sits behind it, under
    the sheets, and takes the water running down the roof around the penetration before it reaches
    the boot. A boxed penetration — a chimney or a skylight upstand — is not one flashing but
    <strong>five</strong>: back, two sides, front apron and a saddle.`,
  body: `      <h2>The dektite</h2>
      <p>A moulded rubber or silicone cone with a flexible metal base, cut to the pipe diameter,
        pushed down over the pipe, dressed into the profile of the sheet and sealed and fixed
        around the base. It is what makes the pipe itself watertight.</p>
      <p>Two things decide which one:</p>
      <ul>
        <li><strong>The pipe diameter.</strong> Dektites come in overlapping size ranges and the
          cone is cut to the pipe. Measure the pipe, do not guess it from the fitting.</li>
        <li><strong>The temperature.</strong> A flue is not a waste pipe. High-temperature
          penetrations need the material rated for it, and the standard EPDM one is not.</li>
      </ul>

      <h2>The back-tray, and why it exists</h2>
      <p>Water runs down a roof. A penetration sits in that path, and everything above it drains
        onto it. The dektite seals the pipe; it does not stop the sheet above delivering the whole
        upslope catchment straight into the base of the boot.</p>
      <p>The <strong>back-tray</strong> is a folded tray that sits <em>behind</em> the penetration
        and <em>under</em> the sheets, and steers that water into the pans either side. On any
        penetration with roof above it, it is not optional.</p>
      <ul>
        <li><strong>Full length</strong> runs from the penetration up to the ridge, so nothing
          upslope can reach it. The safe choice, and the one to use on low pitch, on long runs, or
          where the penetration is near the top of the roof.</li>
        <li><strong>Short</strong> runs a defined distance above the penetration. Enough on a
          steeper roof with a short run above the hole, and less steel.</li>
      </ul>
      <p>Whichever you choose, it is a folded piece at a length and it goes on the order as one —
        <code>1 @ 2.4 m</code>, rounded up to the next 0.1 m like every other flashing.</p>

      <h3>Why it is the most-forgotten item on a roofing order</h3>
      <p>Because nothing on the paperwork asks for it. The plan shows a pipe. The merchant's
        docket shows a dektite, because that is what you asked for. The tray is invisible in both
        places, and it only becomes obvious when the sheets are up and there is nowhere to put it
        without lifting them again.</p>
      <p>The fix is a counting habit, not a memory: <strong>every dektite on the schedule gets a
        tray line written directly under it</strong>, at the moment you write the dektite, before
        you move on to the next penetration.</p>

      <h2>Boxed penetrations are five pieces</h2>
      <p>A boxed chimney, a boxed flue, a skylight upstand — anything square coming through the
        roof — is a set:</p>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Piece</th><th>Where</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><b>Back flashing</b></td><td>Upslope face</td><td>Takes the water arriving from above and turns it out to the sides</td></tr>
          <tr><td><b>Side flashings</b> ×2</td><td>Left and right</td><td>Carry that water down past the box, in the pans</td></tr>
          <tr><td><b>Front apron</b></td><td>Downslope face</td><td>Returns the water onto the roof below the box</td></tr>
          <tr><td><b>Saddle</b></td><td>Ridge to the top of the box</td><td>Splits the flow above the box so it never arrives head-on</td></tr>
        </tbody>
      </table>
      </div>
      <p>Ordering one flashing for a chimney is ordering a fifth of a chimney. Write the five out
        every time, even when the box is small.</p>

      <h2>Where a penetration sits matters</h2>
      <ul>
        <li><strong>Not in a valley,</strong> and not close to one. A valley is already carrying
          the water off two planes.</li>
        <li><strong>Clear of a side lap.</strong> A penetration sitting on a lap means cutting
          both sheets and sealing a join in the middle of a hole.</li>
        <li><strong>Clear of the purlins</strong> you need to fix to, and of the ridge, where
          there is no room upslope for a tray.</li>
        <li><strong>In a pan, not on a rib,</strong> wherever the plumbing allows it. Cutting
          through a rib takes away the stiffness the sheet has at exactly the point you have made
          a hole in it.</li>
      </ul>
      <p>On a re-roof you usually inherit the positions. On a new roof it is worth a conversation
        with the plumber before anything is cut, because moving a pipe 300 mm on paper is free and
        moving it later is not.</p>

      <h2>Counting them for the order</h2>
      <p>Per penetration, the list is:</p>
      <ol>
        <li>The dektite, sized to the pipe, and rated for the temperature</li>
        <li>The back-tray, full or short, at a length</li>
        <li>Sealant, and the fixings for the base</li>
        <li>For a boxed penetration, five flashing pieces instead of items 1 and 2</li>
      </ol>
      <p>Then count the sheets again. A penetration usually means at least one sheet is cut, and
        on a boxed one it can be two or three — which is a cut list change, not just an extra
        line on the flashing schedule.</p>
      <p>How the rest of the flashings are counted is in
        <a href="/guides/roof-flashings-explained">roof flashings explained</a>, and the
        per-piece allowance for laps and trims is in
        <a href="/guides/flashing-wastage">flashing wastage</a>.</p>`,
  faq: [
    { q: 'Do I need a back-tray with every dektite?',
      a: ['On any penetration with roof above it, yes. The dektite seals the pipe; the back-tray stops the water from the whole upslope catchment arriving at the base of the boot.',
          'It is the single most-forgotten item on a roofing order, because the plan shows a pipe and the docket shows a dektite, and nothing anywhere asks for the tray.'] },
    { q: 'What is the difference between a full and a short back-tray?',
      a: ['A full tray runs from the penetration all the way to the ridge, so nothing upslope can reach it. A short tray runs a defined distance above the penetration.',
          'Full is the safe choice on low pitch, on long runs above the penetration, and where you are not certain. Short uses less steel and is fine on a steeper roof with little run above the hole.'] },
    { q: 'How many flashings does a boxed chimney need?',
      a: ['Five: a back flashing on the upslope face, a side flashing each side, a front apron below, and a saddle running from the ridge down to the top of the box.',
          'Ordering "a chimney flashing" gets you one of the five. Write all five out on the schedule, every time.'] },
    { q: 'How do I size a dektite?',
      a: ['By the outside diameter of the pipe. The sizes overlap, and the cone is cut to the measured pipe — so measure the pipe rather than inferring it from the fitting or the plan.',
          'Check the temperature rating separately. A flue needs a high-temperature material; the standard one is not rated for it.'] },
    { q: 'Where should a penetration not go?',
      a: ['Not in or beside a valley, not on a side lap, not right at the ridge where there is no room for a tray, and not through a rib if the plumbing allows a pan instead.',
          'On a re-roof you usually inherit the positions. On a new roof, sorting it with the plumber before anything is cut costs nothing.'] },
    { q: 'Does a penetration change the sheet count?',
      a: ['Often, yes. A pipe usually means one sheet is cut; a boxed penetration can involve two or three, and they may need to be ordered as separate lengths.',
          'That makes a penetration a cut-list item as well as a flashing item, which is a second place it can be missed.'] },
  ],
  next: NEXT_APP,
};

const COASTAL = {
  ...base,
  file: 'guides-coastal-zones-and-warranties.html',
  url: '/guides/coastal-zones-and-warranties',
  kind: 'guide',
  title: 'Coastal zones and roofing warranties in NZ',
  description: 'How distance to breaking surf sets the corrosion zone, what that does to a steel roof warranty, and the installation details that void one after it is written.',
  h1: 'Coastal zones and warranties',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Coastal zones and warranties', url: '/guides/coastal-zones-and-warranties' }],
  about: ['Coastal corrosion', 'Roofing warranty', 'New Zealand'],
  stand: `The zone is not a label on a product — it is a property of the address. Establishing it
    is the first thing you do on a coastal job, and it decides the warranty you can promise.`,
  answer: `<strong>Corrosion severity is set by distance to breaking surf:</strong> mild at 5 km
    or more, moderate 500 m to 1 km, severe 100 to 500 m, very severe 25 to 100 m. The zone
    decides which products can be warranted at the address and for how long. It is established
    before the material is specified, not after — and the warranty that results is conditional on
    installation detail and on maintenance, both of which sit with you to get right and with the
    owner to keep up.`,
  body: `      <h2>The four zones</h2>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Zone</th><th>Distance to breaking surf</th><th>What it means on the job</th></tr></thead>
        <tbody>
          <tr><td><b>Mild</b></td><td>5 km or more</td><td>The full range is available and warranties are at their longest.</td></tr>
          <tr><td><b>Moderate</b></td><td>500 m – 1 km</td><td>Pre-painted, and the coating tier starts to matter.</td></tr>
          <tr><td><b>Severe</b></td><td>100 – 500 m</td><td>Coastal-grade coating. Warranty periods shorten.</td></tr>
          <tr><td><b>Very severe</b></td><td>25 – 100 m</td><td>Premium coating, heavier gauge worth considering, and read the warranty statement before you promise anything.</td></tr>
        </tbody>
      </table>
      </div>
      <p>Note what the measurement is: <strong>breaking surf</strong>, not water. It is the
        airborne salt off the break that does the damage, so a sheltered harbour edge is a milder
        environment than an open surf beach at the same distance from the sea.</p>

      <h2>Establishing the zone for a real address</h2>
      <p>The zone is a site assessment, not a lookup. Four things go into it:</p>
      <ul>
        <li><strong>Distance to the nearest breaking surf</strong>, in a straight line. Measure it
          off a map before you go, then look at what is actually between the house and the water.</li>
        <li><strong>Shelter.</strong> A hill, a stand of trees or a row of houses between the
          building and the coast changes what reaches the roof. So does being in a bay rather than
          on an open coast.</li>
        <li><strong>Prevailing wind.</strong> A house downwind of an open coast sees more salt than
          one the same distance away in the lee.</li>
        <li><strong>Anything else corrosive nearby.</strong> Geothermal activity, industrial
          discharge, and animal housing all have their own effect and they are not about the sea
          at all.</li>
      </ul>
      <p>Where a site sits between two zones, the honest move is to price the more severe one and
        say why. It is a conversation worth having in front of the customer, because it explains
        the price difference between the quote you have written and a cheaper one they may be
        holding.</p>

      <h2>What the warranty is, and what it is not</h2>
      <p>A steel roof usually carries more than one:</p>
      <ul>
        <li><strong>The perforation warranty</strong> — the sheet will not rust through. This is
          the long number, and it is the one that shortens with the zone.</li>
        <li><strong>A surface or appearance warranty</strong> — the coating will not chalk or fade
          beyond a stated limit. Usually a shorter period.</li>
        <li><strong>Your workmanship warranty</strong>, which is a separate thing entirely and
          comes from you, not the manufacturer.</li>
      </ul>
      <p>Indicative figures: premium pre-painted lines reach up to fifty years' perforation cover
        in mild zones; plain unpainted Zincalume carries a twenty-year non-perforation warranty;
        cheaper pre-painted ranges sit around thirty in mild environments. All of them come down
        as the zone gets worse.</p>
      <p><strong>Check the current published warranty for the product, the tier and the specific
        zone before you write a number in a quote.</strong> Manufacturers revise them, they vary by
        colour and coating, and a warranty quoted from memory is one you are personally
        underwriting.</p>

      <h2>What voids one</h2>
      <p>This is the half of the subject that gets skipped, and it is the half that turns into an
        argument in year seven. A warranty is conditional on the roof having been installed and
        looked after properly, and the usual conditions are:</p>
      <ul>
        <li><strong>Compatible fixings and flashings.</strong> The screws, rivets and flashings
          have to belong to the same system as the sheet. A cheaper fastener is the classic way to
          void an expensive warranty.</li>
        <li><strong>No dissimilar metals.</strong> Copper, lead or unprotected steel in contact
          with, or draining onto, the roof will corrode it. That includes a copper pipe discharging
          onto a steel roof and a lead flashing left in place from the old one.</li>
        <li><strong>Swarf removed.</strong> Drilling and cutting swarf left on a sheet rusts into
          it, and the marks are permanent long before they are structural. Sweep as you go, not at
          the end of the day.</li>
        <li><strong>Unwashed areas washed.</strong> Anywhere the roof is sheltered from rain —
          under an eave, behind a parapet, under a solar array — accumulates salt that rain would
          otherwise rinse off. Those areas need washing down periodically, and the obligation is
          the owner's.</li>
        <li><strong>No unprotected cut edges</strong> where the specification requires them
          treated, and no storage of the sheets wet or stacked in the weather before they go up.</li>
      </ul>

      <h2>Put it in the quote</h2>
      <p>Three lines protect everybody:</p>
      <ol>
        <li><strong>The zone you have assessed and the basis for it</strong> — the distance and
          the exposure. If the roof is later assessed as a worse zone than you priced, this is the
          record of what you were told and what you saw.</li>
        <li><strong>The product, tier, gauge and colour</strong>, in full. Not "new Colorsteel
          roof" — that is a description a cheaper steel also fits, and it loses on price to
          something that is not the same product.</li>
        <li><strong>The maintenance the warranty depends on</strong>, in plain words, so the owner
          knows on the day they sign that washing the sheltered areas is part of owning the roof.</li>
      </ol>
      <p>Which product suits which zone is covered in
        <a href="/guides/colorsteel-grades-compared">Colorsteel grades compared</a>.</p>`,
  faq: [
    { q: 'How do I work out the coastal zone for a house?',
      a: ['Measure the straight-line distance to the nearest breaking surf, then adjust for what is actually between the building and the water — shelter, terrain, prevailing wind, and any other corrosive influence like geothermal activity or industry.',
          'Mild is 5 km or more, moderate 500 m to 1 km, severe 100 to 500 m, very severe 25 to 100 m.'] },
    { q: 'Why is it distance to breaking surf and not distance to the sea?',
      a: ['Because the salt that corrodes a roof is airborne, and it comes off the break rather than off flat water.',
          'An open west-coast beach at 300 m is a far harder environment than a sheltered harbour edge at the same distance. The measurement is to where the waves break.'] },
    { q: 'What voids a roofing warranty?',
      a: ['Incompatible fixings or flashings, contact with or drainage from dissimilar metals such as copper and lead, swarf left on the sheets, and failing to wash down areas the rain never reaches.',
          'The last one is the owner’s obligation rather than yours, which is exactly why it belongs in the quote in writing rather than in a conversation on the day.'] },
    { q: 'What is an unwashed area?',
      a: ['Anywhere on the roof that rain does not reach — under a wide eave, behind a parapet, beneath a solar array, under a carport overhang.',
          'Salt and dirt build up there instead of being rinsed off, and those are the places a coastal roof fails first. Manufacturers require them to be washed down periodically for the warranty to stand.'] },
    { q: 'Can I use a mild-zone product 300 m from the coast if the customer wants to save money?',
      a: ['You can physically fit it, and the warranty will not cover it. That means when it fails you are the one holding the problem, because the manufacturer will point at the specification.',
          'Price the correct product, explain what the zone is and why, and let the customer decide with the information in front of them. Put the assessment in the quote either way.'] },
    { q: 'Does a heavier gauge help in a coastal zone?',
      a: ['It is worth considering. 0.55 mm is standard practice in severe zones and gives more metal between the weather and the inside, as well as stiffness underfoot.',
          'It is not a substitute for the right coating, though. Gauge and grade are separate decisions and the coating is the one that fights corrosion.'] },
  ],
  next: NEXT_APP,
};

const SCOPE = {
  ...base,
  file: 'guides-re-roof-scope-of-work.html',
  url: '/guides/re-roof-scope-of-work',
  kind: 'guide',
  title: 'Re-roof scope of work: what to include',
  description: 'What belongs in a re-roof scope of work and what belongs in the exclusions, line by line — the half of a roofing quote that decides how the variations go.',
  h1: 'Writing a re-roof scope of work',
  crumbs: [{ name: 'RoofMap', url: '/' }, { name: 'Guides', url: '/guides' }, { name: 'Re-roof scope of work', url: '/guides/re-roof-scope-of-work' }],
  about: ['Roof estimating', 'Scope of work', 'Re-roofing'],
  stand: `A price and a product name is not a quote. The scope is the half that decides what
    happens when something unexpected comes off the roof with the old iron.`,
  answer: `<strong>A re-roof scope says four things: what you are removing, what you are
    installing, what you are leaving, and what you are not touching.</strong> The exclusions are
    the part that protects you — rotten framing found once the roof is off, asbestos or lead,
    anything needing a consent, and painting. Write both halves before the price, because the
    price only means something once the scope is fixed.`,
  body: `      <h2>Why the exclusions are the important half</h2>
      <p>Everything in a re-roof that turns into an argument is something nobody could see when
        the quote was written. Purlins are under the roof. Framing is under the purlins. Whatever
        the last person did is under all of it.</p>
      <p>A scope that lists only what is included leaves every one of those as an open question,
        and the customer's honest reading of an open question is that it was covered. Naming them
        as exclusions is not defensive paperwork — it is the sentence that lets you price the
        variation calmly instead of arguing about whether there is one.</p>

      <h2>What goes in the inclusions</h2>
      <div class="tscroll">
      <table class="data">
        <thead><tr><th>Line</th><th>What to actually write</th></tr></thead>
        <tbody>
          <tr><td><b>Strip and disposal</b></td><td>Remove the existing roof and cart it away — or leave it on site if that is what was agreed. Say which.</td></tr>
          <tr><td><b>Underlay</b></td><td>New underlay by type. Self-supporting or netted where the pitch or purlin spacing calls for it.</td></tr>
          <tr><td><b>The new roof</b></td><td>Profile, brand and tier, gauge and colour. All four, not "new Colorsteel".</td></tr>
          <tr><td><b>Flashings</b></td><td>All new flashings, listed by type — ridge, hip, valley, barge, apron, change-of-pitch.</td></tr>
          <tr><td><b>Penetrations</b></td><td>Every penetration reflashed, with a dektite and back-tray each, and the five-piece set for anything boxed.</td></tr>
          <tr><td><b>Gutter and downpipes</b></td><td>New, or explicitly not. This is the single most common assumption gap in a roofing quote.</td></tr>
          <tr><td><b>Access</b></td><td>Scaffolding or edge protection, as its own line with its own price.</td></tr>
          <tr><td><b>Make-good</b></td><td>Site clean, magnet sweep, and what the property looks like when you leave.</td></tr>
        </tbody>
      </table>
      </div>

      <p>Two of those are worth a note.</p>
      <p><strong>Scaffolding belongs on its own line.</strong> It is a real cost the homeowner did
        not expect, and burying it in the rate makes the whole quote look expensive rather than
        making the access look expensive. Shown separately, it is a fact about their house.</p>
      <p><strong>Gutter is the assumption gap.</strong> If the quote does not say, the customer
        assumes new gutter and you assumed not — or the reverse. Say it either way, in one line.</p>

      <h2>What goes in the exclusions</h2>
      <ul>
        <li><strong>Rotten or damaged purlins, battens and framing</strong> discovered once the
          roof is off. Say how it will be handled: assessed, quoted, and agreed before it is
          done.</li>
        <li><strong>Asbestos and lead.</strong> On anything pre-1990, check before you price it.
          Asbestos-cement roofing and lead flashings both change the strip cost and the disposal,
          and neither is something to discover on the day. If you have not tested, exclude it
          explicitly.</li>
        <li><strong>Building consent.</strong> A like-for-like re-roof often does not need one, but
          changes — structural work, new penetrations, altering the pitch — can. Note whose job it
          is to find out and what happens if one is required.</li>
        <li><strong>Painting</strong>, of anything: fascia, soffit, barge boards, the inside.</li>
        <li><strong>Internal damage from pre-existing leaks</strong>, including ceilings, insulation
          and linings.</li>
        <li><strong>Anything not on the roof</strong> — electrical, plumbing relocation, aerials,
          solar removal and refit — unless it is written into the inclusions.</li>
      </ul>

      <h2>Repair or re-roof</h2>
      <p>Before any of the above, be clear which job you are quoting, and put the assessment in
        writing:</p>
      <ul>
        <li><strong>Re-roof</strong> when the coating has chalked through, the fixings are
          corroded, or there is perforation at the laps. That roof is at the end of its life and a
          repair buys a season.</li>
        <li><strong>Repair</strong> when a sound roof has taken specific damage — a storm-damaged
          sheet, a failed penetration, a run of fixings.</li>
      </ul>
      <p>A homeowner who understands <em>why</em> it needs doing argues about the price far less.
        The condition assessment is the cheapest part of the quote to write and the part that does
        the most work.</p>

      <h2>Things worth naming that people leave out</h2>
      <ul>
        <li><strong>Tile-to-steel conversion.</strong> Over-purlining is its own line, and it
          changes the fixing detail and the eave.</li>
        <li><strong>Ventilation.</strong> Ridge vents or eave intake, if the roof needs it, is a
          scope line and often a flashing line as well.</li>
        <li><strong>Fascia and soffit.</strong> Not roof, not flashing, not included unless said.</li>
        <li><strong>Solar, aerials, satellite dishes.</strong> Removing and refitting them, or
          explicitly not, and who is responsible if a panel is damaged.</li>
        <li><strong>Access and parking</strong>, on a tight site. Whether the truck can get to the
          eave is a real cost and a real risk.</li>
        <li><strong>How long the roof is open.</strong> What happens if it rains mid-strip, and
          what the customer should expect.</li>
      </ul>

      <h2>The quote around the scope</h2>
      <p>Two more things belong on the document itself: how long the price is valid — thirty days
        is a normal default, and re-issuing at current prices after that is fair on both sides —
        and the payment terms, including any deposit.</p>
      <p>The full method that produces the numbers the scope wraps around is in
        <a href="/guides/how-to-quote-a-re-roof">how to quote a re-roof</a>.</p>`,
  faq: [
    { q: 'What should be in a re-roof scope of work?',
      a: ['What you are removing, what you are installing, what you are leaving, and what you are not touching. Specifically: the strip and disposal, underlay, the new roof by profile, brand, gauge and colour, all flashings by type, every penetration reflashed, guttering and downpipes or explicitly not, scaffolding or edge protection, and the make-good.',
          'Then the exclusions, which are the half that protects you.'] },
    { q: 'What should I exclude from a roofing quote?',
      a: ['Rotten purlins or framing found once the roof is off, asbestos or lead discovered in the strip, anything requiring a building consent, painting, internal damage from pre-existing leaks, and anything that is not on the roof.',
          'Say how each will be handled if it appears — assessed, quoted, and agreed before it is done — rather than only that it is excluded.'] },
    { q: 'Should scaffolding be a separate line?',
      a: ['Yes. It is a real cost the homeowner did not expect, and burying it in the rate makes the whole quote look expensive rather than making the access look expensive.',
          'Shown separately, it reads as a fact about their house rather than as your margin.'] },
    { q: 'Do I need to allow for asbestos on an old roof?',
      a: ['On anything pre-1990, check before you price it. Asbestos-cement roofing and lead flashings both change the strip cost and the disposal, and neither is something to discover on the day.',
          'If you have not tested, exclude it explicitly in the scope and say what happens if it is found.'] },
    { q: 'Does a re-roof need a building consent?',
      a: ['A like-for-like re-roof often does not, but changes can — structural work, adding penetrations, altering the pitch, or changing the roof mass on a tile-to-steel conversion.',
          'Check with the council for the specific job, and note in the scope whose responsibility it is and what happens if a consent turns out to be required.'] },
    { q: 'How long should a re-roof quote stay valid?',
      a: ['Thirty days is a normal default. Supplier prices move, and re-issuing at current pricing after the window is fair on both sides.',
          'Put the validity period on the document rather than leaving it open, so a quote accepted six months later is a conversation rather than an argument.'] },
  ],
  next: NEXT_APP,
};

export default [GUIDES_INDEX, FLASHINGS, SHEETS, PITCH, GRADES,
                WASTAGE, PIPES, COASTAL, SCOPE, CALC_PITCH, CALC_SHEET];

