import { providers } from './providers/registry.js';
import { LANGS, TONES, langById, buildSystem, FOLLOWUP_RULES, buildLookup, parse } from './prompts.js';
import { settings, apiKey, history, vocab, exportData, wipeAll } from './store.js';

const VERSION = '1.1.1';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = settings.get();
const provider = () => providers[S.provider] || providers.gemini;

let job = null;      // { id, ctrl, owner:HTMLElement }
let jobSeq = 0;
let thread = null;   // { system, mode, messages:[{role,text}], historyId, followups:[] }
let lookupCtrl = null;
let starting = false;

/* ============================== init ============================== */
function fillSelect(sel, items, value) {
  sel.innerHTML = items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  sel.value = value;
}
fillSelect($('#srcLang'), [['auto', '自动识别'], ...LANGS.map(l => [l.id, l.label])], S.src);
fillSelect($('#tgtLang'), LANGS.map(l => [l.id, l.label]), S.tgt);
fillSelect($('#native'), LANGS.map(l => [l.id, l.label]), S.native);

$('#tones').innerHTML = TONES.map(t =>
  `<button class="chip" role="radio" data-tone="${t.id}" aria-checked="${t.id === S.tone}">${t.label}</button>`).join('');
$('#tones').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  S = settings.set({ tone: b.dataset.tone });
  [...$('#tones').children].forEach(c => c.setAttribute('aria-checked', c === b));
});

$('#srcLang').onchange = e => { S = settings.set({ src: e.target.value }); };
$('#tgtLang').onchange = e => { S = settings.set({ tgt: e.target.value }); };
$('#native').onchange = e => { S = settings.set({ native: e.target.value }); };

$('#swap').onclick = () => {
  const newSrc = S.tgt;
  const newTgt = S.src === 'auto' ? (/^zh/.test(S.tgt) ? 'en' : S.native) : S.src;
  S = settings.set({ src: newSrc, tgt: newTgt });
  $('#srcLang').value = newSrc; $('#tgtLang').value = newTgt;
  const first = document.querySelector('#thread .turn .result');
  if (thread?.mode === 'translate' && first?.textContent.trim()) { $('#src').value = first.textContent.trim(); autoGrow(); }
};

const src = $('#src');
function autoGrow() {
  src.style.height = 'auto';
  src.style.height = Math.min(src.scrollHeight + 2, window.innerHeight * 0.45) + 'px';
  $('#clear').hidden = !src.value;
}
src.addEventListener('input', autoGrow);
$('#clear').onclick = () => { src.value = ''; autoGrow(); src.focus(); };

/* ============================== status / copy ============================== */
function status(msg = '', cls = '') { const el = $('#status'); el.textContent = msg; el.className = 'status ' + cls; }

async function copyText(text, btn) {
  if (!text) return;
  let ok = false;
  try { if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.readOnly = true;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta); ta.focus(); ta.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = ok ? '✓ 已复制' : '复制失败'; setTimeout(() => (btn.textContent = o), 1200); }
  else status(ok ? '已复制' : '复制失败，请长按文字手动复制', ok ? 'ok' : 'err');
}

