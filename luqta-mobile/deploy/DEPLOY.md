# نشر خادم لُقطة

الخادم ملف Node 24 بلا أي حزم خارجية (قاعدة SQLite مدمجة). يحتاج عنوان HTTPS.

## الطريقة الأسرع (Docker على أي خادم VPS)
1. انسخ مجلد `luqta-mobile` إلى الخادم.
2. `cp deploy/.env.example deploy/.env` واملأ القيم (على الأقل `PUBLIC_HOST` و`ADMIN_EMAIL` و`ADMIN_PASSWORD`).
3. وجّه نطاقك (A record) إلى عنوان الخادم.
4. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`
   — Caddy يصدر شهادة HTTPS تلقائيًا.
5. افتح `https://<نطاقك>/api/health` ويجب أن ترى `"ok": true`.
6. في التطبيق: حسابي ← اتصال الخادم ← أدخل `https://<نطاقك>` ← اختبر ← سجّل الدخول بحساب المدير.

## بدون Docker
`NODE_ENV=production HOST=0.0.0.0 PORT=8787 COMMERCE_DB=/var/lib/luqta/commerce.sqlite node server/commerce.mjs`
خلف Nginx/Caddy مع HTTPS، وخدمة systemd لإعادة التشغيل.

## النسخ الاحتياطي
القاعدة ومفتاح التشفير في مجلد `/data` (المجلد `luqta-data`). انسخ `commerce.sqlite` و`encryption.key` يوميًا؛ بدون المفتاح لا تُقرأ رموز فيسبوك المشفّرة.

## تفعيل الخدمات (كلها اختيارية ومن الخادم فقط)
| الخدمة | المتغيرات | من أين |
|---|---|---|
| الذكاء الاصطناعي | `GEMINI_API_KEY` | Google AI Studio |
| الدخول بالهاتف | `BIRD_*` أو `TWILIO_*` | لوحة Bird / Twilio |
| الدخول بـ Google | `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` | Google Cloud Console ← OAuth client (Web) مع Redirect URI = `https://<نطاقك>/api/auth/google/callback` |
| الدفع بالبطاقة | `HYPERPAY_*` + `PUBLIC_BASE_URL` | حساب تاجر HyperPay (اختبر على eu-test أولًا) |
| إشعارات الهاتف | `PUSH_ENABLED=1` (+ `EXPO_ACCESS_TOKEN`) | Expo؛ يتطلب إضافة وحدة الإشعارات في التطبيق |

## توقيع التطبيق لـ Google Play
أنشئ مفتاحًا مرة واحدة واحفظه بأمان:
`keytool -genkeypair -v -keystore luqta-release.keystore -alias luqta -keyalg RSA -keysize 2048 -validity 10000`
ثم أضف في GitHub ← Settings ← Secrets: `LUQTA_KEYSTORE_BASE64` (= `base64 -w0 luqta-release.keystore`) و`LUQTA_KEYSTORE_PASSWORD` و`LUQTA_KEY_ALIAS` و`LUQTA_KEY_PASSWORD`. سيوقّع البناء تلقائيًا بالمفتاح الخاص.

## الجاهزية والتراجع
- فحص الجاهزية `GET /api/ready` (و`/api/health`) يستعلم قاعدة البيانات فعليًا ويُرجع 503 إن لم تستجب؛ Docker يستخدمه في HEALTHCHECK.
- وسم كل صورة برقم الإصدار: `docker build -f deploy/Dockerfile -t luqta-server:<commit> .` واحتفظ بالصورة السابقة.
- التراجع: `docker compose ... down` ثم شغّل الصورة السابقة بالمجلد نفسه `luqta-data` (البيانات لا تُمس).
- قبل أي ترقية: من لوحة الإدارة ← «العمليات والأدلة» ← «إنشاء نسخة احتياطية» ثم «تمرين استعادة».
- النشر العام مجمّد حتى قبول #102؛ مهمة CI «Release gate» تعرض حالة القبول ولا تفتح النشر بنفسها.
