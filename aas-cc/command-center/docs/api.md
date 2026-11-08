# عقد API — AAS-CC 2.0

الأساس هو `/api/v1`. جميع مسارات API، بما فيها `health`، تتطلب مصادقة. أجسام الكتابة بصيغة `application/json` وبحد أقصى 2 MiB. التواريخ الصادرة بصيغة ISO 8601 وUTC، والأخطاء بالشكل `{ "error": { "code": "…", "message": "…" } }`.

## المصادقة

- **متصفح الموقع الخاص:** يمرر Sites هوية ChatGPT الموثوقة إلى Worker. الطلبات الكتابية من أصل آخر مرفوضة. لا تستبدل هذه الهوية برأس يصنعه عميل خارجي.
- **تطبيق Android أو خدمة:** `X-AAS-API-Key` يطابق سر البيئة `AAS_API_TOKEN`. الوصول إلى الموقع المنشور الخاص يحتاج أيضًا `OAI-Sites-Authorization` صادرًا من Sites. لا يكفي أحد الرمزين لعبور البوابة والتحقق من صلاحية التطبيق معًا.
- **`app/sync`:** مصادقة الخدمة مطلوبة تحديدًا؛ هوية صاحب لوحة المتصفح لا تتيح صناعة لقطة تطبيق.
- **منفّذ الكود:** `X-AAS-Runner-Key` يطابق `AAS_RUNNER_TOKEN` المستقل، مع وصول Sites الخاص. صلاحياته محصورة بمسارات `runner/health` و`runner/context` و`runner/receipts` و`runner/advance`؛ لا يقرأ حالة المؤسسة أو بيانات المتجر.

لا تُكتب قيم الرموز في المصدر أو أمثلة التوثيق أو تخزين المتصفح. يمكن تنزيل ملف اتصال مخصص للمالك من مسار محمي كما هو موضح أدناه. تطبيق Android يهيئه المالك وقت التشغيل ويحفظه مشفرًا. لم تُضف أدوار تطبيقية أو عزل متعدد المؤسسات؛ الحالة مشتركة لمؤسسة واحدة.

## القراءة وإصدار الحالة

| الطلب | الاستجابة |
| --- | --- |
| `GET /health` | `status: "ok"`, `storage: "D1"`, `version`, `revision`, `checkedAt`, `automaticExecution: false`. |
| `GET /state` | `{ state, revision, updatedAt, connection, server }` مع `ETag` مثل `"7"`. |
| `GET /tasks`, `/workspaces`, `/agents`, `/approvals`, `/activity`, `/servers`, `/settings` | `{ data, revision }`. |
| `GET /tasks/:id`، ونظائره للموارد ذات القوائم | `{ data, revision }`، أو `404` عند غياب السجل. |

## التنسيق والمستشار وقاعدة البيانات

`GET /coordination` يعيد هيكل الوكلاء، والطوابير، والعلاقات، وحجوزات الموارد، والتوصيات المشتقة من الحالة مع مراجعتها. بيانات المهمة تقبل `dependencies` و`resourceKeys`؛ يرفض الخادم الدورات والبدء على مورد تستعمله مهمة أخرى، وتستمر المسارات غير المتعارضة.

مسارات `assistant` و`database` تتطلب جلسة المالك، ولا يكفي مفتاح تطبيق Android. `GET /assistant/capabilities` يعيد تهيئة المزوّد دون المفتاح، و`POST /assistant/provider` يتحقق من نموذج Gemini بطلب قراءة ثم يحفظ المفتاح مشفرًا على الخادم. `POST /assistant/chat` يعيد استشارة ومقترحات محددة؛ عند غياب المزوّد يعيد `503` مع توصيات محلية موسومة بوضوح. `GET /assistant/history` يعيد سجلًا محدودًا منقّى. اعتماد مقترح عبر `POST /assistant/apply` يحتاج `proposalId` و`expectedRevision`؛ تحفظ عملية D1 واحدة التعديل وإيصاله، وتمنع الإعادة عند الضغط المتكرر أو التعارض.

