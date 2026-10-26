// AI Tendering — the company's own prices, as a list the model can pick from.
//
// The tender's materials are priced from the price book FIRST. The model is
// handed this list (key, what it is, unit, price) and names the key it
// matched for each item; the server then takes the price from HERE, not from
// what the model wrote, so a figure on the pricing sheet marked "Price book"
// is the office's own figure to the cent. Anything with no match carries the
// model's estimate and says so.
'use strict';

const LABELS = {
  ridge_lm: ['Ridge / hip flashing (roundtop)', 'lm'],
  ridge_wide_lm: ['Wide-cover ridge / hip flashing', 'lm'],
  valley_lm: ['Valley flashing', 'lm'],
  gutter_lm: ['Gutter (generic)', 'lm'],
  barge_lm: ['Barge flashing', 'lm'],
  apron_lm: ['Apron flashing', 'lm'],
  changepitch_lm: ['Change-of-pitch flashing', 'lm'],
  box_pen_lm: ['Boxed penetration flashing set', 'lm'],
  screws_each: ['Roofing screw', 'each'],
  rivets_each: ['Rivet', 'each'],
  downpipe_ea: ['Downpipe', 'each'],
};
const GUTTER_LABELS = {
  box125_lm: '125mm Colorsteel box gutter (brackets included)',
  dropper_ea: '80mm dropper / outlet',
  typhoon_spouting_lm: 'Marley Typhoon spouting', typhoon_bracket_ea: 'Marley Typhoon bracket', typhoon_outlet_ea: 'Marley Typhoon outlet',
  typhoon_joiner_ea: 'Marley Typhoon joiner', typhoon_corner_ea: 'Marley Typhoon corner', typhoon_stopend_ea: 'Marley Typhoon stop end',
  typhoon_expjoiner_ea: 'Marley Typhoon expansion joiner', typhoon_weldsolvent_ea: 'Weld solvent tube',
  classic_spouting_lm: 'Marley Classic spouting', classic_bracket_ea: 'Marley Classic bracket', classic_outlet_ea: 'Marley Classic outlet',
  classic_joiner_ea: 'Marley Classic joiner', classic_corner_ea: 'Marley Classic angle', classic_stopend_ea: 'Marley Classic stop end',
  marley_typhoon_lm: 'Marley Typhoon (all-in $/lm)',
  ext_bracket_box125_lm: 'External bracket upcharge, box gutter', ext_bracket_marley_lm: 'External bracket upcharge, Marley',
};
const unitOf = (k) => /_lm$/.test(k) ? 'lm' : /_ea$|_each$/.test(k) ? 'each' : 'each';
const num = (v) => { const n = +v; return isFinite(n) && n > 0 ? +n.toFixed(4) : 0; };

// row = the user_settings row ({price_book}). Returns [{key,label,unit,price,source}].
function catalog(row){
  const pb = (row && row.price_book) || {};
  const out = [];
  const add = (key, label, unit, price, source) => { const p = num(price); if (p) out.push({ key, label: String(label || key).slice(0, 120), unit, price: p, source: source || 'Price book' }); };
  (Array.isArray(pb.sheets) ? pb.sheets : []).forEach((s, i) => s && add('sheet:' + i, (s.product || 'Roofing sheet') + ' (roofing sheet)', s.unit === 'lm' ? 'lm' : 'm2', s.price));
  const cat = pb.__materials_catalog || (row && row.materials_catalog) || {};
  (Array.isArray(cat.underlays) ? cat.underlays : []).forEach(u => u && u.name && add('underlay:' + u.name, u.name + (u.m2 ? (' (' + u.m2 + ' m² roll)') : ' (roll)'), 'roll', u.price));
  Object.keys(pb.underlay || {}).forEach(k => add('underlay.' + k, 'Underlay, ' + k + ' m² roll', 'roll', pb.underlay[k]));
  Object.keys(LABELS).forEach(k => add(k, LABELS[k][0], LABELS[k][1], pb[k]));
  Object.keys(pb.gutter || {}).forEach(k => add('gutter.' + k, GUTTER_LABELS[k] || k.replace(/_/g, ' '), unitOf(k), pb.gutter[k]));
  Object.keys(pb.backtray_prices || {}).forEach(k => add('backtray:' + k, k, 'lm', pb.backtray_prices[k]));
  Object.keys(pb.aquaseal || {}).forEach(k => add('aquaseal.' + k, 'Aquaseal pipe flashing ' + k.replace(/^no/, 'No '), 'each', pb.aquaseal[k]));
  (Array.isArray(pb.extras) ? pb.extras : []).forEach((x, i) => x && add('extra:' + i, x.desc, x.unit || 'each', x.price));
  const cb = pb.custom_book || {};
  (Array.isArray(cb.items) ? cb.items : []).forEach(it => {
    if (!it || !it.id) return;
    add('custom:' + it.id, (it.desc || it.code || 'Item') + (it.supplier ? (' — ' + it.supplier) : ''), String(it.unit || 'each').toLowerCase(), it.cost, 'Custom price book');
  });
  return out.slice(0, 600);
}

// The list as the model reads it: one line an item.
function asText(list){
  if (!list.length) return '(this business has no price book loaded — estimate every price)';
  return list.map(x => x.key + ' | ' + x.label + ' | $' + x.price.toFixed(2) + ' per ' + x.unit).join('\n');
}

// Put the price book's own figure on every item the model matched.
function applyPrices(items, list){
  const byKey = {};
  list.forEach(x => { byKey[x.key] = x; });
  return (items || []).map(it => {
    const m = it.pb_key && byKey[it.pb_key];
    const o = Object.assign({}, it, { ai_unit_cost: +(+it.unit_cost || 0).toFixed(2) });
    if (m) { o.unit_cost = m.price; o.cost_source = 'pricebook'; o.pb_label = m.label; o.pb_unit = m.unit; }
    else { o.pb_key = ''; o.cost_source = 'estimate'; o.unit_cost = +(+it.unit_cost || 0).toFixed(2); }
    return o;
  });
}

module.exports = { catalog, asText, applyPrices };
