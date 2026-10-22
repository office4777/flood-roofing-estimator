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

// One structured call: system prompt (cached), images + text in the user
// turn, one tool the model is told to call. Returns {input, usage, model,
// promptVersion, ms, raw} or throws. `images` = [{mime, base64, label}].
async function structured(pass, promptName, tool, text, images, opts){
  opts = opts || {};
  const p = prompt(promptName);
  const model = opts.model || MODELS[pass] || MODELS.classify;
  const t0 = Date.now();
  if (globalThis.__TEST_TENDER_AI) {
    const input = await globalThis.__TEST_TENDER_AI({ pass, promptVersion: p.version, text, images: (images || []).map(i => ({ mime: i.mime, label: i.label, bytes: i.base64 ? i.base64.length : 0 })), tool: tool.name });
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
  const res = await c.messages.create({
    model, max_tokens: opts.maxTokens || 1500,
    system: [{ type: 'text', text: p.text, cache_control: { type: 'ephemeral' } }],
    tools: [tool],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  });
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
  const r = await structured('classify', 'classify-page', CLASSIFY_TOOL, text, images, opts);
  const i = r.input || {};
  r.result = {
    cls: i.class || 'other', sheetId: String(i.sheet_id || '').trim().toUpperCase(), title: String(i.title || '').trim(),
    revision: String(i.revision || '').trim().toUpperCase(), scale: String(i.scale || '').trim(),
    conf: Math.max(0, Math.min(1, +i.confidence || 0)), reason: String(i.reason || '').slice(0, 300),
  };
  return r;
}

module.exports = { MODELS, costUsd, prompt, available, structured, classifyPage, CLASSIFY_TOOL };
