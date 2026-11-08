# النشر التلقائي

| الجزء | متى يُنشر | أين |
|---|---|---|
| تطبيق Android المدموج «لُقطة» | يُبنى مع كل push إلى `main` يغيّر `luqta-mobile/`، ويُحفظ كـ artifact. نشره كـ Release يبقى خلف البوابات أدناه | artifact في GitHub Actions، وبعد اجتياز البوابات [GitHub Releases](https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases) |
| لوحة التحكم (الويب) | مع كل push إلى `main` يغيّر `dashboard/`: يفحص `pages.yml` خلو الملفات من الروابط الخاصة، ثم ينشر النسخة العامة، ويقرأها من الرابط العام للتحقق (`verify-live`) | https://amer-ai-store.github.io/Mohammad-Ahmed-Ghannam/ |

> ⛔ **نشر الـ Release محكوم ببوابات (Issue #102).** رفع المالك التجميد الإداري في 2026-11-04، لكن الـ workflow لا ينشر أي Release إلا إذا تحققت كل هذه الشروط:
> 1. بيئة باسم `production` في **Settings → Environments**، لها **Required reviewers**.
> 2. متغير (وليس سرًا) باسم `RELEASE_PUBLISHING_ENABLED` بقيمة `true`.
> 3. متغير `RELEASE_APPROVED_SHA` بقيمة SHA الكامل للـ commit المعتمد للنشر تحديدًا، لا اسم الفرع ولا `*`.
> 4. مفتاح التوقيع الثابت: الأسرار `SIGNING_KEYSTORE_BASE64` و`SIGNING_STORE_PASSWORD` و`SIGNING_KEY_PASSWORD`.
>
> إذا كان التوقيع مؤقتًا، أو SHA غير معتمد، تُتخطّى مهمة `publish` حتى لو كان مفتاح تشغيل النشر مفعلًا. لا يجوز اعتبار وجود بيئة `production` وحده إثباتًا لوجود مراجعين مفروضين؛ تحقق منهم من إعدادات GitHub. طلبات الدمج والتشغيل اليدوي من فرع غير `main` لا تستلم مفتاح التوقيع الثابت.
>
> **كيف تعرف أن مفتاح التوقيع الثابت غير مضبوط؟** يظهر في سجل خطوة «Build, sign and verify the release APK» السطر `Signer #1 certificate DN: CN=Amer Store CI`، وهو المفتاح المؤقت الذي يولّده الـ workflow، مع تحذير «No upload key for this run». بعد ضبط الأسرار، يظهر اسم شهادتك أنت.
>
> **للنشر بعد ضبط البوابات:** ضع في `RELEASE_APPROVED_SHA` آخر commit على `main`، ثم شغّل **Actions → Release Android app → Run workflow** على `main`، ووافق على بيئة `production`. الخطوات المختصرة لكل نسخة، مع الأخطاء الشائعة، في [release-runbook.md](release-runbook.md).

## تطبيق Android (`.github/workflows/release.yml`)
يُنشر الآن التطبيق المدموج في `luqta-mobile/` (Expo وReact Native)، بدل تطبيق Kotlin القديم في `app/`.
يبقى تطبيق Kotlin في المستودع، ويُبنى ويُختبر في `android-build.yml`، لكنه لا يُنشر.

1. يشغّل فحص الأنواع والـ lint واختبارات الخادم، وإذا فشل أي منها لا يُنشر شيء.
2. يولّد مشروع Android الأصلي (`expo prebuild`)، ثم يبني نسخة **release** لمعالجات arm64 وarmv7، ويوقّعها بمفتاح الرفع، ويتحقق من التوقيع.
3. يحفظ الـ APK كـ artifact باسم `luqta-release-apk`، ويُنشئ Release باسم `v2.0.<رقم التشغيل>` فيه `amer-store.apk` فقط عند اجتياز البوابات (انظر أعلاه).

رابط ثابت لأحدث نسخة دائمًا (لم يتغيّر):
https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/latest/download/amer-store.apk

لا يمكن تثبيت APK فوق نسخة سابقة إلا إذا كان توقيعه بنفس مفتاح التوقيع الثابت مع `versionCode` أكبر؛ نسخ الاختبار ذات التوقيع المؤقت ليست ترقيات إنتاجية.
اسم الحزمة `com.luqta.store` يختلف عن تطبيق Kotlin القديم، فيُثبَّت التطبيق الجديد بجانب القديم، ويمكن حذف القديم يدويًا.

### عنوان خادم المتجر داخل التطبيق (اختياري)
أضف متغيرًا (وليس سرًا) في **Settings → Secrets and variables → Actions → Variables** باسم `LUQTA_API_URL`، وقيمته عنوان خادم المتجر العام بصيغة HTTPS، مثل `https://store.example.com`.
بدونه يفتح التطبيق شاشة «إعداد الاتصال» ليُدخل المستخدم العنوان.

### اختبارات المتصفح (`luqta-jawafa-ci.yml`)
في كل PR يغيّر التطبيق أو لوحة التحكم:
- 45 اختبارًا تشغّل التطبيق في Chromium، منها اختبار يفتح شاشات الموظفين بالإنجليزية.
- 25 اختبارًا تشغّل لوحة التحكم المركزية.
- يرفض العمل إذا بقيت أي ميزة من الـ125 دون اختبار ناجح على كل واجهة تخصها.
لقطات الشاشة للخطوات الفاشلة، والملف `feature-status.json`، تُرفع كـ artifact.

## مفتاح التوقيع (مرة واحدة، مُوصى به)
بدون مفتاح ثابت يوقَّع كل APK بمفتاح جديد مؤقت، فيرفض الهاتف التحديث حتى تُحذف النسخة السابقة (وتُحذف بياناتها معها).
لتثبيت التحديثات فوق بعضها أضف مفتاحاً ثابتاً:

1. أنشئ المفتاح على حاسوبك (مرة واحدة، واحتفظ بنسخة منه في مكان آمن؛ ضياعه يعني أن المستخدمين لن يستطيعوا التحديث):
   ```
   keytool -genkeypair -keystore upload-key.jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   الاسم المستعار (alias) يجب أن يكون `upload`.
2. حوّله إلى نص: `base64 -w0 upload-key.jks` (على macOS: `base64 -i upload-key.jks`).
3. في GitHub: **Settings → Secrets and variables → Actions → New repository secret**، وأضف:
   - `SIGNING_KEYSTORE_BASE64`: النص الناتج من الخطوة 2
   - `SIGNING_STORE_PASSWORD`: كلمة مرور المفتاح
   - `SIGNING_KEY_PASSWORD`: كلمة مرور الـ alias (اتركه إن كانت نفسها)

لا تضع ملف المفتاح أو كلمات مروره في المستودع.

### بلا حاسوب ولا طرفية (من المتصفح فقط)
ينشئ الـ workflow `release-signing-setup.yml` المفتاح على خادم GitHub، ويحفظه في الأسرار الثلاثة. لا يمر المفتاح بك ولا بأي طرف آخر.
1. أنشئ رمزًا مؤقتًا من https://github.com/settings/personal-access-tokens/new:
   - **Expiration**: يوم واحد.
   - **Repository access**: «Only select repositories»، ثم اختر هذا المستودع فقط.
   - **Permissions → Repository permissions → Secrets**: «Read and write»، ولا شيء غيره.
   - اضغط **Generate token** وانسخ الرمز.
2. احفظه سرًّا باسم `RELEASE_SETUP_TOKEN` من **Settings → Secrets and variables → Actions → New repository secret**.
3. شغّل **Actions → Release signing key setup (one time) → Run workflow** على `main`.
4. بعد نجاحه احذف السر `RELEASE_SETUP_TOKEN`، وألغِ الرمز من صفحة الرموز.
   لحذف السر دون لمس صفحة الأسرار، شغّل **Actions → Release setup token cleanup → Run workflow** على `main`. يحذف السر `RELEASE_SETUP_TOKEN` وحده، ولا يعمل إلا بعد وجود الأسرار الثلاثة `SIGNING_*`. يبقى الرمز نفسه صالحًا حتى تاريخ انتهائه، لكن لا يستطيع أي workflow استعماله بعد حذف السر.

### نسخة احتياطية مشفّرة من المفتاح (من المتصفح فقط)
أسرار GitHub لا تُعرض بعد حفظها، فالأسرار `SIGNING_*` هي النسخة الوحيدة من المفتاح. ينشئ الـ workflow `release-signing-backup.yml` منها ملفًا مضغوطًا مشفّرًا تنزّله وتحفظه عندك:
1. اختر كلمة مرور طويلة (16 حرفًا على الأقل) واحفظها في مكان آمن غير الملف نفسه، مثل مدير كلمات المرور.
2. احفظها سرًّا باسم `SIGNING_BACKUP_PASSWORD` من **Settings → Secrets and variables → Actions → New repository secret**.
3. شغّل **Actions → Release signing key backup → Run workflow** على `main`.
4. نزّل الملف `luqta-signing-key-backup` من صفحة التشغيل خلال يوم واحد، واحفظه في مكان تتحكم به، مثل Google Drive.

يحتوي الملف (`.7z` بتشفير AES-256 يخفي أسماء الملفات أيضًا) على `upload-key.jks` وملف `README.txt`. في `README.txt` كلمات المرور والاسم المستعار وبصمة الشهادة وطريقة الاسترجاع. يُفتح على Android بتطبيق مثل ZArchiver، وبكلمة المرور التي اخترتها فقط.
قبل الرفع يفتح الـ workflow الملف بكلمة المرور ويتحقق من المفتاح داخله، ويطبع بصمة الشهادة (SHA-256) في ملخص التشغيل. لا يغيّر أي سر ولا متغير.

ملاحظات:
- **التشغيل مرة واحدة فقط:** لا تشغّله تلقائيًا مع كل طلب أو PR أو محادثة، ولا تنسخه إلى مستودع غير مرتبط بالتطبيق.
- **فحص الشهادة أولًا:** إذا وُزّعت نسخ APK سابقًا، فتحقق من شهادة التوقيع المستخدمة فيها؛ وجود الأسرار وحده ليس دليلًا على أن المفتاح الجديد سيحافظ على التحديثات. لا تنشئ مفتاحًا جديدًا إذا كانت هوية المفتاح الأصلي غير معروفة.
- **لا استبدال:** يرفض الـ workflow وجود أيٍّ من الأسرار الثلاثة `SIGNING_*`، حتى لو كانت ناقصة. في حالة الحفظ الجزئي، أصلح الحالة يدويًا من المصدر الأصلي الموثوق، ولا تحذف الأسرار لإعادة التوليد.
- **ضرورة النسخة الاحتياطية:** أسرار GitHub لا يمكن استرجاع قيمها بعد الحفظ، والـ workflow الحالي **لا ينشئ نسخة احتياطية قابلة للاسترداد**. لا تعتمد المفتاح للنشر المستمر دون طريقة نسخ احتياطي مشفّر مستقلة ومختبرة. الكتابة في الأسرار الثلاثة ليست عملية ذرّية؛ ظهور أسمائها بعد التنفيذ يثبت وجودها فقط ولا يثبت قابلية استرداد المفتاح.
- لا يغيّر متغيرات النشر ولا بيئة `production`، وتبقى بوابات Issue #102 خاضعة للتحقق المستقل.
- فقدان مفتاح توقيع APK المستقل قد يمنع تحديث النسخ المثبتة. إذا كان التطبيق موزعًا عبر Google Play مع Play App Signing فقد تختلف إجراءات استرداد مفتاح **الرفع**؛ لا تفترض إمكان تدوير مفتاح توقيع نسخة APK مستقلة.

## ملاحظات
- `ADMIN_PASSWORD` لا يدخل أي APK منشور، لأن الإصدارات عامة ويمكن لأي شخص تنزيلها.
- أي PR يغيّر هذا الـ workflow أو إعدادات التطبيق الأصلية (`luqta-mobile/app.json` و`app.config.js` و`package.json` و`plugins/`)، وكذلك التشغيل اليدوي من فرع غير `main`، يبني الـ APK ويرفعه كـ artifact دون نشر Release.
- عامل Cloudflare في `aas-cc/` لا يُنشر تلقائياً، لأنه نسخة تجريبية مُختبرة بمحاكاة فقط.