`GET /assistant/provider/health` يقرأ نتيجة آخر فحص توليد، دون استدعاء المزوّد. `POST /assistant/provider/test` بجسم `{}` يرسل طلب JSON قصيرًا واحدًا باستخدام الإعداد المحفوظ؛ يُرفض تمرير مفتاح أو رسالة في هذا المسار. يعاد `{providerHealth:{configured,model,status,checkedAt,latencyMs,error}}` مع حالة HTTP الفعلية. الفحص محصور بالمالك، ولا يعيد نص المزوّد أو يكتب مهامًا أو محادثة. الطلب المتكرر خلال 30 ثانية يُرفض قبل التوليد. تغيير الاعتماد أو النموذج يبطل نجاح الإعداد السابق، والنجاح الذي مضى عليه يوم يُعرض قديمًا.

يطلب المساعد JSON من المزوّد عبر `generationConfig.responseMimeType`؛ لا يضيف هذا خيارًا عامًا إلى مدخلات `/ai/generate`. الرد الاستشاري بلا `proposals` يعامل كقائمة فارغة؛ المقترحات الموجودة تبقى خاضعة للتحقق الكامل. تظل نتيجة الفشل موسومة `local-advisor` دون مقترحات تنفيذية، وتصل رسالتها المنقّاة إلى الواجهة والسجل: `429 provider_quota_exceeded` للحصة أو المعدل، و`502 provider_access_denied` لرفض الصلاحية، و`502 provider_model_unavailable` لعدم توفر النموذج، و`502 provider_request_invalid` لرفض إعدادات الطلب، و`502 assistant_invalid_response` لصيغة محادثة غير صالحة. لا يعاد نص خطأ المزوّد الخام. تبقى المهلة `504 provider_timeout`، والمقترحات غير المقبولة `502 assistant_invalid_proposal`.

`POST /assistant/provider/models` يستقبل `{apiKey}` أو `{useSavedKey:true}` من المالك فقط، ويقرأ قائمة Google الفعلية بحد خمس صفحات ومهلة إجمالية عشر ثوانٍ. يعيد `{discoveryId, expiresAt, models:[{id,label}], truncated, activeConfigurationChanged:false}`؛ لا يعيد المفتاح أو بياناته المشفرة. تُحفظ مسودة مشفرة واحدة لمدة صلاحية عشر دقائق مستقلة عن الإعداد النشط. قد تكون القائمة جزئية عند `truncated:true`. للحفظ أرسل إلى `POST /assistant/provider` الحقول `{discoveryId,model}`؛ يُرفض اختيار لم يظهر في القائمة أو جلسة منتهية/مستبدلة، ويُعاد فحص النموذج قبل اعتماد الإعداد. يبقى `{apiKey,model}` مدعومًا للتوافق. لا يستدعي هذا الربط توليدًا ولا يثبت حصة استخدام متاحة.


`GET /database` و`POST /database/bridges` و`POST /database/operations` تعرض الوصلات وتنشئها وتطلب عمليات صف محددة. إنشاء عملية يعني انتظار التنفيذ المحلي؛ لا يعلن تغيير القاعدة. مسارات الجسر `GET /bridge/context` و`POST /bridge/snapshot` و`POST /bridge/receipts` تتطلب مفتاح المنفّذ المخصص وتعيد نطاق الوصلة فقط. النسخ والكتابة وإزالة تكرار العمليات تجري داخل محوّل SQLite المحلي. تُحفظ اللقطات والطوابير والمحادثات في `aas_control_records` مستقلًا عن مراجعة مهام المؤسسة.

## بوابات تنفيذ الكود

`GET /workflows` يعرض الخطط المحفوظة. العمليات العامة عبر `POST /actions` هي `startWorkflow` و`addWorkflowStep` و`recordWorkflowAnalysis` و`recordWorkflowChange` و`recordWorkflowVerification` و`advanceWorkflow`، مع `expectedRevision`. التوثيق المرسل من هذه العمليات يدوي دائمًا؛ لا يقبل الخادم انتحال مصدر تحليل آلي أو إيصال منفّذ.

`POST /workflows/:id/analyze` مع `expectedRevision` يقرأ الرأس المرصود على GitHub ويحلل أرشيف SHA المطابق. يشمل جميع ملفات النص المؤهلة ضمن الحدود، ويستبعد الأصول الثنائية والمولدة والأقفال وملفات بيانات الدخول. يسجّل نجاح اكتمال التحليل أو توقفه فعليًا؛ لا ينفذ اختبارات أو تعديلات.

