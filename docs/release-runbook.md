# دليل النشر السريع لتطبيق لُقطة

دليل عملي لكل نسخة جديدة من التطبيق، لك وللمساعد (Claude أو Codex أو ChatGPT) في أي محادثة.
التفاصيل الكاملة والإعداد لأول مرة في [release-setup.md](release-setup.md).

- **المستودع:** `Amer-ai-store/Mohammad-Ahmed-Ghannam`
- **رابط التحميل الدائم** (يشير دائمًا إلى أحدث نسخة منشورة):
  https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/latest/download/amer-store.apk
- **أول نسخة بالمفتاح الثابت:** v2.0.86 (2026-11-05). الشهادة `CN=Amer AI Store, O=Amer AI Store, C=JO`.

## ما ضُبط مرة واحدة ولا يُعاد

| البند | الحالة |
|---|---|
| مفتاح التوقيع الثابت (`SIGNING_KEYSTORE_BASE64` و`SIGNING_STORE_PASSWORD` و`SIGNING_KEY_PASSWORD`) | محفوظ في أسرار المستودع. **لا تحذفه ولا تستبدله ولا تشغّل `release-signing-setup.yml` مرة أخرى.** |
| نسخة احتياطية مشفّرة من المفتاح | محفوظة عند المالك. كلمة مرورها في السر `SIGNING_BACKUP_PASSWORD` |
| الرمز المؤقت `RELEASE_SETUP_TOKEN` | حُذف بعد الاستعمال، ولا حاجة إليه بعد الآن |
| بيئة `production` | تطلب موافقة `Amer-ai-store` قبل كل نشر |
| المتغير `RELEASE_PUBLISHING_ENABLED` | `true` |
| المتغير `RELEASE_APPROVED_SHA` | يتغير مع كل نسخة (الخطوة 2 أدناه) |

## نشر نسخة جديدة: 5 خطوات (نحو 20 دقيقة)

المالك يعمل من الهاتف فقط، بلا حاسوب ولا طرفية. خطوتان فقط عليه، والباقي على المساعد.

1. **المساعد:** يدمج التغييرات في `main` بعد نجاح كل الفحوص، ثم يرسل للمالك SHA الكامل لآخر commit على `main` (40 حرفًا)، مع رابط الخطوة 2.
2. **المالك:** يفتح
   https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/settings/variables/actions/RELEASE_APPROVED_SHA
   ويضع الـ SHA مكان القيمة القديمة، ثم يضغط **Update variable**، ويكتب للمساعد «تم».
   إن لم تفتح الصفحة، فمن **Settings → Secrets and variables → Actions → Variables** اضغط القلم ✏️ بجانب `RELEASE_APPROVED_SHA`.
3. **المساعد:**
   - يتأكد أن `main` لم يتغير. إن تغير، يرسل SHA الجديد ويعود إلى الخطوة 2.
   - يشغّل **Release Android app** على `main` (`workflow_dispatch`).
   - بعد نحو 15 دقيقة يتحقق من شيئين:
     - في سجل خطوة «Build, sign and verify the release APK» يظهر `Signer #1 certificate DN: CN=Amer AI Store, O=Amer AI Store, C=JO`.
     - مهمة `publish` حالتها **Waiting**. هذا يعني أن كل البوابات نجحت.
   - إن كانت `publish` **Skipped**، فإحدى البوابات فشلت، وأشهر الأسباب أن الـ SHA لا يطابق commit التشغيل.
   - يرسل للمالك رابط صفحة التشغيل.
4. **المالك:** يوافق **من متصفح Chrome، لا من تطبيق GitHub** (التطبيق لا يعرض زر الموافقة):
   1. يفتح رابط التشغيل في Chrome، بعد تسجيل الدخول بحساب `Amer-ai-store`.
   2. من ⋮ يفعّل **Desktop site** إن لم يظهر الزر.
   3. يضغط **Review deployments**، ثم يضع ✓ على `production`، ثم يضغط **Approve and deploy**.

   ⚠️ لا يضغط **Cancel workflow** أبدًا.
5. **المساعد:** يتحقق من ثلاثة أشياء، ثم يبلغ المالك بالرابط:
   - صدور الإصدار `v2.0.<رقم التشغيل>`.
   - وجود الملف `amer-store.apk` فيه.
   - أن رابط التحميل الدائم يعمل.

## أخطاء وقعت مرة، فلا تتكرر

