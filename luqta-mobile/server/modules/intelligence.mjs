// Shopping intelligence that runs on the store's own data (no external AI service): conversational shopping,
// budget baskets, recipes and pasted receipts turned into shopping lists, voice/text commands and recommendations.
import { normalize, quantityAndName } from './text.mjs';

export const name = 'intelligence';

const RECIPES = [
  { id: 'kabsa', name: 'كبسة دجاج', words: ['كبسه', 'كبسة'], servings: 4, ingredients: [['أرز بسمتي', 1], ['دجاج', 1], ['بصل', 1], ['طماطم', 1], ['زيت زيتون', 1]] },
  { id: 'maqluba', name: 'مقلوبة', words: ['مقلوبه'], servings: 4, ingredients: [['أرز بسمتي', 1], ['دجاج', 1], ['بصل', 1], ['لبن', 1]] },
  { id: 'fattoush', name: 'سلطة فتوش', words: ['فتوش', 'سلطه'], servings: 4, ingredients: [['خيار', 1], ['طماطم', 1], ['خس', 1], ['ليمون', 1], ['خبز', 1], ['زيت زيتون', 1]] },
  { id: 'shakshuka', name: 'شكشوكة', words: ['شكشوكه', 'شكشوكة'], servings: 2, ingredients: [['بيض', 1], ['طماطم', 1], ['بصل', 1], ['زيت زيتون', 1]] },
  { id: 'breakfast', name: 'فطور عائلي', words: ['فطور', 'افطار', 'ريوق', 'breakfast'], servings: 4, ingredients: [['بيض', 1], ['لبنة', 1], ['خبز', 1], ['حليب', 1], ['عصير برتقال', 1], ['جبنة', 1]] },
  { id: 'hummus', name: 'حمص بطحينة', words: ['حمص'], servings: 4, ingredients: [['حمص', 1], ['طحينة', 1], ['ليمون', 1], ['زيت زيتون', 1]] },
  { id: 'pancake', name: 'بان كيك', words: ['بان', 'بانكيك', 'pancake', 'فطائر'], servings: 4, ingredients: [['طحين', 1], ['حليب', 1], ['بيض', 1], ['سكر', 1]] },
  { id: 'fruit_salad', name: 'سلطة فواكه', words: ['فواكه', 'فاكهه'], servings: 4, ingredients: [['موز', 1], ['تفاح', 1], ['فراولة', 1], ['عصير برتقال', 1]] },
  { id: 'pasta', name: 'معكرونة بالصلصة', words: ['معكرونه', 'مكرونه', 'باستا', 'pasta'], servings: 4, ingredients: [['معكرونة', 1], ['صلصة طماطم', 1], ['جبنة', 1]] },
];
const SCREENS = [
  [['السله', 'سلتي', 'العربه', 'cart'], '/cart', 'السلة'], [['طلباتي', 'الطلبات', 'orders'], '/orders', 'طلباتي'], [['المفضله', 'المفضلات', 'favorites'], '/favorites', 'المفضلة'],
  [['العروض', 'الخصومات', 'offers', 'deals'], '/offers', 'العروض'], [['حسابي', 'الحساب', 'ملفي', 'profile'], '/profile', 'حسابي'], [['المحفظه', 'رصيدي', 'wallet'], '/wallet', 'المحفظة'],
  [['الدعم', 'المساعده', 'support', 'help'], '/support', 'الدعم'], [['المخزن', 'الصلاحيه', 'pantry'], '/pantry', 'مخزن البيت'], [['القوائم', 'قائمتي', 'lists'], '/lists', 'قوائمي'],
  [['شخصيتي', 'الروبوت', 'robot'], '/robot', 'شخصيتي'], [['الاعدادات', 'المظهر', 'settings'], '/appearance', 'المظهر واللغة'],
];
const MOTIONS = [[['امشي', 'امش', 'walk'], 'walk'], [['اقفز', 'نط', 'jump'], 'jump'], [['تعال', 'come'], 'come'], [['وقف', 'توقف', 'stop'], 'stop'], [['ارقص', 'dance'], 'dance'], [['لوح', 'سلم', 'wave'], 'wave']];
const STAPLE_CATEGORIES = ['fresh', 'dairy', 'bakery', 'drinks'];