`GET /execution/capabilities` يوضح تهيئة استقبال الإيصالات وعنوان الخادم المحلي للعرض فقط. وجود مفتاح الاستقبال لا يثبت تشغيل منفّذ خارجي. `POST /runner/connection-config` يتطلب جلسة المالك، ويعيد ملف JSON سريًا غير قابل للتخزين المؤقت؛ مفتاح التطبيق وحده لا يتيح تنزيله.

المنفّذ يقرأ `GET /runner/context?workflowId=...` ثم يرسل إيصال كل مرحلة إلى `POST /runner/receipts` مع `{expectedRevision,receipt}`. يلزم `stepRevision` و`runnerId` و`receiptId` فريد. يرفض الخادم الإيصالات المعادة أو القديمة، وتعود الردود بحالة المسار المحدد فقط. `POST /runner/advance` يشترط إيصال تحقق ناجحًا للمنفّذ نفسه على مراجعة المصدر الحالية. أي فحص فاشل أو عائق يمنع الانتقال. لا تُعاد محاولات الكتابة تلقائيًا عند التعارض.
| `GET /github` | لقطة GitHub الفعلية أو آخر لقطة محفوظة، مع `cached`, `stale`, `nextRefreshAt` وخطأ آمن عند تعذر التحديث. |

`state` يحمل `schemaVersion: 2` و`demoMode: false` وكيانات العمل و`commerce`. `server.automaticExecution` يظل `false`: مسار التوليد عند الطلب موضح أدناه، ولا يوجد عامل تشغيل مستقل للوكلاء. `GET /state` مع `If-None-Match` مطابق لـETag يعيد `304` بدون جسم، وهو ما تستخدمه الواجهة كل ثلاث ثوانٍ.

## قواعد الكتابة

كل كتابة في سجلات العمل، بما فيها الحذف وفحص خادم، تحتاج `expectedRevision` في JSON أو رأس `If-Match: "7"` من آخر قراءة. مسارات القراءة المخبأة وملف الاتصال والتوليد ولقطة التطبيق موضحة على حدة ولا تستخدم هذا الإصدار. إذا سبق طلب آخر وعدّل الحالة، يرجع `409 revision_conflict` ومعه أحدث envelope. حدّث الحالة وراجع التغيير قبل إرساله مجددًا؛ لا يُعاد إرسال التعديل المتعارض تلقائيًا. عند غياب الإصدار يرجع `428 revision_required`.

الاستجابة الناجحة `200` وتحمل `{ state, revision, updatedAt, connection, server, result }` وETag الجديد. تنشأ المعرفات والتوقيتات في الخادم. حالات المهام `queued` و`running` و`review` و`done` هي حالات تنظيم عمل؛ لا تثبت تنفيذ وكيل.

### مسارات الموارد

| الطلب | جسم JSON إضافةً إلى `expectedRevision` |
| --- | --- |
| `POST /workspaces` | `name`, `description?`, `agentIds?`, `status?` (`active` أو `paused`), `color?`. |
| `PATCH /workspaces/:id` | `{ "patch": { … } }` للحقول السابقة. |
| `DELETE /workspaces/:id` | الإصدار فقط؛ تُرفض المساحة ذات المهام. |
| `POST /workspaces/:id/notes` | `{ "body": "نص الملاحظة" }`. |
| `POST /tasks` | `title`, `workspaceId`, `agentId`, `description?`, `priority?` (`high` أو `medium` أو `low`), `status?`. |
| `PATCH /tasks/:id` | `{ "patch": { … } }` للحقول السابقة؛ لا تُعدل مهمة ذات موافقة معلقة. |
| `DELETE /tasks/:id` | الإصدار فقط؛ لا تُحذف مهمة ذات موافقة معلقة. |
| `PATCH /agents/:id` | `{ "patch": { "name"?, "role"?, "description"?, "status"? } }`؛ الحالة `ready` أو `paused`. |
| `POST /approvals/:id/decision` | `{ "decision": "approved" }` أو `rejected`؛ القرار يُحسم مرة واحدة. |
| `PATCH /settings` | `storeName?`, `ownerName?`, `timezone?`, `language?` (`ar` أو `en`), `notifications?`, `reviewHighImpact?`. |
| `POST /servers` | `name`, `baseUrl`, `apiPrefix?`, `healthPath?`, `enabled?`, `tokenEnv?`. |
| `PATCH /servers/:id` | `{ "patch": { … } }` للحقول السابقة؛ يعيد الاتصال إلى `unverified`. |
| `DELETE /servers/:id` | الإصدار فقط. |
| `POST /servers/:id/check` | الإصدار فقط؛ يحتاج أصلًا في `AAS_ALLOWED_SERVER_ORIGINS` ومتغير السر المسمى إن وجد. |

