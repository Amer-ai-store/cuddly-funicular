// Support: help center (FAQ), order-linked chat answered first by the store bot, hand-over to a human agent,
// and image attachments (stored in the database, readable only by their owner and the store staff).
import { normalize, matchScore } from './text.mjs';

export const name = 'support';

const FAQS = [
  ['delivery', 'كم يستغرق التوصيل وكم رسومه؟', 'نوصل داخل عمّان خلال ساعتين تقريبًا وبقية المدن خلال يوم. الرسوم حسب منطقتك وتظهر قبل التأكيد، والتوصيل مجاني فوق حد معيّن لكل منطقة.', 'توصيل رسوم شحن موعد وقت يوصل متى'],
  ['delivery', 'هل أستطيع اختيار موعد التوصيل؟', 'نعم، اختر الفترة الصباحية أو بعد الظهر أو المسائية عند إتمام الطلب. لكل فترة سعة محدودة، والمواعيد الممتلئة لا تظهر.', 'موعد فتره صباح مساء وقت التوصيل'],
  ['returns', 'كيف أرجع منتجًا؟', 'من «طلباتي» اختر الطلب ثم «إرجاع»، وحدّد المنتجات والكمية والسبب ويمكنك إرفاق صورة. بعد الموافقة يُضاف المبلغ إلى محفظتك.', 'ارجاع استرجاع مرتجع استبدال رد المبلغ'],
  ['payment', 'ما طرق الدفع المتاحة؟', 'الدفع عند الاستلام، أو من رصيد المحفظة، أو بالبطاقة (حاليًا في وضع تجريبي دون خصم فعلي).', 'دفع بطاقه فيزا كاش محفظه نقدا'],
  ['orders', 'كيف أتتبع طلبي؟', 'افتح «طلباتي» ثم «تتبع» لترى مراحل الطلب وموقع السائق على الخريطة والوقت المتوقع. عند وصول السائق أعطه رمز التسليم الظاهر في الطلب.', 'تتبع وين طلبي موقع السائق رمز التسليم'],
  ['orders', 'هل يمكنني إلغاء الطلب؟', 'يمكنك إلغاء الطلب ما دام «بانتظار التأكيد» أو «تم التأكيد». بعد بدء التجهيز تواصل معنا.', 'الغاء الغي طلب'],
  ['rewards', 'كيف أجمع النقاط وأستبدلها؟', 'تحصل على نقطة لكل دينار بعد استلام الطلب، وعلى نقاط يومية عند تسجيل الحضور. كل 100 نقطة = 1 دينار في المحفظة.', 'نقاط مكافات استبدال ولاء حضور'],
  ['account', 'نسيت كلمة المرور، ماذا أفعل؟', 'استخدم «استعادة الحساب» مع رمز الاسترداد الذي حصلت عليه عند التسجيل لتعيين كلمة مرور جديدة.', 'نسيت كلمه المرور استعاده الحساب دخول'],
  ['privacy', 'كيف أحمي خصوصيتي؟', 'من «حسابي ← الخصوصية والأجهزة» تتحكم بالتوصيات المخصصة وسجل البحث، وترى الأجهزة المسجلة وتنهي جلساتها، ويمكنك تصدير بياناتك أو حذف حسابك.', 'خصوصيه بيانات اجهزه حذف تصدير'],
  ['wallet', 'كيف أشحن المحفظة ببطاقة هدية؟', 'من «المحفظة» اختر «شحن بطاقة هدية» وأدخل الرمز LQ-XXXX-XXXX-XXXX، فيضاف الرصيد فورًا.', 'بطاقه هديه شحن محفظه رصيد'],
];
const ORDER_LABELS = { pending: 'بانتظار التأكيد', confirmed: 'تم التأكيد', preparing: 'قيد التجهيز', out_for_delivery: 'خرج للتوصيل', delivered: 'تم التسليم', cancelled: 'ملغي' };
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, id, now, json, parse, requireUser, admin, audit, notify, rate, setting } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,size INTEGER NOT NULL,purpose TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS faqs(id TEXT PRIMARY KEY,category TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,keywords TEXT NOT NULL DEFAULT '',sort INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,helpful INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS chat_threads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),order_id TEXT REFERENCES orders(id),subject TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('bot','human','resolved')),escalated_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES chat_threads(id),sender TEXT NOT NULL CHECK(sender IN ('user','bot','agent')),user_id TEXT,body TEXT NOT NULL,upload_id TEXT REFERENCES uploads(id),created_at TEXT NOT NULL);
  `);
  if (!get('SELECT id FROM faqs LIMIT 1')) FAQS.forEach(([category, question, answer, keywords], i) => run('INSERT INTO faqs VALUES(?,?,?,?,?,?,1,0)', `faq_${i + 1}`, category, question, answer, keywords, i));

  // ---- uploads ----
  const saveUpload = (userId, source, purpose) => {
    const match = typeof source === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(source);
    if (!match) fail(400, 'أرفق صورة PNG أو JPEG أو WebP', 'invalid_upload');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 600_000) fail(413, 'حجم الصورة يجب ألا يتجاوز 600 كيلوبايت', 'upload_too_large');
    const magic = { png: bytes.subarray(0, 4).toString('hex') === '89504e47', jpeg: bytes.subarray(0, 3).toString('hex') === 'ffd8ff', webp: bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP' }[match[1]];
    if (!magic) fail(400, 'محتوى الصورة لا يطابق نوعها', 'invalid_upload');
    if (get("SELECT COALESCE(SUM(size),0) AS n FROM uploads WHERE user_id=? AND created_at>?", userId, new Date(Date.now() - 86400_000).toISOString()).n + bytes.length > 10_000_000) fail(429, 'تجاوزت حد رفع الصور اليومي', 'rate_limited');
    const uploadId = id('upl');
    run('INSERT INTO uploads VALUES(?,?,?,?,?,?,?)', uploadId, userId, MIME[match[1]], bytes.length, purpose, bytes, now());
    return uploadId;
  };
  api.provide('saveUpload', saveUpload);
  api.route('POST', '/uploads', ({ req, body }) => { const actor = requireUser(req); rate(req, 'uploads', 30); return [201, { uploadId: saveUpload(actor.id, body.image, 'attachment') }]; });
  api.route('GET', '/uploads/:uploadId', ({ req, params }) => {
    const actor = requireUser(req), row = get('SELECT * FROM uploads WHERE id=?', params.uploadId);
    if (!row || row.user_id !== actor.id && actor.role !== 'admin') fail(404, 'الملف غير موجود', 'not_found');
    return { upload: { id: row.id, mime: row.mime, size: row.size, dataUrl: `data:${row.mime};base64,${Buffer.from(row.data).toString('base64')}`, createdAt: row.created_at } };
  });

  // ---- help center ----
  const faqItem = (f) => ({ id: f.id, category: f.category, question: f.question, answer: f.answer, keywords: f.keywords, sort: f.sort, active: !!f.active, helpful: f.helpful });
  const faqAnswer = (message) => {
    const scored = all('SELECT * FROM faqs WHERE active=1').map((f) => ({ f, score: matchScore(message, f.question, `${f.keywords} ${f.answer}`) })).sort((a, b) => b.score - a.score)[0];
    return scored && scored.score > 0 ? { ...faqItem(scored.f), score: scored.score } : null;
  };
  api.provide('faqAnswer', faqAnswer);
  api.route('GET', '/faqs', ({ query }) => {
    const q = (query.get('q') || '').slice(0, 200), category = query.get('category');
    let rows = all('SELECT * FROM faqs WHERE active=1 ORDER BY sort').map(faqItem);
    if (category) rows = rows.filter((f) => f.category === category);
    if (q) rows = rows.map((f) => ({ ...f, score: matchScore(q, f.question, `${f.keywords} ${f.answer}`) })).filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
    return { faqs: rows, categories: [...new Set(all('SELECT category FROM faqs WHERE active=1').map((r) => r.category))] };
  });
  api.route('POST', '/faqs/:faqId/helpful', ({ req, params }) => { rate(req, 'faq-vote', 60); if (!run('UPDATE faqs SET helpful=helpful+1 WHERE id=? AND active=1', params.faqId).changes) fail(404, 'السؤال غير موجود', 'not_found'); return { ok: true }; });
  api.route('GET', '/admin/faqs', ({ req }) => { admin(req); return { faqs: all('SELECT * FROM faqs ORDER BY sort').map(faqItem) }; });
  api.route('POST', '/admin/faqs', ({ req, body }) => {
    const actor = admin(req), faqId = id('faq');
    run('INSERT INTO faqs VALUES(?,?,?,?,?,?,1,0)', faqId, text(body.category || 'general', 'التصنيف', 2, 40), text(body.question, 'السؤال', 5, 300), text(body.answer, 'الإجابة', 5, 3000), body.keywords ? String(body.keywords).slice(0, 500) : '', body.sort ? integer(body.sort, 'الترتيب', 0, 1000) : 100);
    audit(actor, 'faq.create', faqId);
    return [201, { faq: faqItem(get('SELECT * FROM faqs WHERE id=?', faqId)) }];
  });
  api.route('PATCH', '/admin/faqs/:faqId', ({ req, body, params }) => {
    const actor = admin(req), f = get('SELECT * FROM faqs WHERE id=?', params.faqId); if (!f) fail(404, 'السؤال غير موجود', 'not_found');
    run('UPDATE faqs SET category=?,question=?,answer=?,keywords=?,sort=?,active=? WHERE id=?', body.category !== undefined ? text(body.category, 'التصنيف', 2, 40) : f.category, body.question !== undefined ? text(body.question, 'السؤال', 5, 300) : f.question, body.answer !== undefined ? text(body.answer, 'الإجابة', 5, 3000) : f.answer, body.keywords !== undefined ? String(body.keywords).slice(0, 500) : f.keywords, body.sort !== undefined ? integer(body.sort, 'الترتيب', 0, 1000) : f.sort, body.active !== undefined ? (body.active ? 1 : 0) : f.active, f.id);
    audit(actor, 'faq.update', f.id);
    return { faq: faqItem(get('SELECT * FROM faqs WHERE id=?', f.id)) };
  });

  // ---- chat with the store bot, linked to an order, with hand-over to a human ----
  const messageItem = (m) => ({ id: m.id, sender: m.sender, body: m.body, uploadId: m.upload_id, createdAt: m.created_at });
  const threadItem = (t, withMessages = false) => ({ id: t.id, orderId: t.order_id, subject: t.subject, status: t.status, escalatedAt: t.escalated_at, createdAt: t.created_at, updatedAt: t.updated_at,
    lastMessage: (() => { const m = get('SELECT * FROM chat_messages WHERE thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', t.id); return m ? messageItem(m) : null; })(),
    ...(withMessages ? { messages: all('SELECT * FROM chat_messages WHERE thread_id=? ORDER BY created_at,rowid', t.id).map(messageItem) } : {}) });
  const say = (threadId, sender, body, userId = null, uploadId = null) => { run('INSERT INTO chat_messages VALUES(?,?,?,?,?,?,?)', id('msg'), threadId, sender, userId, body, uploadId, now()); run('UPDATE chat_threads SET updated_at=? WHERE id=?', now(), threadId); };
  const escalate = (t, actor, reason) => {
    run("UPDATE chat_threads SET status='human',escalated_at=?,updated_at=? WHERE id=?", now(), now(), t.id);
    say(t.id, 'bot', 'حوّلتك إلى أحد موظفي الدعم 👩‍💼 سيرد عليك هنا قريبًا، وستصلك إشعارًا عند الرد.');
    for (const a of all("SELECT id FROM users WHERE role='admin'")) notify(a.id, 'طلب دعم بشري', `${actor.name}: ${t.subject}`);
    audit(actor, 'support.escalate', t.id, { reason });
  };
  const botReply = (t, message) => {
    const n = normalize(message);
    if (/(موظف|انسان|بشري|شخص حقيقي|خدمه العملاء|human|agent)/.test(n)) return { escalate: true };
    if (t.order_id) {
      const o = get('SELECT * FROM orders WHERE id=?', t.order_id);
      if (o && /(وين|متى|تتبع|وصل|يوصل|تاخر|موعد|track|where)/.test(n)) {
        const extras = parse(get('SELECT data FROM order_extras WHERE order_id=?', o.id)?.data, {});
        const slot = extras?.slot ? ` موعد التوصيل المحجوز: ${extras.slot.label} يوم ${extras.slot.date}.` : extras?.zone ? ` الوقت المتوقع للتوصيل نحو ${Math.round(extras.zone.etaMinutes / 60)} ساعة من التأكيد.` : '';
        return { text: `طلبك ${o.id} حالته الآن «${ORDER_LABELS[o.status] || o.status}».${slot}${o.status === 'out_for_delivery' ? ' السائق في الطريق؛ تابع موقعه من صفحة التتبع.' : ''}` };
      }
      if (o && /(الغاء|الغي|كنسل|cancel)/.test(n)) return { text: ['pending', 'confirmed'].includes(o.status) ? 'يمكنك إلغاء هذا الطلب الآن من صفحة الطلب ← «إلغاء الطلب»، ويُعاد أي مبلغ مدفوع إلى محفظتك.' : `لا يمكن إلغاء الطلب وهو «${ORDER_LABELS[o.status]}». إن كانت هناك مشكلة اطلب موظفًا.` };
      if (o && /(ارجاع|استرجاع|مرتجع|استبدال|return)/.test(n)) return { text: o.status === 'delivered' ? `يمكنك إرجاع منتجات هذا الطلب خلال ${setting('returnsDays')} يومًا من الاستلام من «طلباتي ← إرجاع»، مع صورة إن وُجد عيب.` : 'يتاح الإرجاع بعد استلام الطلب.' };
    }
    const faq = faqAnswer(message);
    if (faq && faq.score >= 2) return { text: `${faq.answer}\n\nهل أجبت سؤالك؟ إن لم يكن، اضغط «طلب موظف».`, faqId: faq.id };
    return { text: 'لم أفهم طلبك تمامًا 🤖 جرّب صياغة أخرى، أو اضغط «طلب موظف» ليساعدك أحد فريقنا.' };
  };
  const ownThread = (actor, threadId) => { const t = get('SELECT * FROM chat_threads WHERE id=?', threadId); if (!t || t.user_id !== actor.id && actor.role !== 'admin') fail(404, 'المحادثة غير موجودة', 'not_found'); return t; };
  const userMessage = (actor, t, body) => {
    const message = body.message ? text(body.message, 'الرسالة', 1, 2000) : '';
    const uploadId = body.image ? saveUpload(actor.id, body.image, 'support') : null;
    if (!message && !uploadId) fail(400, 'اكتب رسالة أو أرفق صورة');
    say(t.id, 'user', message || '📷 صورة مرفقة', actor.id, uploadId);
    if (t.status === 'resolved') run("UPDATE chat_threads SET status='bot' WHERE id=?", t.id);
    const current = get('SELECT * FROM chat_threads WHERE id=?', t.id);
    if (current.status === 'bot') {
      const reply = message ? botReply(current, message) : { text: 'وصلتني الصورة 👍 صف لي المشكلة بكلمات قليلة، أو اطلب موظفًا لمراجعتها.' };
      if (reply.escalate) escalate(current, actor, 'user_request'); else say(t.id, 'bot', reply.text);
    }
  };
  api.route('GET', '/support/chats', ({ req }) => ({ chats: all('SELECT * FROM chat_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 100', requireUser(req).id).map((t) => threadItem(t)) }));
  api.route('POST', '/support/chats', ({ req, body }) => {
    const actor = requireUser(req); rate(req, 'support', 30);
    const orderId = body.orderId ? text(body.orderId, 'الطلب', 1, 100) : null;
    if (orderId) c.ownOrder(actor, orderId);
    const threadId = id('chat'), time = now();
    const thread = transaction(() => {
      run('INSERT INTO chat_threads VALUES(?,?,?,?,?,NULL,?,?)', threadId, actor.id, orderId, body.subject ? text(body.subject, 'الموضوع', 2, 120) : orderId ? `استفسار عن الطلب ${orderId}` : 'استفسار عام', 'bot', time, time);
      say(threadId, 'bot', `أهلًا ${String(actor.name).split(' ')[0]} 👋 أنا لُقطي، مساعد الدعم.${orderId ? ` أرى أنك تسأل عن الطلب ${orderId}.` : ''} كيف أساعدك؟`);
      if (body.message || body.image) userMessage(actor, get('SELECT * FROM chat_threads WHERE id=?', threadId), body);
      return get('SELECT * FROM chat_threads WHERE id=?', threadId);
    });
    return [201, { chat: threadItem(thread, true) }];
  });
  api.route('GET', '/support/chats/:chatId', ({ req, params }) => ({ chat: threadItem(ownThread(requireUser(req), params.chatId), true) }));
  api.route('POST', '/support/chats/:chatId/messages', ({ req, body, params }) => {
    const actor = requireUser(req); rate(req, 'support-message', 120);
    const t = ownThread(actor, params.chatId); if (t.user_id !== actor.id) fail(403, 'استخدم ردود الإدارة للرد على العميل', 'forbidden');
    transaction(() => userMessage(actor, t, body));
    return [201, { chat: threadItem(get('SELECT * FROM chat_threads WHERE id=?', t.id), true) }];
  });
  api.route('POST', '/support/chats/:chatId/escalate', ({ req, params }) => {
    const actor = requireUser(req), t = ownThread(actor, params.chatId);
    if (t.status === 'human') return { chat: threadItem(t, true) };
    transaction(() => escalate(t, actor, 'button'));
    return { chat: threadItem(get('SELECT * FROM chat_threads WHERE id=?', t.id), true) };
  });
  api.route('GET', '/admin/chats', ({ req, query }) => {
    admin(req); const status = query.get('status');
    const rows = status ? all('SELECT * FROM chat_threads WHERE status=? ORDER BY updated_at DESC LIMIT 300', status) : all('SELECT * FROM chat_threads ORDER BY CASE status WHEN \'human\' THEN 0 WHEN \'bot\' THEN 1 ELSE 2 END,updated_at DESC LIMIT 300');
    return { chats: rows.map((t) => ({ ...threadItem(t), customer: get('SELECT name FROM users WHERE id=?', t.user_id)?.name || '' })) };
  });
  api.route('GET', '/admin/chats/:chatId', ({ req, params }) => { admin(req); const t = get('SELECT * FROM chat_threads WHERE id=?', params.chatId); if (!t) fail(404, 'المحادثة غير موجودة', 'not_found'); return { chat: { ...threadItem(t, true), customer: get('SELECT name FROM users WHERE id=?', t.user_id)?.name || '' } }; });
  api.route('POST', '/admin/chats/:chatId/messages', ({ req, body, params }) => {
    const actor = admin(req), t = get('SELECT * FROM chat_threads WHERE id=?', params.chatId); if (!t) fail(404, 'المحادثة غير موجودة', 'not_found');
    transaction(() => { say(t.id, 'agent', text(body.message, 'الرد', 1, 2000), actor.id); run("UPDATE chat_threads SET status='human' WHERE id=?", t.id); notify(t.user_id, 'رد من فريق الدعم', String(body.message).slice(0, 80)); audit(actor, 'support.reply', t.id); });
    return [201, { chat: threadItem(get('SELECT * FROM chat_threads WHERE id=?', t.id), true) }];
  });
  api.route('PATCH', '/admin/chats/:chatId', ({ req, body, params }) => {
    const actor = admin(req), t = get('SELECT * FROM chat_threads WHERE id=?', params.chatId); if (!t) fail(404, 'المحادثة غير موجودة', 'not_found');
    if (!['bot', 'human', 'resolved'].includes(body.status)) fail(400, 'حالة المحادثة غير صالحة');
    run('UPDATE chat_threads SET status=?,updated_at=? WHERE id=?', body.status, now(), t.id);
    if (body.status === 'resolved') notify(t.user_id, 'أُغلقت محادثة الدعم', 'نأمل أن مشكلتك حُلّت. يمكنك الرد لإعادة فتحها.');
    audit(actor, 'support.status', t.id, { status: body.status });
    return { chat: threadItem(get('SELECT * FROM chat_threads WHERE id=?', t.id), true) };
  });

  api.on('deleteUser', (userId) => {
    run("UPDATE chat_messages SET body='تم حذف بيانات المرسل',upload_id=NULL WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id=?)", userId);
    run('UPDATE return_details SET photo_id=NULL WHERE photo_id IN (SELECT id FROM uploads WHERE user_id=?)', userId);
    run('DELETE FROM uploads WHERE user_id=?', userId);
  });
  api.use('registerExport')('supportChats', (userId) => all('SELECT id,order_id AS orderId,subject,status,created_at AS createdAt FROM chat_threads WHERE user_id=?', userId).map((t) => ({ ...t, messages: all('SELECT sender,body,created_at AS createdAt FROM chat_messages WHERE thread_id=? ORDER BY created_at', t.id) })));
  api.use('registerExport')('uploads', (userId) => all('SELECT id,mime,size,purpose,created_at AS createdAt FROM uploads WHERE user_id=?', userId));
}
