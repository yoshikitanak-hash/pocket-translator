// Gemini (Google AI Studio) provider — direct browser calls, SSE streaming.
// Provider interface (keep identical for future providers):
//   listModels(key) -> Promise<string[]>
//   stream({ key, model, system, messages:[{role:'user'|'model', text}], signal, temperature }) -> AsyncGenerator<string>
// Errors are thrown as ApiError with a user-facing `message` and a `kind`.

const API = 'https://generativelanguage.googleapis.com/v1beta';

export const id = 'gemini';
export const label = 'Google Gemini';

export class ApiError extends Error {
  constructor(kind, message, status = 0) { super(message); this.kind = kind; this.status = status; }
}

// Names of models that are not plain text-generation models (image, audio, realtime, Interactions-only…)
const EXCLUDE = /omni|live|image|tts|audio|embedding|robotics|computer-use|veo|imagen|native|aqa|learnlm|gemma|banana/i;
const BAD_KEY = 'pt.gemini.badModels';

function badModels() { try { return JSON.parse(localStorage.getItem(BAD_KEY) || '[]'); } catch { return []; } }
function markBad(model) {
  const b = badModels(); if (!b.includes(model)) { b.push(model); localStorage.setItem(BAD_KEY, JSON.stringify(b)); }
}

function classify(status, body) {
  const msg = body?.error?.message || '';
  const st = body?.error?.status || '';
  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(msg)) return new ApiError('auth', '认证失败：API Key 无效或已过期，请到设置检查', status);
  if (/only supports Interactions|not supported for generateContent/i.test(msg)) return new ApiError('model', '该模型不支持普通文字接口，已自动隐藏，请到设置换一个模型', status);
  if (status === 403 || st === 'PERMISSION_DENIED') return new ApiError('permission', '权限不足：这个 Key 无权使用该模型或接口', status);
  if (status === 429 || st === 'RESOURCE_EXHAUSTED') {
    return /quota|billing|credit|exceeded your current/i.test(msg)
      ? new ApiError('quota', '额度或余额不足（Google 返回配额错误）', status)
      : new ApiError('rate', '请求太频繁，被限流了，稍等几秒再试', status);
  }
  if (status === 404 || st === 'NOT_FOUND') return new ApiError('model', '模型不存在或已下线，请到设置重新拉取模型', status);
  if (status === 400 && /location|region|country/i.test(msg)) return new ApiError('region', '当前网络所在地区不支持 Gemini API', status);
  if (status >= 500) return new ApiError('server', `Google 服务暂时不可用（${status}），稍后重试`, status);
  return new ApiError('other', `请求失败（${status}）：${msg.slice(0, 160) || '未知错误'}`, status);
}

function networkError(e) {
  return new ApiError('network', '网络错误：连不上 Google（检查网络 / 代理）' + (e?.message ? `｜${e.message}` : ''));
}

export async function listModels(key) {
  let r;
  try { r = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } }); }
  catch (e) { throw networkError(e); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw classify(r.status, j);
  const bad = badModels();
  return (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /gemini/i.test(n) && !EXCLUDE.test(n) && !bad.includes(n))
    .sort().reverse();
}

// Pick a sensible default from a model list.
export function pickDefault(models, current) {
  return models.find(n => n === current)
    || models.find(n => /^gemini-[\d.]+-flash$/.test(n))
    || models.find(n => n === 'gemini-flash-latest')
    || models.find(n => /flash/.test(n) && !/lite/.test(n))
    || models[0] || '';
}

export async function* stream({ key, model, system, messages, signal, temperature = 0.7 }) {
  let r;
  try {
    r = await fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: { temperature },
      }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw networkError(e);
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = classify(r.status, j);
    if (/only supports Interactions|not supported for generateContent/i.test(j?.error?.message || '')) markBad(model);
    throw err;
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', gotText = false, finish = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buf += done ? dec.decode() + '\n' : dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.error) throw classify(j.error.code || 0, j);
        const cand = j.candidates?.[0];
        if (cand?.finishReason) finish = cand.finishReason;
        const piece = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (piece) { gotText = true; yield piece; }
        if (j.promptFeedback?.blockReason) throw new ApiError('blocked', `内容被 Google 安全策略拦截（${j.promptFeedback.blockReason}）`);
      }
      if (done) break;
    }
  } catch (e) {
    if (e?.name === 'AbortError' || e instanceof ApiError) throw e;
    throw networkError(e);
  } finally {
    try { await reader.cancel(); } catch {}
    reader.releaseLock();
  }
  if (finish && !['STOP'].includes(finish) && gotText) {
    throw new ApiError('incomplete', `生成未完整结束（${finish}），已保留收到的部分，请重试或换模型`);
  }
  if (!gotText) {
    if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') throw new ApiError('blocked', '内容被 Google 安全策略拦截，换个说法试试');
    throw new ApiError('empty', `模型没有返回内容${finish ? `（${finish}）` : ''}，请重试或换个模型`);
  }
}