/* ============================== turn rendering ============================== */
function createTurn(ask, mode) {
  const el = document.createElement('article');
  el.className = 'turn';
  el.innerHTML = `
    ${ask ? `<div class="ask">${esc(ask)}</div>` : ''}
    <div class="result pending"></div>
    <div class="result-actions"><button class="copy-btn copy-result">📋 复制译文</button></div>
    <details class="alts" hidden><summary>其他说法</summary><div class="alt-list"></div></details>
    <details class="notes-box" hidden><summary>说明</summary><div class="notes"></div><div class="result-actions"><button class="copy-btn copy-notes">复制说明</button></div></details>
    <div class="turn-foot"><span class="meta"></span></div>`;
  const q = s => el.querySelector(s);
  q('.copy-result').textContent = mode === 'fix' ? '📋 复制修改结果' : '📋 复制译文';
  q('.copy-result').onclick = e => copyText(q('.result').textContent, e.currentTarget);
  q('.copy-notes').onclick = e => copyText(q('.notes').textContent, e.currentTarget);
  q('.alt-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) copyText(b.dataset.text, b);
  });
  $('#thread').appendChild(el);

  return {
    el,
    render(raw, pending) {
      const p = parse(raw);
      const res = q('.result');
      res.textContent = p.result;
      res.classList.toggle('pending', pending);
      res.classList.toggle('notes', false);
      const alts = q('.alts');
      alts.hidden = !p.alts.length;
      if (p.alts.length) q('.alt-list').innerHTML = p.alts.map(a =>
        `<div class="alt"><span>${esc(a)}</span><button class="copy-btn" data-text="${esc(a)}">复制</button></div>`).join('');
      const nb = q('.notes-box');
      nb.hidden = !p.notes;
      q('.notes').textContent = p.notes;
      if (mode === 'fix' && p.notes) {
        const red = (p.notes.match(/🔴/g) || []).length, yel = (p.notes.match(/🟡/g) || []).length;
        q('.notes-box summary').textContent = /✅/.test(p.notes) && !red && !yel ? '✅ 无须修改' : `改了哪里（🔴 ${red} · 🟡 ${yel}）`;
      }
    },
    meta(t) { q('.meta').textContent = t; },
    error(msg) {
      const res = q('.result');
      res.classList.remove('pending');
      if (!res.textContent) { res.innerHTML = `<span class="error-box">${esc(msg)}</span>`; q('.copy-result').hidden = true; }
      else q('.meta').innerHTML = `<span class="error-box">${esc(msg)}</span>`;
    },
  };
}

/* ============================== streaming core ============================== */
function updateButtons() {
  for (const id of ['#provider', '#modelPicker', '#model', '#fetchModels', '#apiKey']) $(id).disabled = !!job || starting || !!lookupCtrl;
  for (const [btn, label] of [[$('#btnTranslate'), '翻译'], [$('#btnFix'), '帮我改'], [$('#btnFollowup'), '发送']]) {
    const owner = job && job.owner === btn;
    btn.textContent = owner ? '■ 停止' : label;
    btn.classList.toggle('stop', !!owner);
    btn.disabled = starting || (!!job && !owner);
  }
}

async function ensureReady() {
  const key = apiKey.get(S.provider);
  if (!key) { openView('settings'); status(`请先填入 ${provider().label} API Key`, 'err'); $('#apiKey').focus(); return null; }
  if (!S.model) {
    status('首次使用，正在自动选择模型…');
    try {
      const ms = await provider().listModels(key);
      const m = provider().pickDefault(ms, '');
      if (!m) { openView('settings'); throw new Error(ms.length ? '请在设置拉取模型后，从完整列表选择，或手动填写模型 ID' : '接口没有返回可用模型，可手动填写模型 ID'); }
      S = settings.set({ model: m });
      status('');
    } catch (e) { status(e.message, 'err'); return null; }
  }
  return key;
}

