// AI Tendering — every call to Claude the tendering pipeline makes.
//
// The key lives here and nowhere else (ANTHROPIC_API_KEY on the server; the
// browser never sees it). Each pass has its own model picked by env so the
// cheap one can be swapped without a ship:
//   TENDER_MODEL_CLASSIFY  (default claude-haiku-5-5)  — what is this page
//   TENDER_MODEL_EXTRACT   (default claude-sonnet-5-5) — P2, the spec pull
//   TENDER_MODEL_REASON    (default claude-opus-5-5)   — P3+, scope and RFIs
// Prompts are files under prompts/ai-tendering/<name>.v<N>.md and the
// version is written on every run row, so a change in wording can be
// matched to a change in results.
//
// The test seam: globalThis.__TEST_TENDER_AI = async (req) => toolInput —
// `req` is {pass, promptVersion, text, images:[…]} and the stand-in answers
// what the tool would have been called with. No SDK, no network.
'use strict';
const fs = require('fs');
const path = require('path');

const MODELS = {
  classify: process.env.TENDER_MODEL_CLASSIFY || 'claude-haiku-5-5',
  extract:  process.env.TENDER_MODEL_EXTRACT  || 'claude-sonnet-5-5',
  reason:   process.env.TENDER_MODEL_REASON   || 'claude-opus-5-5',
};
// USD per million tokens [input, output, cache read, cache write]. Used for
// the cost column on tender_ai_runs only — the invoice is Anthropic's.
const PRICES = {
  'claude-haiku-5-5':  [0.10, 0.50, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.20, 2.5],
  'claude-opus-5-5':   [4, 20, 0.20, 5],
};
function costUsd(model, u){
  const p = PRICES[model] || [0, 0, 0, 0];
  if (!u) return 0;
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] +
    (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}

const _prompts = {};
function prompt(name){
  // "classify-page" → the highest vN on disk, read once.
  if (_prompts[name]) return _prompts[name];
  const dir = path.join(__dirname, '..', 'prompts', 'ai-tendering');
  const files = fs.readdirSync(dir).filter(f => f.startsWith(name + '.v') && f.endsWith('.md'));
  if (!files.length) throw new Error('no prompt file for ' + name);
  files.sort((a, b) => parseInt(a.match(/\.v(\d+)\./)[1], 10) - parseInt(b.match(/\.v(\d+)\./)[1], 10));
  const file = files[files.length - 1];
  _prompts[name] = { text: fs.readFileSync(path.join(dir, file), 'utf8'), version: file.replace(/\.md$/, '') };
  return _prompts[name];
}

let _client = null;
function client(){
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120000 });
  return _client;
}
function available(){ return !!(globalThis.__TEST_TENDER_AI || process.env.ANTHROPIC_API_KEY); }

const CLASSIFY_TOOL = {
  name: 'classify_page',
  description: 'Record what this plan-set page is.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['class', 'sheet_id', 'title', 'revision', 'scale', 'confidence', 'reason'],
    properties: {
      class: { type: 'string', enum: ['cover', 'index', 'site_plan', 'floor_plan', 'roof_plan', 'roof_framing', 'elevation', 'section', 'detail_roof', 'detail_other', 'spec', 'schedule', 'structural', 'services', 'other'] },
      sheet_id: { type: 'string' }, title: { type: 'string' }, revision: { type: 'string' }, scale: { type: 'string' },
      confidence: { type: 'number' }, reason: { type: 'string' },
    },
  },
};

// A strict tool whose schema the API will not compile is asked again as a
// plain tool: the answer is still checked by the code that reads it, and a
// refused schema should never cost the office its tender.
async function send(c, params, opts){
  const go = (pp) => opts.stream ? c.messages.stream(pp, { timeout: opts.timeoutMs || 15 * 60000 }).finalMessage() : c.messages.create(pp);
  try { return await go(params); }
  catch (e) {
    const msg = String(e && e.message || e);
    if (!(e && e.status === 400 && /strict|schema|grammar/i.test(msg) && params.tools[0].strict)) throw e;
    return await go(Object.assign({}, params, { tools: [Object.assign({}, params.tools[0], { strict: false })] }));
  }
}