المساحة والمهمة تحتاجان إلى ارتباطات صحيحة: الوكيل المسؤول ضمن فريق المساحة. `review` ينشئ طلب موافقة؛ الموافقة تعيد المهمة إلى `queued` والرفض يبقيها `review`. القرار لا ينفّذ عملًا خارجيًا.

### مسار الإجراءات الموحد

`POST /actions` بديل لمسارات الموارد. جسمه:

```json
{
  "expectedRevision": 7,
  "operation": "addTask",
  "payload": {
    "title": "مراجعة وصف المنتج",
    "workspaceId": "ws-commerce",
    "agentId": "agent-catalog",
    "priority": "medium",
    "status": "queued"
  }
}
```

العمليات المتاحة: `addTask`, `updateTask`, `deleteTask`, `addWorkspace`, `updateWorkspace`, `deleteWorkspace`, `addNote`, `resolveApproval`, `updateAgent`, `updateSettings`, `addServer`, `updateServer`, `deleteServer`, `importData`, `reset`. التحديث يستخدم payload بالشكل `{ "id": "…", "patch": { … } }`؛ الحذف `{ "id": "…" }`؛ الملاحظة `{ "workspaceId": "…", "body": "…" }`؛ القرار `{ "id": "…", "decision": "approved" }`.

`recordAppSnapshot` و`recordServerHealth` غير متاحتين عبر `/actions`. نتائج المزامنة وفحص الصحة تُنشأ في مساريهما الخادميين.

### الاستيراد وإعادة الضبط

`POST /import/validate` يقبل `{ "data": { …state… } }` أو `data` كنص JSON، بدون إصدار لأنه لا يكتب. يعيد `{ "valid": true, "summary": { "tasks": 0, "workspaces": 4 } }` عند النجاح. يلزم مخطط النسخة الحية؛ ملفات العرض القديمة مرفوضة.

لتطبيق الاستيراد، استخدم `/actions` مع `operation: "importData"`, وpayload `{ "data": { … } }`, والإصدار الحالي. يحتفظ الخادم بسجل نشاطه السابق ولقطة التطبيق المستلمة، ويعيد اتصالات الخوادم إلى `unverified`. `reset` يعيد ملفات الوكلاء والمساحات والإعدادات الأولية ويمسح العمل والملاحظات والموافقات؛ يحتفظ بسجل الخوادم والنشاط وبيانات التطبيق. الاستيراد وإعادة الضبط يؤثران في الحالة المشتركة.

مساعد ترحيل المتصفح يقرأ نسخة `schemaVersion: 1` من المفتاح القديم فقط، ويحوّل العمل اليدوي إلى حالة حية قبل استدعاء التحقق ثم `importData` لمشروع جديد في المراجعة `0`. هذا لا يجعل ملفات العرض القديمة مقبولة مباشرةً في API. يبقى الأصل المحلي محفوظًا، ولا يعاد إرسال تعارض المراجعة تلقائيًا.

## متابعة مستودع GitHub

المستودع المعتمد ثابت في الخادم: `Amer-ai-store/Mohammad-Ahmed-Ghannam`. لا يقبل المسار عنوان GitHub عشوائيًا من المتصفح، ولا يكتب إلى المستودع أو يشغل Actions.

`GET /github` يقرأ لقطة من `aas_repository_cache` في D1 إذا كانت صالحة لخمس دقائق، ويجلبها من GitHub عند انتهائها. `POST /github/refresh` مع جسم JSON فارغ `{}` يطلب تحديثًا يدويًا. كلاهما يتطلب مصادقة API المعتادة. لا يحتاج التحديث `expectedRevision` ولا يغير مراجعة سجلات العمل.

الاستجابة بالشكل:

