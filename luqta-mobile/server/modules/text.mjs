// Arabic-aware text helpers shared by search, the shopping assistant and the support bot.
export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strips the article and joined prepositions so "بالحليب" and "الحليب" both match "حليب".
export function stem(word) {
  let w = word;
  if (w.length > 4 && /^(وال|بال|فال|كال|لل)/.test(w)) w = w.slice(3);
  else if (w.length > 3 && w.startsWith('ال')) w = w.slice(2);
  if (w.length > 4 && /(ات|ين|ون)$/.test(w)) w = w.slice(0, -2);
  return w;
}

export const tokens = (value) => normalize(value).split(' ').filter(Boolean);
export const stems = (value) => tokens(value).map(stem);

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Scores how well a query matches a document: exact words in the title count most, then words anywhere,
// then shared stems, then one-letter typos for longer words.
export function matchScore(query, title, body = '') {
  const words = stems(query);
  if (!words.length) return 0;
  const titleWords = stems(title), bodyWords = stems(`${title} ${body}`);
  const titleText = normalize(title), bodyText = normalize(`${title} ${body}`);
  let score = 0, matched = 0;
  for (const word of words) {
    let best = 0;
    if (titleWords.includes(word)) best = 4;
    else if (titleText.includes(word)) best = 3;
    else if (bodyWords.includes(word)) best = 2;
    else if (word.length >= 3 && bodyText.includes(word)) best = 1.5;
    else if (word.length >= 4 && bodyWords.some((candidate) => candidate.length >= 4 && distance(word, candidate) <= 1)) best = 1;
    if (best) matched++;
    score += best;
  }
  return matched ? score * (matched / words.length) : 0;
}

const NUMBER_WORDS = { واحد: 1, واحده: 1, حبه: 1, اثنين: 2, اثنان: 2, ثنتين: 2, زوج: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10 };
export const UNIT_WORDS = new Set(['كيلو', 'كغ', 'كجم', 'غرام', 'غم', 'جرام', 'لتر', 'علبه', 'علب', 'حبات', 'حبه', 'كرتونه', 'كرتون', 'ربطه', 'باكيت', 'كيس', 'اكياس', 'قطعه', 'قطع', 'x', 'pcs', 'kg']);

// Reads "٢ حليب", "حليب x3", "ثلاث علب تونة" into a quantity and the remaining item name.
export function quantityAndName(line) {
  const words = normalize(line).split(' ').filter(Boolean);
  let quantity = null;
  const rest = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const multiplied = word.match(/^x(\d+)$/) || word.match(/^(\d+)x$/);
    if (quantity === null && multiplied) { quantity = Number(multiplied[1]); continue; }
    if (quantity === null && /^\d+(\.\d+)?$/.test(word) && Number(word) > 0 && Number(word) <= 99) { quantity = Number(word); continue; }
    if (quantity === null && NUMBER_WORDS[word]) { quantity = NUMBER_WORDS[word]; continue; }
    if (UNIT_WORDS.has(word)) continue;
    rest.push(word);
  }
  return { quantity: Math.max(1, Math.min(99, Math.round(quantity ?? 1))), name: rest.join(' ') };
}

export const publicName = (name) => String(name || '').trim().split(/\s+/)[0] || 'عميل';
