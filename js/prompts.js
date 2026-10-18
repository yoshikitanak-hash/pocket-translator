// Languages, tone presets, prompt builders and output parser.

export const LANGS = [
  { id: 'zh-Hans', label: '简体中文', prompt: 'Simplified Chinese (Mainland China vocabulary and usage)' },
  { id: 'zh-TW', label: '繁體中文（台灣）', prompt: 'Traditional Chinese using Taiwan vocabulary and usage (e.g. 軟體、影片、資訊、網路、品質)' },
  { id: 'zh-HK', label: '繁體中文（香港）', prompt: 'Traditional Chinese using Hong Kong vocabulary and usage (standard written Chinese; Cantonese colloquialisms only for casual/chat registers)' },
  { id: 'zh-Hant-CN', label: '繁體字（大陸用語）', prompt: 'Traditional Chinese characters but Mainland China vocabulary' },
  { id: 'en', label: 'English', prompt: 'English' },
  { id: 'ja', label: '日本語', prompt: 'Japanese' },
  { id: 'fr', label: 'Français', prompt: 'French' },
  { id: 'ru', label: 'Русский', prompt: 'Russian' },
  { id: 'es', label: 'Español', prompt: 'Spanish' },
  { id: 'de', label: 'Deutsch', prompt: 'German' },
];
export const langById = id => LANGS.find(l => l.id === id);

export const TONES = [
  { id: 'follow', label: '🔄 跟随原文', prompt: 'Match the register and tone of the original as closely as possible.' },
  { id: 'chat', label: '💬 网聊有梗', prompt: 'Write like a native speaker texting friends or posting on social media: current slang, common abbreviations and internet expressions real people actually use, short and punchy, witty where it fits. Never force memes or invent slang that sounds unnatural.' },
  { id: 'casual', label: '🙂 日常随意', prompt: 'Relaxed, natural everyday spoken style — like talking to a friend or a colleague you are comfortable with. Not slangy, not stiff.' },
  { id: 'playful', label: '😏 幽默/撩', prompt: 'Playful and witty. Preserve the original relationship and intent. Flirt only if the source or explicit user request is already flirtatious; never introduce romantic or sexual intent. Natural, never forced or crude.' },
  { id: 'formal', label: '👔 正式/商务', prompt: "Polite, professional and clear. Suitable for formal occasions, business messages, customer-service replies and emails (follow the target language's conventions for greetings and sign-offs when the text is an email)." },
];
export const toneById = id => TONES.find(t => t.id === id) || TONES[0];

export const M = { ALT: '===ALT===', NOTES: '===NOTES===' };

function nativeName(nativeId) { return (langById(nativeId) || LANGS[0]).prompt; }

const PLAIN = 'Plain text only — absolutely NO Markdown (no **, no *, no #, no backticks). Use "• " for bullet points.';

export function buildSystem({ mode, tone, src, tgt, native }) {
  const t = toneById(tone).prompt;
  const notesLang = nativeName(native);
  const srcLine = src === 'auto' ? 'Detect the source language automatically.' : `The source language is ${langById(src)?.prompt}.`;

  if (mode === 'translate') {
    const target = langById(tgt)?.prompt || 'English';
    const fallback = /^zh/.test(tgt) ? 'English' : nativeName(native);
    return [
      `You are an expert translator and native-level writer. Translate the user's text into ${target}.`,
      srcLine,
      `Always honor the selected target language ${target}. If the text is already in that language, keep it or adapt its register without switching languages; mention this briefly in the notes.`,
      'Faithfulness first: preserve meaning exactly — negation, degree, time, numbers, names, who-does-what, and uncertainty. Never add facts or opinions. If the source is ambiguous, keep the ambiguity or explain the readings in the notes; do not silently choose.',
      'The user often writes in a stiff, bookish style. Translate the INTENT into the requested register instead of mirroring stiffness (unless the register is "match the original").',
      'Keep proper nouns, product names, code and URLs unchanged. Preserve line breaks and emoji.',
      `Register: ${t}`,
      '',
      'Output format (strict, nothing before the translation):',
      '<the translation only>',
      'Only if a genuinely useful alternative exists, append ===ALT=== followed by exactly one complete alternative version of the entire text. Preserve its paragraph breaks; do not number its paragraphs as separate alternatives. Otherwise omit this section.',
      M.NOTES,
      `<notes in ${notesLang}: at most 3 short bullets only when useful for non-obvious choices, slang, cultural nuance or ambiguity; leave empty for straightforward text>`,
      PLAIN,
    ].join('\n');
  }

  // mode === 'fix'
  return [
    'You are a meticulous native-level editor. The user wrote some text; keep it in THE SAME language it is written in (do not translate).',
    srcLine,
    `Fix real grammar, spelling, word-choice and usage errors, and make it sound natural for this register: ${t}`,
    'Preserve the meaning and the user\'s intent. Do not add new content.',
    'If the text is already correct and natural for the register, return it unchanged and write "✅ 无须修改" as the only note. Never make changes just to look busy.',
    '',
    'Output format (strict, nothing before the revised text):',
    '<the revised text only>',
    M.NOTES,
    `<notes in ${notesLang}: one bullet per change, formatted "🔴 original → revised：reason" for real errors (must fix) and "🟡 original → revised：reason" for optional style improvements. List 🔴 items first.>`,
    PLAIN,
  ].join('\n');
}

export const FOLLOWUP_RULES = [
  'The user is now asking a follow-up about your previous answer.',
  `If they ask for a new or revised version, reply in exactly the same output format as before (including ${M.NOTES}; ${M.ALT} optional).`,
  'If they ask a question (e.g. what a word means, why you chose something), answer concisely in the notes language, plain text, with no section markers.',
].join('\n');

export function buildLookup({ term, context, native }) {
  return {
    system: [
      `You are a concise bilingual dictionary and grammar tutor. Answer in ${nativeName(native)}. ${PLAIN}`,
      'Format:',
      'Line 1: the term + pronunciation if helpful (IPA for English, kana/romaji for Japanese) + part of speech.',
      '• 这里的意思：meaning in THIS context',
      '• 语气/场合：register, how casual or formal, who uses it',
      '• 例句：one natural example sentence + translation',
      '• (optional) 注意：common mistakes, grammar point, or a close synonym and the difference',
      'Keep it under 8 lines.',
    ].join('\n'),
    user: `Term: ${term}\n\nContext:\n${context}`,
  };
}

// Split streamed raw text into { result, alts, notes }.
export function parse(raw) {
  const ia = raw.indexOf(M.ALT), inn = raw.indexOf(M.NOTES);
  const cut = [ia, inn].filter(i => i >= 0);
  const end = cut.length ? Math.min(...cut) : raw.length;
  const result = raw.slice(0, end).trim();
  let alts = [], notes = '';
  if (ia >= 0) {
    const aEnd = inn > ia ? inn : raw.length;
    // One ALT section is one complete variant, including its paragraph breaks.
    const alternative = raw.slice(ia + M.ALT.length, aEnd).trim();
    alts = alternative ? [alternative] : [];
  }
  if (inn >= 0) {
    const nEnd = ia > inn ? ia : raw.length;
    notes = cleanMd(raw.slice(inn + M.NOTES.length, nEnd).trim());
  }
  return { result: cleanMd(result, true), alts: alts.map(a => cleanMd(a, true)), notes };
}

export function cleanMd(s, inline = false) {
  let out = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1');
  if (!inline) out = out.replace(/^(\s*)[*-]\s+/gm, '$1• ').replace(/^#+\s*/gm, '');
  return out;
}

