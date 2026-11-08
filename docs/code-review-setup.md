# بوابات مراجعة PR المجانية — دون رصيد API

## البديل المنفذ
استُبدلت مراجعة Claude الآلية التي تتطلب رصيد Anthropic بأدوات محلية مجانية على GitHub Actions.
لا تُستخدم أسرار Anthropic ولا تُرسل الشيفرة إلى مزود LLM، ولا يُدّعى أن هذا المسار مراجعة AI أو تدقيق أمني مستقل.

- `.github/workflows/free-pr-review.yml` (الموجود على `main` منذ PR #131 وما بعده):
  يفحص فرق الملفات، `git diff --check`، وأنماط إدراج مفاتيح أو أسرار في الأسطر الجديدة.
- `.github/workflows/claude.yml` (النسخة المجانية من `main`):
  لم تعد تشغّل Claude؛ تنفّذ اختبارات جسر جوافة ولوحة التنقل وتكاملها للطلبات الجديدة.
- `.github/workflows/free-quality-security-gate.yml`: بوابة إضافية مستندة إلى الشيفرة المفتوحة؛
  مهمة `quality` تشغّل `npm ci` وTypeScript وESLint و`npm test` واختبارات لوحة القيادة،
  ومهمة `security` تشغّل Semgrep Community Edition بالإصدار `1.182.0` مع `--error` وتُرفق JSON.
  النتيجة `free-pr-gate` تفشل إذا فشلت أو تخطت أي من المهمتين، ولا تستخدم مفتاح API.
- فحوص مستقلة باقية: CodeQL (الإعداد الافتراضي)،
  `Open-source security scan / Semgrep source security`، وLuqta `e2e` و`test`، وDCO.

## المتطلبات قبل الدمج
1. يجب نجاح `free-pr-gate` و`Free PR diff and secret safety review` واختبارات `test` و`e2e` وفحوص الأمان ذات الصلة على **نفس رأس الفرع**.
2. إن كانت Branch protection أو Rulesets تتطلب `Claude code review / review` القديمة، غيّر
   **اسم الفحص المطلوب** إلى `free-pr-gate` وأبقِ بقية شروط الحماية. لا تعطل الحماية أو تسجل `skipped` باعتباره `success`.
   يمكن ضبطها من Settings → Rules → Rulesets / Branch protection، عند امتلاك صلاحية الإدارة المناسبة.
3. حل تعارضات الفروع وفحص DCO؛ لا يجوز إضافة توقيع مشاركة نيابة عن مؤلف آخر.
4. لا تدمج إذا بقي فحص إلزامي فاشلاً أو معلّقاً. حافظ على المراجعة البشرية/الأمنية المستقلة عندما تشترطها سياسة المشروع.
5. لا يُفسّر الدمج كموافقة على النشر: Issue #102، GATE-15 وHTTPS وقبول أمن الإنتاج مستقلة،
   ولا يوجد أي إذن لتعديل `Jawafa_DB` أو السجلات المحاسبية الأصلية.

## التكلفة وحدود التحقق
GitHub Actions على المشغلات القياسية مجاني للمستودعات العامة، وCodeQL متاح للمشاريع العامة،
وSemgrep Community Edition مجاني. لا حاجة إلى `ANTHROPIC_API_KEY` أو `CLAUDE_CODE_OAUTH_TOKEN`.
هذه الأدوات تكشف فئات من المخاطر وتفشل إذا تعذر تنفيذ الفحص؛ لكنها لا تضمن خلو البرنامج من الثغرات،
ولا تتكفل بإغلاق Findings أو مراجعة التغييرات المعمارية مثل نموذج الصلاحيات.

الفشل التاريخي لمراجعة Claude: [run #41671772130](https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/actions/runs/41671772130)
ناتج عن `Credit balance is too low`، وليس دليلاً على خطأ الشيفرة.
أُزيل `.github/workflows/claude-code-review.yml` المدفوع التلقائي من هذا الفرع.
تم الحفاظ على `main` ومراجعته المجانية دون إدخال اعتماد مدفوع جديد.

## الأدلة
احتفظ بمعرّف تشغيل Actions وSHA ونتائج كل مهمة ورابط الأثر، وميّز الفحص الحتمي عن المراجعة البشرية.
لا تعلن `MERGED` أو `DEPLOYED` إلا بعد القراءة المباشرة للحالة الفعلية: **NO EVIDENCE = NO DONE**.
