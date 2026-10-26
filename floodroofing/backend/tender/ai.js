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

module.exports = { MODELS, costUsd, prompt, available, structured, classifyPage, CLASSIFY_TOOL, TENDER_TOOL, draftTender, amendTender };