// One structured call: system prompt (cached), images + text in the user
// turn, one tool the model is told to call. Returns {input, usage, model,
// promptVersion, ms, raw} or throws. `images` = [{mime, base64, label}].
async function structured(pass, promptName, tool, text, images, opts){
  opts = opts || {};
  const p = prompt(promptName);
  const model = opts.model || MODELS[pass] || MODELS.classify;
  const t0 = Date.now();
  if (globalThis.__TEST_TENDER_AI) {
    const input = await globalThis.__TEST_TENDER_AI({ pass, promptVersion: p.version, text, doc: opts.doc, images: (images || []).map(i => ({ mime: i.mime, label: i.label, bytes: i.base64 ? i.base64.length : 0 })), tool: tool.name });
    return { input, usage: { input_tokens: 1000, output_tokens: 80 }, model: 'test', promptVersion: p.version, ms: Date.now() - t0, raw: null };
  }
  const c = client();
  if (!c) throw new Error('ANTHROPIC_API_KEY is not set on the server');
  const content = [];
  for (const im of (images || [])) {
    if (im.label) content.push({ type: 'text', text: im.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/jpeg', data: im.base64 } });
  }
  content.push({ type: 'text', text });
  const params = {
    model, max_tokens: opts.maxTokens || 4000,
    system: [{ type: 'text', text: p.text, cache_control: { type: 'ephemeral' } }],
    tools: [tool],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  };
  // Haiku 5.5 thinks by default, and a 1,500-token answer budget spent on
  // thinking left no room for the tool call — every page of the first real
  // set came back "AI failed". A small task asks for low effort.
  if (opts.effort) params.output_config = { effort: opts.effort };
  let res;
  if (opts.stream) {
    // A long answer (the whole tender) streams, so no request sits silent
    // long enough to be cut off; the beat keeps the task's heartbeat fresh.
    const beat = opts.onBeat ? setInterval(() => { try { opts.onBeat(); } catch (e) {} }, 30000) : null;
    try { res = await send(c, params, opts); }
    finally { if (beat) clearInterval(beat); }
  } else {
    res = await send(c, params, opts);
  }
  if (res.stop_reason === 'max_tokens') throw new Error('the answer ran out of room before it was finished');
  if (res.stop_reason === 'refusal') throw new Error('the model refused this page');
  const tu = (res.content || []).find(b => b.type === 'tool_use' && b.name === tool.name);
  if (!tu) {
    const txt = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0, 200);
    throw new Error('no tool call in the answer' + (txt ? (': ' + txt) : ''));
  }
  return { input: tu.input, usage: res.usage || {}, model, promptVersion: p.version, ms: Date.now() - t0, raw: res };
}

// Classify one page. `page` = {titleBlockText, text, imageBase64, tbBase64}.
async function classifyPage(page, opts){
  const text = [
    'TITLE BLOCK TEXT (bottom-right / right edge of the sheet):', page.titleBlockText || '(none found)',
    '', 'HEURISTIC READ (may be wrong): ' + JSON.stringify(page.heuristic || {}),
    '', 'PAGE TEXT (first part):', (page.text || '(no text layer — read the picture)').slice(0, 6000),
  ].join('\n');
  const images = [];
  if (page.imageBase64) images.push({ mime: 'image/jpeg', base64: page.imageBase64, label: 'The whole page:' });
  if (page.tbBase64) images.push({ mime: 'image/jpeg', base64: page.tbBase64, label: 'Close-up of the title block corner:' });
  const r = await structured('classify', 'classify-page', CLASSIFY_TOOL, text, images, Object.assign({ effort: 'low', maxTokens: 4000 }, opts || {}));
  const i = r.input || {};
  r.result = {
    cls: i.class || 'other', sheetId: String(i.sheet_id || '').trim().toUpperCase(), title: String(i.title || '').trim(),
    revision: String(i.revision || '').trim().toUpperCase(), scale: String(i.scale || '').trim(),
    conf: Math.max(0, Math.min(1, +i.confidence || 0)), reason: String(i.reason || '').slice(0, 300),
  };
  return r;
}


// ── the tender itself (2026-10-27) ──────────────────────────────────
const S = (d) => ({ type: 'string', description: d || '' });
const N = (d) => ({ type: 'number', description: d || '' });
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const ITEM_CATS = ['roofing', 'underlay', 'cavity_vent', 'membrane', 'gutter', 'downpipe', 'flashing', 'safety_mesh', 'wall_cladding', 'fascia', 'insulation', 'fixings', 'other'];
const UNITS = ['m2', 'lm', 'each', 'roll', 'set', 'lot'];
const TENDER_TOOL = {
  name: 'record_tender',
  description: 'Record the whole roofing tender: spec items with quantities and costs, labour, scope, exclusions, programme.',
  strict: true,
  input_schema: obj({
    project: obj({ name: S(), address: S(), client: S(), architect: S(), tender_closes: S(), documents: S('drawing set and revision') }),
    roof: obj({ area_m2: N('total roof area along the slope'), pitch: S(), roof_type: S(), existing_roof: S(), job_kind: { type: 'string', enum: ['new', 'reroof', 'repair', 'unknown'] } }),
    items: { type: 'array', items: obj({
      id: S('short stable id, e.g. i1'), category: { type: 'string', enum: ITEM_CATS }, description: S(), product: S(), profile: S(), thickness: S(),
      material: S('steel grade / coating / substrate'), colour: S(), spec_ref: S(), source_pages: S(), quantity: N(), unit: { type: 'string', enum: UNITS },
      qty_basis: S(), pb_key: S('price book key or ""'), unit_cost: N('NZD ex GST per unit, what we pay'), confidence: N(),
    }) },
    labour: { type: 'array', items: obj({ id: S(), task: S(), man_hours: N(), crew: N(), notes: S() }) },
    scaffold: obj({ needed: { type: 'boolean' }, type: { type: 'string', enum: ['edge', 'platform', 'none'] }, notes: S() }),
    scope: { type: 'array', items: S() },
    exclusions: { type: 'array', items: obj({ text: S(), why: S() }) },
    assumptions: { type: 'array', items: S() },
    rfis: { type: 'array', items: S() },
    timeline: { type: 'array', items: obj({ id: S(), phase: S(), start_day: N(), days: N(), crew: N(), notes: S() }) },
    duration_days: N(),
    confidence_notes: S(),
  }),
};

// The draft: the whole set's text plus pictures of the pages that matter.
// `pages` = [{pageNo, label, text, imageBase64?}], `ctx` = {priceBook, labour}.
async function draftTender(pages, ctx, opts){
  const parts = ['PRICE BOOK (key | item | price per unit, ex GST):', ctx.priceBook || '(none)', '',
    'LABOUR: ' + (ctx.labour || '(not set)'), '', 'THE PLAN SET, PAGE BY PAGE:'];
  // About 90k tokens of text at most: with the pictures, the price book and
  // the answer it stays inside the model's 200k window.
  let budget = 320000;
  for (const pg of pages) {
    const t = String(pg.text || '').slice(0, Math.min(14000, budget));
    budget -= t.length;
    parts.push('', '=== ' + pg.label + ' ===', t || '(no text layer on this page — see its picture if one is attached)');
    if (budget <= 0) { parts.push('', '(the rest of the set\'s text is left out for length)'); break; }
  }
  const images = pages.filter(p => p.imageBase64).map(p => ({ mime: 'image/jpeg', base64: p.imageBase64, label: 'Picture of ' + p.label + ':' }));
  const r = await structured('reason', 'draft-tender', TENDER_TOOL, parts.join('\n'), images,
    Object.assign({ stream: true, maxTokens: 32000 }, opts || {}));
  r.result = r.input || {};
  return r;
}

// A change the estimator asked for: `doc` is the tender as it is now.
async function amendTender(doc, instruction, facts, opts){
  const text = ['THE TENDER AS IT IS NOW (JSON):', JSON.stringify(doc), '', 'ROOFING FACTS FROM THE PLANS:', facts || '(none kept)', '',
    'THE ESTIMATOR\'S INSTRUCTION:', String(instruction || '').slice(0, 4000)].join('\n');
  const r = await structured('extract', 'amend-tender', TENDER_TOOL, text, [], Object.assign({ stream: true, maxTokens: 32000, doc }, opts || {}));
  r.result = r.input || {};
  return r;
}

// One section of the tender document rewritten (2026-10-27): the words of
// a text section, a list, or the company's organisation structure. Small
// and fast — the whole-tender rewrite is for changes that move the price.
const SECTION_TOOL = {
  name: 'record_section',
  description: 'Record the rewritten section. Fill only the field the section uses; leave the others as empty arrays.',
  strict: true,
  input_schema: obj({
    paragraphs: { type: 'array', items: S('a paragraph of plain text') },
    bullets: { type: 'array', items: S('one bullet, plain text') },
    exclusions: { type: 'array', items: obj({ text: S(), why: S() }) },
    lines: { type: 'array', items: obj({ desc: S(), amount: N('NZD ex GST') }) },
    people: { type: 'array', items: obj({ id: S('short stable id, e.g. p1'), role: S(), name: S('the person\'s name, or "" if not given'), reports_to: S('id of the person above, or "" for the top'), note: S('e.g. "2 crews", qualifications, or ""') }) },
    question: S('a short clarifying question when the instruction could mean different things, with every other field left empty; otherwise ""'),
    summary: S('one short sentence saying what you changed, or "" when asking a question'),
  }),
};
async function editSection(section, label, current, instruction, opts){
  const parts = ['THE SECTION: ' + label + ' (' + section + ')', '', 'AS IT IS NOW:', String(current || '(empty)').slice(0, 20000), ''];
  const recent = ((opts && opts.chat) || []).slice(-6).map(m => (m.who === 'ai' ? 'A.I.: ' : 'Estimator: ') + String(m.text || '').slice(0, 1200));
  if (recent.length) parts.push('THE CONVERSATION SO FAR:', recent.join('\n'), '');
  parts.push('THE ESTIMATOR\'S INSTRUCTION:', String(instruction || '').slice(0, 4000));
  const text = parts.join('\n');
  opts = Object.assign({}, opts || {}); delete opts.chat;
  const r = await structured('extract', 'edit-section', SECTION_TOOL, text, [], Object.assign({ maxTokens: 6000 }, opts || {}));
  r.result = r.input || {};
  return r;
}

// The chat box (2026-10-28, the owner: "I would like the chat bot not to be
// focused on just changing the tender. But also asking questions"). Every
// message is read first: a question is answered from the tender and the
// plan set and changes nothing; only a change goes on to amendTender.
const ASK_TOOL = {
  name: 'record_reply',
  description: 'Record whether the estimator asked a question or asked for a change, and the answer to a question.',
  strict: true,
  input_schema: obj({
    kind: { type: 'string', enum: ['question', 'clarify', 'change'] },
    answer: S('the answer to a question, or the one clarifying question to ask; "" for a change'),
    pages: S('the sheets or pages the answer came from, e.g. "A201, A403", or ""'),
    instruction: S('for a change: the whole change in plain words, including what earlier messages settled; otherwise ""'),
    section: { type: 'string', enum: ['', 'tender', 'intro', 'terms', 'accept', 'priceNote', 'progNote', 'exclusions', 'assumptions', 'rfis', 'org', 'price'] },
  }),
};
// `plans` = [{label, text}], `images` = [{mime, base64, label}].
async function askTender(doc, message, plans, images, chat, opts){
  const parts = ['THE TENDER AS IT IS NOW (JSON):', JSON.stringify(doc), ''];
  const recent = (chat || []).slice(-8).map(m => (m.who === 'ai' ? 'A.I.: ' : 'Estimator: ') + String(m.text || '').slice(0, 1500));
  if (recent.length) parts.push('THE CONVERSATION SO FAR:', recent.join('\n'), '');
  parts.push('THE PLAN SET, PAGE BY PAGE:');
  let budget = 240000;
  for (const pg of (plans || [])) {
    const t = String(pg.text || '').slice(0, Math.min(10000, budget));
    budget -= t.length;
    parts.push('', '=== ' + pg.label + ' ===', t || '(no text layer on this page)');
    if (budget <= 0) { parts.push('', '(the rest of the set\'s text is left out for length)'); break; }
  }
  parts.push('', 'THE ESTIMATOR\'S MESSAGE:', String(message || '').slice(0, 4000));
  const r = await structured('extract', 'ask-tender', ASK_TOOL, parts.join('\n'), images || [], Object.assign({ maxTokens: 6000 }, opts || {}));
  const i = r.input || {};
  const kind = i.kind === 'question' || i.kind === 'clarify' ? i.kind : 'change';
  r.result = { kind, answer: String(i.answer || '').trim().slice(0, 6000), pages: String(i.pages || '').trim().slice(0, 300),
    instruction: String(i.instruction || '').trim().slice(0, 4000), section: String(i.section || '').trim() };
  if (kind === 'clarify' && !r.result.answer) r.result.kind = 'change';
  return r;
}

// ── New Build: the specs off a set of building plans (2026-11-09) ───
// The owner: "find out the specs of the detailed roof, for example, 0.55
// gauge maxim trim line, and that would populate in the quote with that
// product. And if it's saved in the price book, use that price. However, if
// it's not saved in the price book, just use an AI estimate." Text first
// (every page's text layer), pictures of the pages only when a set has none.
// Each spec names its page; where two pages disagree it is a CONFLICT, and the
// office is asked rather than the model choosing quietly.
const SPEC = (what) => obj({
  text: S('what the plans say, word for word as near as possible, or "" when the plans do not say'),
  match_id: S('the id from the company\'s list that is this product, or "" when none is'),
  pages: S('the page numbers it is stated on, e.g. "2, 6", or ""'),
  confidence: N('0 to 1'),
});
const NEWBUILD_TOOL = {
  name: 'record_specs',
  description: 'Record the roofing specification read off the building plans.',
  strict: true,
  input_schema: obj({
    roof_plan_page: N('the page number of the roof plan, or 0 if there is none'),
    pitch_deg: N('the roof pitch in degrees, or 0 when not stated'),
    pitch_pages: S('pages the pitch is stated on'),
    profile: SPEC('roof profile'),
    profile_rate_m2: N('when match_id is "": a typical NZ trade supply price for this profile in this grade and gauge, NZD ex GST per m2 of roof, else 0'),
    thickness: obj({ text: S('the gauge as stated, e.g. "0.55" or "0.40 BMT", or ""'), value: { type: 'string', enum: ['0.40', '0.55', ''] }, pages: S(), confidence: N() }),
    grade: SPEC('steel grade / coating'),
    gutter: SPEC('gutter'),
    downpipes: S('the downpipes as stated, or ""'),
    colour: S('the roof colour as stated, or ""'),
    underlay: S('the underlay as stated, or ""'),
    conflicts: { type: 'array', items: obj({ item: { type: 'string', enum: ['profile', 'thickness', 'grade', 'gutter', 'pitch', 'colour', 'other'] }, values: { type: 'array', items: obj({ text: S(), pages: S() }) }, note: S('one short sentence') }) },
    notes: { type: 'array', items: S('anything else on the roof the office should know, one line each') },
  }),
};
async function newbuildSpecs(pages, products, images, opts){
  const lines = (arr) => (arr || []).map(x => x.id + ' | ' + x.name).join('\n') || '(none)';
  const parts = ['THE COMPANY\'S PRODUCTS (id | name):', 'Steel grades:', lines(products && products.grades), '',
    'Roof profiles:', lines(products && products.profiles), '', 'Gutters:', lines(products && products.gutters), '',
    'THE PLAN SET, PAGE BY PAGE:'];
  let budget = 300000;
  for (const pg of (pages || [])) {
    const t = String(pg.text || '').slice(0, Math.max(0, Math.min(40000, budget)));
    budget -= t.length;
    parts.push('=== PAGE ' + pg.page + ' ===', t || '(no text on this page)');
    if (budget <= 0) break;
  }
  const r = await structured('extract', 'newbuild-specs', NEWBUILD_TOOL, parts.join('\n'), images || [], Object.assign({ maxTokens: 6000 }, opts || {}));
  r.result = r.input || {};
  return r;
}

module.exports = { MODELS, NEWBUILD_TOOL, newbuildSpecs, costUsd, prompt, available, structured, classifyPage, CLASSIFY_TOOL, TENDER_TOOL, SECTION_TOOL, ASK_TOOL, draftTender, amendTender, editSection, askTender };
