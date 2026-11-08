# JAWAFA ONE AI — مركز القيادة متعدد الشركات

نسخة أولى قابلة للتشغيل من تحويل لوحة القيادة الشخصية إلى منصة لكل صاحب مصلحة: **مجانية، بلا رسوم ولا عمولة، والاشتراك الوحيد اختياري: Premium Plus.**

| المكوّن | المسار |
|---|---|
| تطبيق الويب / PWA | `dashboard/one/` — يُنشر مع GitHub Pages على `…/Mohammad-Ahmed-Ghannam/one/` بعد الدمج في `main` |
| قواعد الأمان (عزل الشركات + الأدوار) | `firestore.rules` |
| تطبيق Windows (EXE) | `apps/desktop/` (Electron) |
| تطبيق Android (APK) | `apps/android/` (Trusted Web Activity) |
| iOS | تثبيت PWA من Safari (انظر أدناه) — التطبيق الأصلي BLOCKED |
| الاختبارات | `dashboard/tests/one-core.test.cjs`, `tests/firestore/`, `tests/e2e/`, `apps/desktop/test/` |
| CI للاختبارات وبناء APK وEXE | `.github/workflows/jawafa-one-apps.yml` |

اللوحة السابقة `dashboard/index.html` بكل أقسامها (جوافة، لُقطة، AAS، TrustSoft…) لم تُعدّل، ورابطها في شريط الحالة أسفل التطبيق الجديد.

## التشغيل محليًا

```bash
# من جذر المستودع
python3 -m http.server 8000 --directory dashboard
# افتح http://127.0.0.1:8000/one/
```

بدون تسجيل دخول تعمل المعاينة ببيانات تجريبية موسومة `DEMO`. تسجيل الدخول والشركات يحتاجان Firebase.

### مع محاكيات Firebase (بدون لمس المشروع الحقيقي)

```bash
npm i -g firebase-tools@13
firebase emulators:start --project demo-jawafa-one --only auth,firestore
# افتح http://127.0.0.1:8000/one/index.html?emulator=1
```

## الاختبارات

```bash
node --test dashboard/tests/one-core.test.cjs           # منطق الأدوار، الموجّه، كشف التلاعب
node --test apps/desktop/test/*.test.cjs                # سياسة تنقل تطبيق سطح المكتب
firebase emulators:exec --project demo-jawafa-one --only firestore \
  "node --test tests/firestore/tenancy.rules.test.mjs"  # عزل الشركات والصلاحيات عبر API
firebase emulators:exec --project demo-jawafa-one --only auth,firestore \
  "node tests/e2e/jawafa-one.e2e.mjs"                   # Playwright من البداية للنهاية
```

## تطبيقات التثبيت

- **Windows:** `cd apps/desktop && npm ci && npm run dist:win` على Windows (المثبّت يحتاج Windows أو Wine). على Linux: `npm run dist:zip` ينتج نسخة محمولة.
- **Android:** `gradle -p apps/android :app:assembleDebug` (يحتاج Android SDK 35). أو شغّل workflow «JAWAFA ONE AI — tests, APK and Windows EXE» من تبويب Actions وحمّل الـ artifact.
- **iPhone/iPad:** افتح الرابط في Safari › زر المشاركة › «إضافة إلى الشاشة الرئيسية». تطبيق iOS أصلي يتطلب Mac + Xcode + حساب Apple Developer للتوقيع.

## قبل التشغيل للعامة (خطوات المالك)

1. نشر قواعد Firestore: `firebase deploy --only firestore:rules --project ameraistore-1c81d` (بعد مراجعتها).
2. Firebase Console › Authentication › Settings › Authorized domains: إضافة `amer-ai-store.github.io`.
3. تفعيل مزود Google في Authentication.
4. دمج الفرع في `main` لينشر Pages المسار `/one/`.

**خطوات النشر (لك):** [DEPLOY.md](DEPLOY.md)

التقارير: [REQUIREMENTS_MATRIX](REQUIREMENTS_MATRIX.md) · [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) · [TEST_RESULTS](TEST_RESULTS.md) · [SECURITY_CHECKLIST](SECURITY_CHECKLIST.md) · [INTEGRATION_STATUS](INTEGRATION_STATUS.md) · [AGENT_MIGRATION_REPORT](AGENT_MIGRATION_REPORT.md) · [DATABASE_CONNECTION_REPORT](DATABASE_CONNECTION_REPORT.md) · [PERFORMANCE_REPORT](PERFORMANCE_REPORT.md) · [KNOWN_ISSUES](KNOWN_ISSUES.md) · [RELEASE_READINESS](RELEASE_READINESS.md)