export function parseBudget(message) {
  const n = normalize(message);
  const match = n.match(/(?:ب|بـ|بحدود|ميزانيتي|ميزانيه|budget|under|تحت|اقل من)?\s*(\d+(?:\.\d+)?)\s*(?:دينار|دنانير|jod|jd|د ا|ريال|دولار|\$)/) || n.match(/(?:ميزانيتي|ميزانيه|بميزانيه|بحدود|budget|تحت|اقل من)\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}
const hasWord = (n, words) => { const parts = n.split(' '); return words.some((w) => parts.includes(w)); };

export function install(c, api) {
  const { get, all, fail, text, integer, number, parse, money, requireUser, optionalUser, rate, setting } = c;
  const products = () => all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf') IS NULL").map(c.product).filter((p) => !p.hasVariants);
  const best = (query, list = products()) => { const ranked = api.use('rankProducts')(query, list); return ranked[0] && ranked[0].score >= 2 ? ranked[0].p : null; };

  // ---- budget basket ----
  const basket = (budget, message = '', people = 1) => {
    if (!(budget > 0)) fail(400, 'حدّد الميزانية، مثل: جهز لي سلة بـ 20 دينار');
    const pool = products().filter((p) => p.stock > 0 && p.price <= budget);
    const n = normalize(message).replace(/\d+(\.\d+)?/g, ' ');
    const ranked = api.use('rankProducts')(n, pool).filter((x) => x.score >= 1.5);
    const sales = api.use('salesCounts')();
    let candidates = ranked.length >= 3 ? ranked.map((x) => ({ p: x.p, score: x.score * 2 })) : pool.filter((p) => budget > 60 || STAPLE_CATEGORIES.includes(p.category)).map((p) => ({ p, score: (STAPLE_CATEGORIES.includes(p.category) ? 3 : 1) + p.rating / 2 + Math.min(2, (sales.get(p.id) || 0) / 5) + (p.oldPrice > p.price ? 1 : 0) }));
    if (!candidates.length) candidates = pool.map((p) => ({ p, score: p.rating }));
    candidates.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
    const picked = new Map(), perCategory = {};
    let remaining = budget;
    for (const { p } of candidates) {
      if (picked.size >= 8) break;
      if (p.price > remaining || (perCategory[p.category] || 0) >= 2) continue;
      picked.set(p.id, { product: p, quantity: 1 }); perCategory[p.category] = (perCategory[p.category] || 0) + 1; remaining = money(remaining - p.price);
    }
    const wanted = Math.max(1, Math.min(4, Math.round(people)));
    for (let round = 1; round < 3 + wanted; round++) for (const item of picked.values()) {
      if (item.quantity >= Math.min(item.product.stock, wanted + 1) || item.product.price > remaining) continue;
      item.quantity++; remaining = money(remaining - item.product.price);
    }
    const items = [...picked.values()].map(({ product, quantity }) => ({ product, quantity, lineTotal: money(product.price * quantity), reason: product.flash ? 'عرض خاطف' : product.oldPrice > product.price ? 'عليه خصم الآن' : STAPLE_CATEGORIES.includes(product.category) ? 'أساسي للبيت' : product.rating >= 4.5 ? 'الأعلى تقييمًا' : 'يناسب طلبك' }));
    const total = money(items.reduce((s, i) => s + i.lineTotal, 0));
    return { budget, total, remaining: money(budget - total), currency: setting('currency'), items, usedPercent: budget ? Math.round(total / budget * 100) : 0 };
  };
  api.provide('budgetBasket', basket);
  api.route('POST', '/ai/basket', ({ req, body }) => { rate(req, 'ai', 120); const budget = body.budget != null ? number(body.budget, 'الميزانية', 1, 100000) : parseBudget(String(body.prompt || '')); return { basket: basket(budget, String(body.prompt || '').slice(0, 300), body.people ? integer(body.people, 'عدد الأشخاص', 1, 20) : 1) }; });

  // ---- recipes ----
  const recipe = (message, servings) => {
    const n = normalize(message), found = RECIPES.find((r) => r.words.some((w) => n.includes(normalize(w))) || n.includes(normalize(r.name)));
    if (!found) return null;
    const factor = Math.max(1, Math.round((servings || found.servings) / found.servings));
    const list = products();
    const ingredients = found.ingredients.map(([ingredient, quantity]) => { const p = best(ingredient, list); return { ingredient, quantity: quantity * factor, product: p && p.stock > 0 ? p : null, unavailable: !!p && p.stock === 0 }; });
    return { id: found.id, name: found.name, servings: servings || found.servings, ingredients, total: money(ingredients.reduce((s, i) => s + (i.product ? i.product.price * i.quantity : 0), 0)), missing: ingredients.filter((i) => !i.product).map((i) => i.ingredient) };
  };
  api.route('GET', '/ai/recipes', () => ({ recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, servings: r.servings })) }));
  api.route('POST', '/ai/recipe', ({ req, body }) => {
    rate(req, 'ai', 120);
    const result = recipe(text(body.text, 'اسم الوصفة', 2, 200), body.servings ? integer(body.servings, 'عدد الأشخاص', 1, 30) : null);
    if (!result) fail(404, `لم أجد هذه الوصفة بعد. جرّب: ${RECIPES.slice(0, 4).map((r) => r.name).join('، ')}`, 'recipe_not_found');
    return { recipe: result };
  });

  // ---- receipt / pasted list ----
  const parseList = (source) => {
    const list = products();
    const lines = String(source).split(/\n|،|,|؛|;|\s+و(?=\s)|\s\+\s/).map((s) => s.trim()).filter(Boolean).slice(0, 60);
    return lines.map((line) => {
      const { quantity, name } = quantityAndName(line.replace(/\d+(\.\d+)?\s*(jod|jd|دينار)$/i, ''));
      if (!name) return null;
      const ranked = api.use('rankProducts')(name, list);
      const top = ranked[0];
      return { line, quantity, name, product: top && top.score >= 2 ? top.p : null, confidence: top ? Math.min(100, Math.round(top.score / Math.max(1, name.split(' ').length * 4) * 100)) : 0 };
    }).filter(Boolean);
  };
  api.route('POST', '/ai/parse-list', ({ req, body }) => {
    rate(req, 'ai', 120);
    const items = parseList(text(body.text, 'النص', 2, 5000));
    return { items, matched: items.filter((i) => i.product).length, unmatched: items.filter((i) => !i.product).map((i) => i.name), total: money(items.reduce((s, i) => s + (i.product ? i.product.price * i.quantity : 0), 0)) };
  });

  // ---- commands (voice or text) ----
  const command = (raw) => {
    const n = normalize(raw);
    if (!n) return { intent: 'unknown' };
    const motion = MOTIONS.find(([words]) => hasWord(n, words));
    if (motion && (/(^|\s)(لقطي|روبوت|robot|يا)(\s|$)/.test(n) || n.split(' ').length <= 2)) return { intent: 'robot', motion: motion[1], reply: 'حاضر! 🤖' };
    const budget = parseBudget(raw);
    if (budget && /(سله|جهز|اختار|اقترح|basket|ميزاني)/.test(n)) return { intent: 'budget_basket', budget };
    if (/(وصفه|اطبخ|طبخه|مكونات|recipe)/.test(n) || RECIPES.some((r) => r.words.some((w) => hasWord(n, [normalize(w)])))) { const r = RECIPES.find((x) => x.words.some((w) => n.includes(normalize(w)))); if (r) return { intent: 'recipe', recipeId: r.id, name: r.name }; }
    if (/(وين طلبي|تتبع|اين طلبي|متى يوصل|track)/.test(n)) return { intent: 'track_order', path: '/orders' };
    if (/(اكمل الطلب|ادفع|الدفع|checkout|اطلب الان)/.test(n)) return { intent: 'navigate', path: '/checkout', label: 'إتمام الطلب' };
    const add = n.match(/^(?:لو سمحت |من فضلك )?(?:اضف|ضيف|حط|زيد|add|اشتري)\s+(.+)$/);
    const remove = n.match(/^(?:احذف|شيل|امسح|remove|delete)\s+(.+)$/);
    if (add || remove) {
      const { quantity, name } = quantityAndName((add || remove)[1].replace(/\s*(?:للسله|الى السله|على السله|في السله|من السله|to cart|from cart)\s*$/, ''));
      const p = name ? best(name) : null;
      if (!p) return { intent: 'search', query: name, reply: `لم أجد «${name}» بالضبط، هذه أقرب النتائج.` };
      return { intent: add ? 'add_to_cart' : 'remove_from_cart', productId: p.id, name: p.name, quantity, reply: add ? `أضفت ${quantity} × ${p.name} إلى السلة` : `أزلت ${p.name} من السلة` };
    }
    const open = SCREENS.find(([words]) => hasWord(n, words) || words.some((w) => n.includes(w)));
    if (open && /(افتح|روح|اذهب|ورجيني|اعرض|open|show|go)/.test(n)) return { intent: 'navigate', path: open[1], label: open[2] };
    const search = n.match(/^(?:ابحث عن|دور على|دور|ابحث|search for|search|find)\s+(.+)$/);
    if (search) return { intent: 'search', query: search[1] };
    return { intent: 'search', query: n };
  };
  api.provide('parseCommand', command);
  api.route('POST', '/ai/command', ({ req, body }) => { rate(req, 'ai', 240); return { command: command(text(body.text, 'الأمر', 1, 300)) }; });

  // ---- conversational shopping ----
  api.route('POST', '/ai/chat', ({ req, body }) => {
    rate(req, 'ai', 240);
    const message = text(body.message, 'الرسالة', 1, 1200), cmd = command(message);
    if (cmd.intent === 'budget_basket') { const b = basket(cmd.budget, message, Number(normalize(message).match(/(\d+)\s*(?:اشخاص|افراد|people)/)?.[1]) || 1); return { intent: cmd.intent, reply: b.items.length ? `جهزت لك سلة بـ ${b.total} من أصل ${b.budget} ${b.currency}. تقدر تضيفها كاملة أو تختار منها.` : 'لم أجد منتجات ضمن هذه الميزانية حاليًا.', basket: b }; }
    if (cmd.intent === 'recipe') { const r = recipe(message, Number(normalize(message).match(/(\d+)\s*(?:اشخاص|افراد|people)/)?.[1]) || null); return { intent: cmd.intent, reply: r ? `مكونات ${r.name} لـ ${r.servings} أشخاص بتكلفة تقريبية ${r.total} ${setting('currency')}${r.missing.length ? `، وما وجدت: ${r.missing.join('، ')}` : ''}.` : 'لم أجد هذه الوصفة.', recipe: r }; }
    if (['add_to_cart', 'remove_from_cart', 'navigate', 'track_order', 'robot'].includes(cmd.intent)) return { intent: cmd.intent, reply: cmd.reply || (cmd.label ? `أفتح لك ${cmd.label}` : 'تمام'), action: cmd };
    const faq = api.use('faqAnswer')(message);
    if (faq && faq.score >= 4) return { intent: 'store_info', reply: faq.answer, faq: { id: faq.id, question: faq.question } };
    const results = api.use('searchProducts')(cmd.query || message, 6);
    return { intent: results.length ? 'recommendations' : 'no_match', reply: results.length ? `وجدت ${results.length} منتجات مناسبة لطلبك.` : 'لم أجد ما يطابق طلبك. جرّب كلمات أخرى أو اسألني عن ميزانية.', products: results };
  });

  // ---- personalised recommendations ----
  api.route('GET', '/recommendations', ({ req, query }) => {
    const actor = optionalUser(req), limit = Math.min(24, Math.max(1, Number(query.get('limit')) || 8));
    const recent = (query.get('recent') || '').split(',').filter((v) => /^[\w-]{1,100}$/.test(v)).slice(0, 20);
    const sales = api.use('salesCounts')(), maxSales = Math.max(1, ...sales.values());
    const prefs = actor ? api.use('preferences')(actor.id) : null, personalized = !!prefs?.privacy.personalizedRecommendations;
    const interests = new Set(personalized ? prefs.interests : []), categoryWeight = {}, likedTags = new Set();
    const recentlyBought = new Set();
    if (actor && personalized) {
      for (const o of all("SELECT items,created_at FROM orders WHERE user_id=? AND status<>'cancelled' ORDER BY created_at DESC LIMIT 50", actor.id)) for (const line of parse(o.items, [])) {
        const data = parse(get('SELECT data FROM products WHERE id=?', line.productId)?.data, {});
        categoryWeight[data.category] = (categoryWeight[data.category] || 0) + 1;
        if (Date.now() - Date.parse(o.created_at) < 7 * 86400_000 && !STAPLE_CATEGORIES.includes(data.category)) recentlyBought.add(line.productId);
      }
      for (const productId of parse(get('SELECT product_ids FROM wishlists WHERE user_id=?', actor.id)?.product_ids, [])) for (const tag of parse(get('SELECT data FROM products WHERE id=?', productId)?.data, {}).tags || []) likedTags.add(normalize(tag));
    }
    for (const productId of personalized || !actor ? recent : []) { const data = parse(get('SELECT data FROM products WHERE id=?', productId)?.data, {}); categoryWeight[data.category] = (categoryWeight[data.category] || 0) + 0.5; }
    const scored = products().filter((p) => p.stock > 0 && !recentlyBought.has(p.id) && !recent.includes(p.id)).map((p) => {
      let score = (sales.get(p.id) || 0) / maxSales * 2 + p.rating / 5, reason = 'الأكثر طلبًا';
      if (interests.has(p.category)) { score += 3; reason = 'من اهتماماتك'; }
      if (categoryWeight[p.category]) { score += Math.min(3, categoryWeight[p.category]); if (reason === 'الأكثر طلبًا') reason = 'لأنك تشتري من هذا القسم'; }
      const overlap = (p.tags || []).filter((t) => likedTags.has(normalize(t))).length;
      if (overlap) { score += Math.min(2, overlap * 0.7); reason = 'يشبه ما في مفضلتك'; }
      if (p.flash) { score += 0.8; if (reason === 'الأكثر طلبًا') reason = 'عرض خاطف الآن'; }
      return { ...p, reason, score: Math.round(score * 100) / 100 };
    }).sort((a, b) => b.score - a.score);
    return { personalized: personalized || recent.length > 0, products: scored.slice(0, limit) };
  });
}
