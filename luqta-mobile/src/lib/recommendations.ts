import type { Product, ProductCategory } from "../data/products.ts";

export type Recommendation = {
  message: string;
  productIds: string[];
  budget?: number;
};

/** Search and recommendations are local catalog matching in demo mode. */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const categoryWords: Record<ProductCategory, string[]> = {
  electronics: ["الكترونيات", "اجهزه", "electronics", "electronic"],
  home: ["منزل", "المنزل", "بيت", "البيت", "اثاث", "ديكور", "home", "house"],
  fashion: ["ازياء", "الازياء", "موضه", "ملابس", "fashion"],
  care: [
    "عنايه",
    "العنايه",
    "بشره",
    "البشره",
    "جمال",
    "care",
    "skincare",
    "beauty",
  ],
};

const intents: { words: string[]; tags: string[]; ids?: string[] }[] = [
  {
    words: ["سماعات", "سماعه", "headphones", "headphone", "earbuds"],
    tags: ["سماعات"],
    ids: ["headphones"],
  },
  { words: ["هديه", "هدايا", "gift", "gifts", "اهداء"], tags: ["هديه"] },
  {
    words: [
      "مكتب",
      "المكتب",
      "عمل",
      "العمل",
      "office",
      "work",
      "دراسه",
      "الدراسه",
    ],
    tags: ["مكتب", "عمل"],
  },
  { words: ["سرير", "نوم", "غرفه", "bed", "bedroom"], tags: ["نوم", "غرفه"] },
  {
    words: ["حذاء", "احذيه", "جزمه", "شوز", "sneakers", "shoes", "shoe"],
    tags: ["حذاء"],
    ids: ["sneakers"],
  },
  { words: ["سيروم", "ترطيب", "serum"], tags: ["سيروم"], ids: ["serum"] },
  {
    words: ["عطر", "عطور", "perfume", "fragrance"],
    tags: ["عطر"],
    ids: ["fragrance"],
  },
  { words: ["فواحه", "diffuser"], tags: ["فواحه"], ids: ["diffuser"] },
  {
    words: ["كيبورد", "keyboard", "مفاتيح"],
    tags: ["كيبورد"],
    ids: ["keyboard"],
  },
  { words: ["مصباح", "اضاءه", "لمبه", "lamp"], tags: ["مصباح"], ids: ["lamp"] },
  { words: ["كرسي", "chair"], tags: ["كرسي"], ids: ["chair"] },
  {
    words: ["كوب", "قهوه", "شاي", "mug", "coffee"],
    tags: ["كوب"],
    ids: ["mug"],
  },
  {
    words: ["حقيبه", "شنطه", "bag", "backpack"],
    tags: ["حقيبه"],
    ids: ["bag"],
  },
  { words: ["ساعه", "watch"], tags: ["ساعه"], ids: ["watch"] },
  { words: ["مكبر", "speaker"], tags: ["مكبر صوت"], ids: ["speaker"] },
];

function hasWord(value: string, word: string): boolean {
  const normalizedWord = normalizeSearch(word);
  if (` ${value} `.includes(` ${normalizedWord} `)) return true;
  if (!/^[\u0621-\u064A]+$/.test(normalizedWord)) return false;
  const base = normalizedWord.replace(/^ال/, "");
  const forms = new Set([
    base,
    `ال${base}`,
    `ل${base}`,
    `لل${base}`,
    `ب${base}`,
    `بال${base}`,
    `و${base}`,
    `وال${base}`,
  ]);
  return value.split(" ").some((token) => forms.has(token));
}

function searchableText(product: Product): string {
  return normalizeSearch(
    [
      product.name,
      product.subtitle,
      product.brand,
      product.description,
      ...product.tags,
      ...product.features,
    ].join(" "),
  );
}

export function filterProducts(query: string, list: Product[]): Product[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return list;
  const tokens = normalized.split(" ").filter(Boolean);
  return list.filter((product) => {
    const haystack = searchableText(product);
    const categoryMatch = (categoryWords[product.category] || [product.category]).some(
      (word) => normalized === normalizeSearch(word),
    );
    return categoryMatch || tokens.every((token) => haystack.includes(token));
  });
}

type Budget = { amount: number; strict: boolean; minimum?: number };

function extractBudget(prompt: string): Budget | undefined {
  const number = "(\\d+(?:[.,]\\d+)?)";
  // A range has an upper cap even when the user writes Arabic or Persian digits.
  const range = prompt.match(
    new RegExp(
      `(?:بين|from|between)\\s*${number}\\s*(?:و|الي|الى|to|and|-)\\s*${number}`,
    ),
  );
  if (range) {
    const a = Number(range[1].replace(",", "."));
    const b = Number(range[2].replace(",", "."));
    return { amount: Math.max(a, b), minimum: Math.min(a, b), strict: false };
  }
  const strict = prompt.match(
    new RegExp(`(?:اقل من|تحت|under|less than|below)\\s*${number}`),
  );
  if (strict)
    return { amount: Number(strict[1].replace(",", ".")), strict: true };
  const explicit = prompt.match(
    new RegExp(
      `(?:ميزاني(?:تي|ه|ه)?|بميزانيه|بحدود|بحد اقصي|حد اقصي|لا تتجاوز|بحدود|حدي|budget(?: is| of)?|up to|maximum|max)\\s*(?:هي|تكون|حوالي|of|is)?\\s*${number}`,
    ),
  );
  if (explicit)
    return { amount: Number(explicit[1].replace(",", ".")), strict: false };
  const currency = prompt.match(new RegExp(`${number}\\s*(?:دينار|د[. ]?ا|jod|jd|ريال|ر س|sar|sr)`));
  if (currency)
    return { amount: Number(currency[1].replace(",", ".")), strict: false };
  return undefined;
}