- **صلاحية الرمز المؤقت:** في قائمة الصلاحيات ثلاثة أسطر متشابهة: «Codespaces secrets» و«Dependabot secrets» و«Secrets». المطلوب **Secrets** وحده. تصحيح الرمز من **Edit** لا يغيّر قيمته.
- **الموافقة على النشر:** تطبيق GitHub على الهاتف يعلق على «Loading steps» ولا يعرض الزر. الحل: Chrome مع Desktop site.
- **كلمة مرور النسخة الاحتياطية:** 16 حرفًا على الأقل، بأحرف إنجليزية وأرقام لتسهل كتابتها على الهاتف.
- **تغيّر `main` قبل النشر:** إن دُفع commit جديد قبل التشغيل، يتغير الـ SHA المطلوب، فحدّث `RELEASE_APPROVED_SHA` قبل التشغيل.
- **حذف الأسرار:** لا يحذف المالك أسرارًا بيده، خوفًا من حذف سر المفتاح بالخطأ. حذف `RELEASE_SETUP_TOKEN` يتم بالـ workflow `release-setup-cleanup.yml`.

## النسخة الاحتياطية للمفتاح

- **إنشاء نسخة جديدة:** شغّل **Release signing key backup** على `main`. ينتج ملف `luqta-signing-key-backup` يبقى يومًا واحدًا فقط، يُنزَّل من Chrome ويُحفظ في Google Drive.
- **فتح الملف:** بكلمة مرور `SIGNING_BACKUP_PASSWORD` التي اختارها المالك، مثلًا بتطبيق ZArchiver على Android. بداخله `upload-key.jks`، و`README.txt` فيه كلمات المرور وطريقة الاسترجاع.
- **إن ضاعت أسرار `SIGNING_*`:** لا تنشئ مفتاحًا جديدًا، لأن ذلك يمنع تحديث كل النسخ المثبتة. استرجع المفتاح من النسخة الاحتياطية بحسب `README.txt`.

## قواعد لكل مساعد

- تواصل مع المالك بالعربية، وبخطوات قصيرة مرقّمة تُنفَّذ من متصفح الهاتف، مع روابط مباشرة.
- لا تطلب كلمة مرور أو رمزًا أو مفتاحًا في المحادثة، ولا تطبع قيم الأسرار.
- اعتماد النسخة (`RELEASE_APPROVED_SHA`) والموافقة على `production` قرار المالك وحده. لا تتجاوزهما، ولا تغيّر شروط `publish` في `release.yml`.
- لا تشغّل `release-signing-setup.yml`، ولا تغيّر أسرار `SIGNING_*` أو تنسخها إلى مستودع آخر (انظر `AGENTS.md`).
- كل تغيير: فرع، ثم PR، ثم كل الفحوص خضراء (ومنها DCO مع `Signed-off-by`)، ثم الدمج، ثم التحقق الفعلي من النتيجة.
- في جلسات Claude Code السحابية قد تعرف أدوات GitHub هذا المستودع بالمالك `Mohammadzxzx1991` بدل `Amer-ai-store`. استعمل الاسم الذي تقبله الأدوات.

## نص جاهز للمحادثات خارج المستودع

المحادثات التي تفتح هذا المستودع (Claude Code وCodex) تقرأ `CLAUDE.md` و`AGENTS.md` تلقائيًا، وكلاهما يحيل إلى هذا الدليل. أما المحادثات العامة (مشروع في Claude، أو Custom Instructions في ChatGPT) فلا تقرأ المستودع وحدها، فالصق فيها هذا النص:

```text
لنشر تطبيق لُقطة (مستودع Amer-ai-store/Mohammad-Ahmed-Ghannam على GitHub) اتبع docs/release-runbook.md في المستودع:
ادمج في main بعد نجاح الفحوص، وأرسل لي SHA آخر commit مع رابط تعديل RELEASE_APPROVED_SHA،
ثم شغّل Release Android app على main، وتحقق أن التوقيع CN=Amer AI Store وأن publish ينتظر الموافقة،
ثم أرسل لي رابط التشغيل لأوافق من Chrome (Desktop site)، ثم تحقق من الإصدار ورابط التحميل.
لا تطلب مني أسرارًا في المحادثة، ولا تشغّل release-signing-setup.yml، ولا تغيّر أسرار SIGNING_*.
أنا أعمل من الهاتف فقط: خطوات قصيرة بالعربية وروابط مباشرة.
```
