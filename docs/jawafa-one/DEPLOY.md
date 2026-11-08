# دليل النشر — خطوات المالك فقط

كل ما قبل النشر منفّذ ومختبر على هذا الفرع. هذه الخطوات تحتاج حساباتك وصلاحياتك، فتُركت لك. نفّذها بالترتيب.

## 1) دمج الفرع (ينشر الويب)

- افتح طلب الدمج (Pull Request) للفرع `ccr-ae6752a9-ql2vdg` وراجعه، ثم ادمجه في `main`.
- workflow «Deploy dashboard to GitHub Pages» ينشر `dashboard/` تلقائيًا؛ التطبيق الجديد على:
  `https://amer-ai-store.github.io/Mohammad-Ahmed-Ghannam/one/`
- اللوحة القديمة تبقى على الرابط نفسه دون تغيير.

## 2) نشر قواعد الأمان (Firestore)

```bash
npm i -g firebase-tools@13
firebase login
scripts/deploy-jawafa-one.sh            # يشغّل 16 اختبارًا أولًا، ثم يطلب كتابة DEPLOY
```

بدون هذه الخطوة يبقى إنشاء الشركات مرفوضًا (القواعد الحالية في الإنتاج لا تعرف `companies`).
للتراجع: `git show c35a912:firestore.rules > firestore.rules && firebase deploy --only firestore:rules`.

## 3) تسجيل الدخول بـ Google (Firebase Console)

1. Authentication › Sign-in method › **Google** › Enable.
2. Authentication › Settings › **Authorized domains** › Add domain: `amer-ai-store.github.io`.

## 4) أول اختبار حي (يحوّل الحالات إلى VERIFIED)

1. افتح `/one/`، سجّل الدخول، أنشئ شركة، أضف فرعًا، ادعُ بريدًا ثانيًا بدور «مدقق».
2. من حساب البريد الثاني: اقبل الدعوة وتأكد أن الحقول للقراءة فقط.
3. من حساب ثالث: تأكد أنه لا يرى الشركة.
4. أرسل لي النتيجة أو لقطات الشاشة لأحدّث `REQUIREMENTS_MATRIX.md`.

## 5) تطبيق Android بتوقيع ثابت (مرة واحدة)

```bash
scripts/make-android-keystore.sh        # على جهازك؛ يحتاج Java
```

- أضف الأسرار الأربعة التي يطبعها في: GitHub › Settings › Secrets and variables › Actions.
- ارفع `assetlinks.json` الناتج إلى المستودع `Amer-ai-store/amer-ai-store.github.io` في المسار `.well-known/assetlinks.json` (ليفتح التطبيق بملء الشاشة دون شريط عنوان).
- احفظ ملف `.jks` وكلمة المرور في مكان آمن؛ فقدانهما يمنع تحديث التطبيق لاحقًا.
- بعدها يبني workflow «JAWAFA ONE AI — tests, APK and Windows EXE» نسخة **APK + AAB موقّعة** (artifact: `jawafa-one-android-release`). ملف AAB هو ما يُرفع إلى Google Play.

## 6) Windows

- المثبّت والنسخة المحمولة في artifact `jawafa-one-windows` لكل تشغيل للـ workflow.
- غير موقّعين: سيظهر تحذير SmartScreen. لإزالته تحتاج شهادة توقيع كود (Code Signing) — اختياري.

## 7) iPhone

- الآن: Safari › مشاركة › «إضافة إلى الشاشة الرئيسية» على رابط `/one/`.
- تطبيق في App Store: يحتاج Mac + Xcode + حساب Apple Developer (99$ سنويًا).

## ما لا يحتاج منك شيئًا

الاختبارات (16 قواعد، 28 شاملة، 6 وحدات، 3 سطح مكتب) تعمل تلقائيًا في GitHub Actions مع كل تعديل على هذه الملفات.
