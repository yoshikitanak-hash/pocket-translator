// Local persistence (localStorage). Nothing here ever leaves the device unless the user exports it.

const K = { settings: 'pt.settings', key: 'pt.apiKey.gemini', history: 'pt.history', vocab: 'pt.vocab' };
const HISTORY_MAX = 300;

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; } // quota exceeded etc.
};

export const DEFAULTS = { provider: 'gemini', model: '', src: 'auto', tgt: 'en', tone: 'follow', native: 'zh-Hans' };

export const settings = {
  get() { return { ...DEFAULTS, ...read(K.settings, {}) }; },
  set(patch) { const old = this.get(); const s = { ...old, ...patch };
    if ('model' in patch) s.models = { ...(patch.models || old.models || {}), [s.provider]: patch.model };
    write(K.settings, s); return s; },
};

// API key kept in its own entry so it is never included in exports.
export const apiKey = {
  get(provider = 'gemini') { return localStorage.getItem('pt.apiKey.' + provider) || ''; },
  set(v, provider = 'gemini') { const k = 'pt.apiKey.' + provider; v ? localStorage.setItem(k, v) : localStorage.removeItem(k); },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const history = {
  all() { return read(K.history, []); },
  add(item) {
    const list = this.all();
    const rec = { id: uid(), time: Date.now(), ...item };
    list.unshift(rec);
    while (list.length > HISTORY_MAX) list.pop();
    while (!write(K.history, list) && list.length > 10) list.splice(Math.floor(list.length * 0.8));
    return rec;
  },
  update(id, patch) {
    const list = this.all(); const i = list.findIndex(x => x.id === id);
    if (i >= 0) { list[i] = { ...list[i], ...patch }; write(K.history, list); }
  },
  remove(id) { write(K.history, this.all().filter(x => x.id !== id)); },
  clear() { write(K.history, []); },
};

export const vocab = {
  all() { return read(K.vocab, []); },
  add(item) {
    const list = this.all();
    const rec = { id: uid(), time: Date.now(), ...item };
    list.unshift(rec); write(K.vocab, list); return rec;
  },
  remove(id) { write(K.vocab, this.all().filter(x => x.id !== id)); },
};

export function exportData(parts = ['history', 'vocab']) {
  const data = { app: 'pocket-translator', version: 1, exportedAt: new Date().toISOString() };
  if (parts.includes('history')) data.history = history.all();
  if (parts.includes('vocab')) data.vocab = vocab.all();
  return data;
}

export function wipeAll() {
  Object.keys(localStorage).filter(k => k.startsWith('pt.')).forEach(k => localStorage.removeItem(k));
}