```json
{
  "repository": {
    "fullName": "Amer-ai-store/Mohammad-Ahmed-Ghannam",
    "htmlUrl": "https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam",
    "defaultBranch": "main",
    "head": { "sha": "…", "htmlUrl": "…", "message": "…", "authorName": "…", "committedAt": "…" },
    "commits": [],
    "branches": [],
    "workflowRuns": [],
    "workflowAccess": "available",
    "checkedAt": "…",
    "source": "github-api"
  },
  "cached": false,
  "stale": false,
  "nextRefreshAt": "…"
}
```

اللقطة تتضمن أيضًا `description`, `private`, `createdAt`, `updatedAt`, `pushedAt`. الحد المعروض ستة التزامات حديثة، وعشرون فرعًا، وخمسة تشغيلات Actions؛ أطوال القوائم ليست بالضرورة إجمالي المستودع. كل تشغيل يحمل `id`, `name`, `status`, `conclusion`, `htmlUrl`, `headSha`, `createdAt`, `updatedAt`. `head` آخر التزام أعاده API للفرع الافتراضي، أو `null` إذا لم يوجد.

الحد الأدنى بين محاولات GitHub دقيقة واحدة، بما فيها التحديث اليدوي؛ الطلب المبكر يرجع الحالة المحفوظة و`nextRefreshAt` بدل إنشاء جلب متكرر. فشل التحديث مع وجود لقطة سابقة يعيد `200` و`stale: true` و`error` مع الاحتفاظ بها. عند غياب أي لقطة تكون `repository: null` والحالة `503`. عند حد طلبات GitHub، يظهر `github_rate_limited` و`retryAt` إن توفر، ويؤجل الجلب إلى ذلك الوقت. فشل قراءة Actions وحدها يبقي المصدر والفروع ظاهرين، ويضبط `workflowAccess: "unavailable"` و`partialErrors`؛ لا يمثل نجاح بناء أو فشله.

تستخدم القراءة `https://api.github.com` فقط، بمهلة عشر ثوانٍ وحد استجابة 512 KiB لكل رد، ولا تتبع إعادة التوجيه. المستودع العام قابل للقراءة دون رمز؛ `GITHUB_TOKEN` اختياري في بيئة Worker فقط لزيادة حدود القراءة أو الوصول المسموح. لا يظهر الرمز في الرد أو نسخ الحالة أو المصدر. `workflowRuns: []` مع `workflowAccess: "available"` يعني أن API لم يعد تشغيلات؛ لا يعد نتيجة بناء ناجحة.

## مزامنة تطبيق Android

### ملف اتصال المالك

`POST /app/connection-config` مع جسم JSON فارغ `{}` متاح لهوية المتصفح في الموقع الخاص فقط، ويُرفض عند استخدام مصادقة الخدمة وحدها. ينزّل `aas-app-connection.json` الذي يحتوي `baseUrl`, `apiToken`, `siteAccessToken`, `automaticSync: false` من إعدادات Worker `AAS_PUBLIC_ORIGIN`, `AAS_API_TOKEN`, `AAS_PRIVATE_SITE_BEARER`. قيم الملف حساسة؛ لا تُطبع أو تُدرج في مستودع أو تُشارك. الاستيراد إلى Android لا يرسل لقطة أو يختبر شبكة قبل إجراء المالك، والحفظ على الجهاز مشفر. لا يستهلك هذا المسار إصدار الحالة لأنه لا يعدل سجلات العمل. الإعدادات الناقصة تعيد `503 connection_config_missing`.

### لقطة التطبيق

`POST /app/sync` يتطلب مصادقة الخدمة ويقبل لقطة كاملة. لا يحتاج `expectedRevision`؛ الخادم يكرر مقارنة الإصدار داخليًا حتى ثلاث محاولات.

```json
{
  "deviceId": "android-owner-01",
  "appVersion": "1.0",
  "products": [{
    "id": 1,
    "name": "منتج الاختبار",
    "category": "عام",
    "retailPrice": 25,
    "wholesalePrice": 20,
    "imageUrl": "",
    "stockQuantity": 3,
    "merchantName": "Amer AI Store"
  }],
  "orders": [{
    "id": 1,
    "productId": 1,
    "productName": "منتج الاختبار",
    "quantity": 1,
    "totalPrice": 25,
    "status": "pending",
    "createdAt": 1791763200000
  }]
}
```