const fillerWords = new Set([
  "ابي",
  "ابغي",
  "ابغى",
  "ابغا",
  "اريد",
  "اود",
  "احتاج",
  "محتاج",
  "عايز",
  "عاوزه",
  "بدي",
  "اقترح",
  "اقترحي",
  "اقتراح",
  "رشح",
  "رشحلي",
  "ساعدني",
  "اعطني",
  "عطني",
  "لي",
  "لنا",
  "لشراء",
  "شراء",
  "اشتري",
  "اختار",
  "منتج",
  "منتجات",
  "شي",
  "شيء",
  "ايش",
  "وش",
  "ماذا",
  "مناسب",
  "مناسبه",
  "جميل",
  "جميله",
  "جيد",
  "جيده",
  "افضل",
  "الافضل",
  "احسن",
  "رخيص",
  "رخيصه",
  "من",
  "في",
  "على",
  "مع",
  "عن",
  "و",
  "او",
  "الى",
  "الي",
  "هذا",
  "هذه",
  "ان",
  "انا",
  "عندي",
  "اقل",
  "تحت",
  "بين",
  "بحدود",
  "حد",
  "اقصي",
  "لا",
  "تتجاوز",
  "ريال",
  "دينار",
  "jod",
  "jd",
  "sar",
  "sr",
  "ر",
  "س",
  "ميزانيتي",
  "ميزانيه",
  "قارن",
  "مقارنه",
  "قارنلي",
  "تقارن",
  "اثنين",
  "للمكتب",
  "للمنزل",
  "للبيت",
  "recommend",
  "suggest",
  "best",
  "a",
  "an",
  "the",
  "for",
  "i",
  "want",
  "need",
  "me",
  "please",
  "under",
  "below",
  "less",
  "than",
  "up",
  "to",
  "budget",
  "is",
  "of",
  "max",
  "maximum",
  "compare",
  "comparison",
  "and",
  "with",
]);

export function recommendProducts(
  prompt: string,
  list: Product[],
  currency = "JOD",
): Recommendation {
  const normalized = normalizeSearch(prompt);
  const budget = extractBudget(normalized);
  const budgetFields = budget ? { budget: budget.amount } : {};
  const eligible = list.filter(
    (product) =>
      !budget ||
      ((budget.strict
        ? product.price < budget.amount
        : product.price <= budget.amount) &&
        (budget.minimum === undefined || product.price >= budget.minimum)),
  );
  const matchedIntents = intents.filter((intent) =>
    intent.words.some((word) => hasWord(normalized, word)),
  );
  const specificIds = new Set(
    matchedIntents.flatMap((intent) => intent.ids ?? []),
  );
  const matchedCategories = (
    Object.entries(categoryWords) as [ProductCategory, string[]][]
  )
    .filter(([, words]) => words.some((word) => hasWord(normalized, word)))
    .map(([category]) => category);
  const queryTokens = normalized
    .split(" ")
    .filter(
      (token) =>
        !fillerWords.has(token) && !/^\d/.test(token) && token.length > 1,
    );
  const isComparison = [
    "قارن",
    "مقارنه",
    "قارنلي",
    "compare",
    "comparison",
  ].some((word) => hasWord(normalized, word));
  const hasRecognizedIntent =
    matchedIntents.length > 0 || matchedCategories.length > 0;

  const scored = eligible
    .map((product) => {
      const text = searchableText(product);
      const tags = product.tags.map(normalizeSearch);
      let score = 0;
      if (specificIds.has(product.id)) score += 20;
      if (matchedCategories.includes(product.category)) score += 10;
      for (const intent of matchedIntents) {
        if (intent.tags.some((tag) => tags.includes(normalizeSearch(tag))))
          score += 8;
      }
      for (const token of queryTokens) {
        if (text.includes(token)) score += 2;
      }
      return { product, score };
    })
    .filter(({ score, product }) => {
      if (specificIds.size > 0) return specificIds.has(product.id);
      if (hasRecognizedIntent || queryTokens.length > 0) return score > 0;
      return true;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.product.rating - a.product.rating ||
        a.product.price - b.product.price,
    );

  const selected = scored
    .slice(0, isComparison ? 2 : 3)
    .map(({ product }) => product);
  const demo = "اقتراح تجريبي من كتالوج لقطة.";
  if (selected.length === 0) {
    return {
      ...budgetFields,
      message: `${demo} لم أجد منتجات تطابق طلبك${budget ? " ضمن ميزانيتك" : ""}. جرّب منتجًا آخر أو عدّل وصف الطلب.`,
      productIds: [],
    };
  }
  const money = (amount: number) => {
    try { return new Intl.NumberFormat("ar-JO", { style: "currency", currency }).format(amount); }
    catch { return `${amount.toFixed(2)} ${currency}`; }
  };
  const limit = budget ? ` ضمن ميزانية ${money(budget.amount)}` : "";
  if (isComparison) {
    const comparisons = selected
      .map(
        (product) =>
          `${product.name}: ${money(product.price)}، وتقييم ${product.rating}/٥`,
      )
      .join("؛ ");
    return {
      ...budgetFields,
      message: `${demo} ${selected.length > 1 ? "إليك مقارنة سريعة" : "وجدت خيارًا واحدًا"}${limit}: ${comparisons}. افتح تفاصيل المنتج للاطلاع على المزايا.`,
      productIds: selected.map((product) => product.id),
    };
  }
  return {
    ...budgetFields,
    message: `${demo} ${hasRecognizedIntent || queryTokens.length > 0 ? "هذه خيارات تناسب طلبك" : "إليك بعض المنتجات الأعلى تقييمًا"}${limit}. اختر منتجًا للاطلاع على تفاصيله.`,
    productIds: selected.map((product) => product.id),
  };
}
