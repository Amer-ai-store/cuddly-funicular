# أمان بعد النقل إلى لوحة القيادة

واجهة المراقبة داخل قسم «مراقبة الخادم»: https://amer-ai-store.github.io/Mohammad-Ahmed-Ghannam/#jawafa-monitor

هذه الملفات مصدر برمجي بلا رموز أو سجلات حقيقية، ولا تحتاج اشتراك AppDeploy. GitHub Pages يستضيف الواجهة فقط، وتبقى السجلات في خدمة HTTPS خاصة على مضيف إدارة منفصل. المراقبة لم تبدأ بمجرد تنزيل الملفات.

## ربط الخدمة

1. جهّز `monitor_server.py` على مضيف إدارة موثوق. اضبط رمزين عشوائيين مختلفين بطول 32 محرفًا أو أكثر، أحدهما `AMAN_READ_TOKEN` للقراءة والآخر `AMAN_COLLECTOR_TOKEN` لاستقبال الأحداث. تُضبط القيم عبر مدير أسرار؛ لا تضعها في أمر أو مستودع أو رابط أو محادثة.
2. اضبط `AMAN_ALLOWED_ORIGIN=https://amer-ai-store.github.io`. أبق الخدمة على loopback الافتراضي، ووصلها عبر وكيل HTTPS خاص بشهادة موثوقة. قاعدة SQLite خارج مسار الويب والمستودع.
3. أدخل أصل API (أو بادئته دون `/api/events`) ورمز القراءة في قسم «ربط الخادم» باللوحة. يبقى الرمز في ذاكرة الصفحة ويمسح عند قطع الاتصال أو إعادة التحميل.
4. جامع `collector.py` لـLinux وSSH فقط. يحتاج Python3 وصلاحية قراءة السجل، ويستخدم رمز الجامع من البيئة ويرسل إلى الرابط الكامل `/api/ingest`. لا يشغّل أوامر من السجلات ولا يغيّر SSH أو الجدار الناري.

لا تفتح منفذًا واردًا على خادم Windows الإنتاجي ولا تغيّر عامله ذي الاتصال الصادر لتشغيل هذه النسخة. جامع Windows أو ربط حساب ChatGPT لم يُجهّزا.

## أوامر دون أي أسرار

```sh
python3 monitor_server.py --help
python3 collector.py --help
```

بعد ضبط متغيرات الخدمة والجامع بأمان، عدّل المسارات والنطاق فقط:

```sh
python3 monitor_server.py --db /PRIVATE/PATH/aman.sqlite3
python3 collector.py --endpoint https://YOUR-PRIVATE-API/api/ingest --source-id my-linux-server --spool /PRIVATE/PATH/spool.sqlite3
```

تعرض اللوحة أحدث 150 حدثًا خلال 7 أيام؛ ليست أرشيف تدقيق كاملًا. جامع SSH يحتفظ بطابور SQLite محلي ويعيد المحاولة دون تنفيذ السجلات. ابق السجلات الأصلية على مصادرها. البحث الجغرافي اختياري ويرسل IPv4 عامًا إلى ipapi.co فقط عند الضغط؛ المدينة تقريبية ولا تحدد المنزل أو الأصل خلف VPN.

الدليل التفصيلي والاختبارات: https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/tree/main/access-monitor-service
