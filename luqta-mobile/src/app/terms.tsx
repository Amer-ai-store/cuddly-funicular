import React from "react";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { BackPill, BrandHeader, Card } from "../components/design/kit";
import { useTheme } from "../lib/theme";

const sections = [
  ["الطلبات والأسعار", "يُعاد التحقق من السعر والكمية المتاحة في الفرع المختار عند تأكيد الطلب. إذا تغيّر السعر أو نفدت الكمية نعرض لك التغيير قبل التأكيد ولا ننشئ الطلب دون موافقتك."],
  ["الدفع", "الدفع عند الاستلام ورصيد المتجر متاحان. الدفع بالبطاقة غير مفعّل حتى ربط بوابة دفع مرخّصة، ولا تُحفظ بيانات البطاقات في التطبيق."],
  ["الإرجاع", "يمكن طلب الإرجاع بعد الاستلام وضمن مهلة الإرجاع المحددة في إعدادات المتجر، مع إرفاق صورة اختيارية."],
  ["الشخصية والصورة", "تُعالج صورتك على جهازك فقط لإنشاء الشخصية، ولا تُرسل إلى الخادم. يمكنك حذفها في أي وقت من الخصوصية والأجهزة."],
  ["الوضع التجريبي", "عند عدم ربط خادم المتجر تُعرض بيانات ومنتجات تجريبية، والطلبات فيه محاكاة على الجهاز فقط ولا تُشحن ولا تُحصّل."],
];
export default function Terms() {
  const { colors: t } = useTheme();
  return (
    <Shell header={<BrandHeader left={<BackPill />} />} title="الشروط والأحكام" subtitle="Amer AI Store | لُقطة">
      {sections.map(([h, b]) => (
        <Card key={h} style={{ marginBottom: 10 }}>
          <Txt weight="bold" style={{ color: t.title, fontSize: 18 }}>{h}</Txt>
          <Txt style={{ color: t.muted, lineHeight: 25, marginTop: 4 }}>{b}</Txt>
        </Card>
      ))}
    </Shell>
  );
}