الاستجابة `{ "revision": 8, "receivedAt": "…", "productsAccepted": 1, "ordersAccepted": 1 }`. `receivedAt` من الخادم. حد القائمتين 1000 سجل لكل منهما، والمعرفات فريدة والأسعار غير سالبة وروابط الصور HTTPS أو فارغة. تاريخ الطلب يقبل milliseconds أو ISO. تجرد الحقول الإضافية، بما فيها بيانات العملاء أو الدفع، قبل الحفظ.

تحل اللقطة محل السابقة، وهي بيانات يُبلغ عنها التطبيق وليست إثبات مبيعات أو دفعات. تعرض الواجهة حالتها ووقت الاستلام تحت «بيانات التطبيق». لا يستطيع المستخدم صناعة وقت استلام عبر استيراد نسخة أو تعديل إداري.

## توليد النص وتحليل الصور

`POST /ai/generate` يتطلب مصادقة مالك الموقع أو الخدمة، ولا يحتاج `expectedRevision`. الجسم هو `{ "prompt": "…", "model": "…" }`، مع `model` اختياري عند وجود موديل افتراضي في الخادم. حد `prompt` هو 12000 حرف. لتحليل صورة يمكن إضافة `imageBase64` و`mimeType` (`image/jpeg` أو `image/png` أو `image/webp`) بحد 512 KiB لنص Base64 المشفر. الحقول والخيارات الأخرى مرفوضة.

الاستجابة الناجحة `{ "content": "…", "model": "…" }`. المزود هو محول Gemini خادمي؛ مفتاح `GEMINI_API_KEY` يبقى في Worker، ويحدد `GEMINI_MODEL` أو مصفوفة JSON في `GEMINI_ALLOWED_MODELS` الموديلات المسموحة. عند وجود القائمة دون موديل افتراضي، يلزم إرسال `model` منها. عند غياب المفتاح أو إعداد الموديلات يرجع `503 provider_not_configured` دون إرسال طلب أو نتيجة افتراضية. مهلة المزود 20 ثانية، وإخفاقه أو رد غير مكتمل يعيد `502`، وتجاوز الحصة أو المعدل يعيد `429`، وانتهاء المهلة `504`. لا يدعم هذا المسار تنفيذ أدوات متجر أو بحث/خرائط خارجية أو تشغيل وكلاء مستقلين.

## توافق API المنتجات

| الطلب | السلوك |
| --- | --- |
| `GET /products/search?q=…` | قائمة منتجات من الكتالوج المتزامن فقط: `id`, `name`, `category`, `price`, `wholesalePrice`, `retailer`, `imageUrl`, `description`. |
| `GET /products/:id/compare` | سعر المنتج المسجل فقط، مع `source: "app_catalog"` و`externalComparison: false`. لا توجد عروض منافسين؛ `404` إذا لم يصل المنتج. |
| `GET /radar/compare-links` | `503 integration_not_configured`. |
| `GET /social/viral-mentions` | `503 integration_not_configured`. |

## حالات HTTP

| الحالة | المعنى |
| --- | --- |
| `200` / `304` | نجاح أو حالة لم تتغير. |
| `400` | JSON غير صالح أو عملية إدارية غير متاحة. |
| `401` | مصادقة مفقودة، أو `app/sync` بدون سر خدمة صحيح. |
| `403` | كتابة من أصل آخر أو أصل فحص خادم غير مسموح. |
| `404` / `405` | سجل أو مسار غير موجود، أو طريقة طلب غير مدعومة. |
| `409` | تعارض إصدار أو تعطيل خادم أو تنافس مزامنة. |
| `413` / `415` | طلب أكبر من 2 MiB أو Content-Type غير JSON. |
| `422` | فشل التحقق من الكيانات والحقول والارتباطات. |
| `428` | غياب الإصدار المتوقع في كتابة إدارية. |
| `503` | قاعدة بيانات أو متغير سر أو مزود خارجي غير مهيّأ، أو فشل قاعدة البيانات. |
| `502` / `504` | فشل مزود الذكاء الاصطناعي أو رد غير مكتمل، أو انتهاء مهلته. |

فشل طلب HTTP إلى خادم مسموح يُحفظ كحالة خادم `offline` ضمن استجابة `200` للفحص المكتمل؛ رفض السياسة أو غياب السر يعيدان الخطأ قبل الفحص دون تحديث الحالة. المهلة ثماني ثوانٍ ولا تتبع إعادة التوجيه.