async function streamInto(turn, owner, key, { system, messages }) {
  const id = ++jobSeq;
  const ctrl = new AbortController();
  job = { id, ctrl, owner };
  updateButtons();
  const model = S.model, selectedProvider = provider();
  turn.meta(`${selectedProvider.label} · ${model}`);
  const t0 = performance.now();
  let tFirst = 0, raw = '';
  try {
    for await (const piece of selectedProvider.stream({ key, model, system, messages, signal: ctrl.signal })) {
      if (job?.id !== id) return null; // stale (should not happen, but never mix results)
      if (!tFirst) tFirst = performance.now();
      raw += piece;
      turn.render(raw, true);
    }
    turn.render(raw, false);
    turn.meta(`${model} · 首字 ${tFirst ? ((tFirst - t0) / 1000).toFixed(1) + 's' : '未返回'} · 共 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    return { raw, model };
  } catch (e) {
    if (e?.name === 'AbortError') {
      turn.render(raw, false); turn.meta(`${model} · 已停止`);
      return raw ? { raw, model, stopped: true } : null;
    }
    turn.error(e?.message || String(e));
    if (e?.kind === 'auth' || e?.kind === 'model') { if (e.kind === 'model') S = settings.set({ model: '' }); }
    return null;
  } finally {
    if (job?.id === id) job = null;
    updateButtons();
  }
}

/* ============================== main actions ============================== */
// Guard the async gap before a streaming job exists.
async function begin() {
  if (starting) return null;
  starting = true; updateButtons();
  try { return await ensureReady(); } finally { starting = false; updateButtons(); }
}

async function runMain(mode, owner) {
  if (job) { if (job.owner === owner) job.ctrl.abort(); return; }
  const text = src.value.trim();
  if (!text) { status('先输入要翻译或修改的文字', 'err'); src.focus(); return; }
  const key = await begin(); if (!key || job) return;
  status('');
  src.blur();
  const params = { provider: S.provider, mode, tone: S.tone, src: S.src, tgt: S.tgt, native: S.native };
  const system = buildSystem(params);
  $('#thread').innerHTML = '';
  $('#followupBox').hidden = true;
  thread = { system, mode, params, messages: [{ role: 'user', text }], followups: [], historyId: null };
  const myThread = thread;
  const turn = createTurn(null, mode);
  const out = await streamInto(turn, owner, key, thread);
  if (thread !== myThread) return; // user restored another history item meanwhile
  if (!out) { thread = null; return; }
  thread.messages.push({ role: 'model', text: out.raw });
  const rec = history.add({ ...params, input: text, output: out.raw, model: out.model, stopped: !!out.stopped });
  thread.historyId = rec.id;
  $('#followupBox').hidden = false;
}

async function runFollowup(qText) {
  const owner = $('#btnFollowup');
  if (job) { if (job.owner === owner) job.ctrl.abort(); return; }
  const q = (qText ?? $('#followup').value).trim();
  if (!q || !thread) return;
  const key = await begin(); if (!key || job) return;
  $('#followup').value = '';
  $('#followup').blur();
  const myThread = thread;
  // keep the original exchange + the most recent turns
  const msgs = thread.messages.length > 10 ? [...thread.messages.slice(0, 2), ...thread.messages.slice(-8)] : [...thread.messages];
  msgs.push({ role: 'user', text: q });
  const turn = createTurn(q, thread.mode);
  turn.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const out = await streamInto(turn, owner, key, { system: thread.system + '\n\n' + FOLLOWUP_RULES, messages: msgs });
  if (thread !== myThread) return;
  if (!out) { $('#followup').value = q; return; }
  thread.messages.push({ role: 'user', text: q }, { role: 'model', text: out.raw });
  thread.followups.push({ q, a: out.raw, stopped: !!out.stopped });
  if (thread.historyId) history.update(thread.historyId, { followups: thread.followups });
}

$('#btnTranslate').onclick = e => runMain('translate', e.currentTarget);
$('#btnFix').onclick = e => runMain('fix', e.currentTarget);
$('#btnFollowup').onclick = () => runFollowup();
$('#followup').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runFollowup(); } });
document.querySelector('.quick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) runFollowup(b.dataset.q); });

/* ============================== selection → lookup ============================== */
let lastSel = null, hideTimer = 0;
document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  const text = sel?.toString().trim() || '';
  const node = sel?.anchorNode;
  const turnEl = node && (node.nodeType === 1 ? node : node.parentElement)?.closest('#thread .turn');
  if (text && text.length <= 80 && turnEl && $('#sheet').hidden) {
    clearTimeout(hideTimer);
    const resText = turnEl.querySelector('.result')?.textContent || '';
    lastSel = { term: text, context: `${thread?.messages[0]?.text || ''}\n---\n${resText}`.trim() };
    $('#selText').textContent = text.length > 16 ? text.slice(0, 16) + '…' : text;
    $('#selBar').hidden = false;
  } else {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => ($('#selBar').hidden = true), 400);
  }
});
// pointerdown (not click) so the tap does not first clear the selection on iOS
$('#btnLookup').addEventListener('pointerdown', e => { e.preventDefault(); if (lastSel) openLookup(lastSel); });

async function openLookup({ term, context }) {
  $('#selBar').hidden = true;
  getSelection()?.removeAllRanges();
  if (job || starting) { status('请等当前生成结束后再解释词句'); return; }
  const key = await begin(); if (!key) return;
  $('#sheetTerm').textContent = term;
  $('#sheetBody').textContent = '';
  $('#sheetBody').classList.add('result', 'pending');
  const star = $('#btnStar');
  star.disabled = true; star.textContent = '⭐ 收藏到生词本';
  $('#sheet').hidden = false;
  lookupCtrl?.abort();
  const ctrl = lookupCtrl = new AbortController();
  updateButtons();
  const { system, user } = buildLookup({ term, context, native: S.native });
  let raw = '';
  try {
    for await (const p of provider().stream({ key, model: S.model, system, messages: [{ role: 'user', text: user }], signal: ctrl.signal, temperature: 0.3 })) {
      if (lookupCtrl !== ctrl) return;
      raw += p; $('#sheetBody').textContent = parse(raw).result;
    }
    star.disabled = false;
    star.onclick = () => {
      vocab.add({ term, explanation: parse(raw).result, context, tgt: S.tgt, model: S.model });
      star.disabled = true; star.textContent = '✓ 已收藏';
    };
  } catch (e) {
    if (e?.name !== 'AbortError') $('#sheetBody').innerHTML = `<span class="error-box">${esc(e?.message || e)}</span>`;
  } finally {
    if (lookupCtrl === ctrl) { lookupCtrl = null; updateButtons(); }
    $('#sheetBody').classList.remove('pending', 'result');
  }
}
function closeSheet() { lookupCtrl?.abort(); lookupCtrl = null; updateButtons(); $('#sheet').hidden = true; }
$('#sheetClose').onclick = closeSheet;
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

/* ============================== overlay views ============================== */
function openView(name) {
  document.querySelectorAll('.view').forEach(v => (v.hidden = v.id !== 'view-' + name));
  if (name === 'history') renderHistory();
  if (name === 'vocab') renderVocab();
  if (name === 'settings') renderSettings();
}
function closeViews() { document.querySelectorAll('.view').forEach(v => (v.hidden = true)); }
document.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => openView(b.dataset.open)));
document.querySelectorAll('[data-close]').forEach(b => (b.onclick = closeViews));

const fmtTime = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const toneLabel = id => TONES.find(t => t.id === id)?.label || '';

function renderHistory() {
  const list = history.all();
  $('#historyList').innerHTML = list.length ? list.map(h => `
    <li data-id="${h.id}">
      <div class="l1">${esc(h.input)}</div>
      <div class="l2">${esc(parse(h.output).result)}</div>
      <div class="l3"><span>${fmtTime(h.time)} · ${h.mode === 'fix' ? '帮我改' : '→ ' + esc(langById(h.tgt)?.label || '')} · ${esc(toneLabel(h.tone))}</span>
      <button class="del" data-del="${h.id}">删除</button></div>
    </li>`).join('') : '<li class="empty">还没有记录</li>';
}
$('#historyList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { history.remove(del.dataset.del); renderHistory(); return; }
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const h = history.all().find(x => x.id === li.dataset.id); if (h) restore(h);
});
function restore(h) {
  if (job || starting) { status('请先停止当前生成，再打开历史记录'); return; }
  closeViews();
  src.value = h.input; autoGrow();
  const params = { provider: h.provider || 'gemini', mode: h.mode, tone: h.tone, src: h.src, tgt: h.tgt, native: h.native || S.native };
  S = settings.set({ provider: params.provider, model: h.model || '', src: params.src, tgt: params.tgt, tone: params.tone, native: params.native });
  $('#srcLang').value = S.src; $('#tgtLang').value = S.tgt; $('#native').value = S.native;
  [...$('#tones').children].forEach(c => c.setAttribute('aria-checked', c.dataset.tone === S.tone));
  thread = { system: buildSystem(params), mode: h.mode, params, messages: [{ role: 'user', text: h.input }, { role: 'model', text: h.output }], followups: [...(h.followups || [])], historyId: h.id };
  $('#thread').innerHTML = '';
  const t = createTurn(null, h.mode); t.render(h.output, false); t.meta(`${h.model || ''} · ${fmtTime(h.time)}${h.stopped ? ' · 已停止（部分结果）' : ''}`);
  for (const f of thread.followups) {
    thread.messages.push({ role: 'user', text: f.q }, { role: 'model', text: f.a });
    const ft = createTurn(f.q, h.mode); ft.render(f.a, false);
    if (f.stopped) ft.meta('已停止（部分结果）');
  }
  $('#followupBox').hidden = false;
  window.scrollTo({ top: 0 });
}
$('#historyClear').onclick = () => { if (confirm('确定清空全部历史？')) { history.clear(); renderHistory(); } };
$('#historyMenu').onclick = () => downloadJSON('pocket-translator-history.json', exportData(['history']));

function renderVocab() {
  const list = vocab.all();
  $('#vocabList').innerHTML = list.length ? list.map(v => `
    <li>
      <div class="l1"><strong>${esc(v.term)}</strong></div>
      <details><summary>解释与原句</summary>
        <div class="vocab-exp">${esc(v.explanation)}</div>
        <div class="vocab-exp" style="color:var(--muted)">${esc(v.context)}</div>
      </details>
      <div class="l3"><span>${fmtTime(v.time)}</span><button class="del" data-del="${v.id}">删除</button></div>
    </li>`).join('') : '<li class="empty">还没有收藏</li>';
}
$('#vocabList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del && confirm('删除这个生词？')) { vocab.remove(del.dataset.del); renderVocab(); }
});
$('#vocabExport').onclick = () => downloadJSON('pocket-translator-vocab.json', exportData(['vocab']));

async function downloadJSON(name, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ============================== settings ============================== */
fillSelect($('#provider'), Object.values(providers).map(p => [p.id, p.label]), S.provider);
function renderSettings() {
  $('#provider').value = S.provider;
  $('#apiKey').type = 'password'; $('#toggleKey').textContent = '显示';
  $('#apiKey').value = apiKey.get(S.provider);
  $('#modelOptions').innerHTML = '';
  fillSelect($('#modelPicker'), [['', '拉取后选择模型'], ...(S.model ? [[S.model, S.model]] : [])], S.model);
  $('#model').value = S.model;
  $('#native').value = S.native;
  $('#modelHint').textContent = '';
  $('#providerHint').textContent = S.provider === 'gemini' ? 'Gemini 已通过用户 iPhone 实测。' : '新增适配，尚未完成真实 Key / iPhone 实测；浏览器可能受跨域或地区限制。不自动切换供应商。';
  $('#providerHint').textContent += provider().base ? ` 接口：${provider().base}。` : '';
  if (['moonshot','moonshot_global','zai','zhipu'].includes(S.provider)) $('#providerHint').textContent += '请选择 Key 所属平台。本入口使用常规 API，不使用 Coding Plan 专用接口。';
  $('#version').textContent = `口袋翻译 v${VERSION} · ${provider().label}`;
}
$('#provider').onchange = e => {
  if (job || starting || lookupCtrl) { e.target.value = S.provider; return; }
  const next = e.target.value;
  const models = { ...(S.models || {}), [S.provider]: S.model };
  S = settings.set({ provider: next, models, model: models[next] || '' });
  renderSettings();
};
$('#apiKey').addEventListener('change', e => { apiKey.set(e.target.value.trim(), S.provider); status('当前供应商 Key 已保存在本机', 'ok'); });
$('#toggleKey').onclick = e => {
  const i = $('#apiKey'); const show = i.type === 'password';
  i.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? '隐藏' : '显示';
};
$('#fetchModels').onclick = async () => {
  const key = $('#apiKey').value.trim();
  if (!key) { $('#modelHint').textContent = '请先填入 Key'; return; }
  apiKey.set(key, S.provider);
  const selected = S.provider;
  $('#modelHint').textContent = '拉取中…';
  try {
    const ms = await provider().listModels(key);
    if (selected !== S.provider) return;
    $('#modelOptions').innerHTML = ms.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    const m = provider().pickDefault(ms, S.model);
    fillSelect($('#modelPicker'), [['', '请选择模型，不自动指定'], ...ms.map(n => [n, n])], m);
    $('#model').value = m; S = settings.set({ model: m });
    $('#modelHint').textContent = `找到 ${ms.length} 个文字模型，${m ? '当前模型：' + m : '请从完整列表选择模型'}。`;
  } catch (e) { if (selected === S.provider) $('#modelHint').textContent = e.message; }
};
$('#model').onchange = e => { S = settings.set({ model: e.target.value.trim() }); $('#modelPicker').value = S.model; };
$('#modelPicker').onchange = e => { S = settings.set({ model: e.target.value }); $('#model').value = S.model; };
$('#exportAll').onclick = () => downloadJSON('pocket-translator-backup.json', exportData());
$('#wipeAll').onclick = () => {
  if (!confirm('将删除本机的 Key、设置、历史和生词本，确定？')) return;
  wipeAll(); location.reload();
};

/* ============================== boot ============================== */
updateButtons();
autoGrow();
if (!apiKey.get(S.provider)) status('首次使用：点右上角 ⚙️ 选择供应商并填入 Key');

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
