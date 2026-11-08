import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Camera, CheckSquare, ImageUp, Square, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Robot } from "../components/Robot";
import { Button, Card, Notice, Row, Tabs, Txt } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useRobot } from "../lib/robot";
import { pickPhoto } from "../lib/photos";

// "اصنع شخصيتك": the photo stays on this device only (never uploaded) and becomes the 3D character's face.
export default function RobotCreate() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const robot = useRobot();
  const [step, setStep] = useState<"photo" | "preview" | "customize">("photo");
  const [consent, setConsent] = useState(robot.prefs.faceConsent);
  const [photo, setPhoto] = useState<string | null>(robot.face);
  const [error, setError] = useState("");
  async function choose(camera: boolean) {
    setError("");
    try { const image = await pickPhoto({ camera, width: 240, format: "jpeg" }); if (image) { setPhoto(image); setStep("preview"); } }
    catch (e) { setError(e instanceof Error && e.message === "permission" ? "اسمح بالوصول إلى الكاميرا أو الصور." : "تعذر اختيار الصورة"); }
  }
  async function confirm() {
    await robot.setFace(photo);
    await robot.update({ faceConsent: true }).catch(() => {});
    robot.react("hello", tr("صرت أشبهك! 😄"));
    setStep("customize");
  }
  async function remove() {
    setPhoto(null);
    await robot.setFace(null);
    await robot.update({ faceConsent: false }).catch(() => {});
    setConsent(false);
    setStep("photo");
  }
  return (
    <Shell title="اصنع شخصيتك" subtitle="ضع صورة وجهك على لُقطي — تبقى على جهازك فقط" back testID="robot-create">
      <Tabs testID="create-steps" value={step} onChange={(s) => { if (s === "photo" || photo) setStep(s); }} tabs={[{ id: "photo", label: "١ صورة" }, { id: "preview", label: "٢ معاينة" }, { id: "customize", label: "٣ تخصيص" }]} />
      <Card tone="soft" style={{ alignItems: "center", paddingVertical: 20, marginTop: 12 }}>
        <Robot size={180} motion={photo ? "wave" : "idle"} face={photo} mode="3d" bubble="top" message={photo ? tr("هذا أنا؟") : tr("خلّيني ألبس وجهك!")} />
      </Card>
      {error ? <Notice text={error} tone="danger" /> : null}
      {step === "photo" ? (
        <Card style={{ marginTop: 12, gap: 10 }}>
          <Pressable testID="face-consent" accessibilityRole="checkbox" aria-checked={consent} onPress={() => setConsent((v) => !v)} style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: 10 }}>
            {consent ? <CheckSquare size={22} color={t.primary} /> : <Square size={22} color={t.muted} />}
            <Txt style={{ flex: 1, lineHeight: 22 }}>{tr("أوافق على استخدام صورتي داخل التطبيق على هذا الجهاز فقط. لا تُرفع الصورة إلى الخادم، ويمكنني حذفها في أي وقت.")}</Txt>
          </Pressable>
          <Row>
            <Button title={tr("التقط صورة")} testID="face-camera" disabled={!consent} icon={<Camera size={16} color={t.onAccent} />} onPress={() => void choose(true)} style={{ flex: 1 }} />
            <Button title={tr("من المعرض")} testID="face-gallery" secondary disabled={!consent} icon={<ImageUp size={16} color={t.ink} />} onPress={() => void choose(false)} style={{ flex: 1 }} />
          </Row>
          <Button title={tr("تخطَّ")} testID="face-skip" secondary onPress={() => router.replace("/robot")} />
        </Card>
      ) : null}
      {step === "preview" ? (
        <Card style={{ marginTop: 12, gap: 10 }}>
          <Txt style={{ color: t.muted }}>{tr("هكذا سيبدو وجهك على لُقطي. أعجبك؟")}</Txt>
          <Row>
            <Button title={tr("اعتمد الصورة")} testID="face-confirm" disabled={!photo} onPress={() => void confirm()} style={{ flex: 1 }} />
            <Button title={tr("صورة أخرى")} secondary onPress={() => setStep("photo")} style={{ flex: 1 }} />
          </Row>
        </Card>
      ) : null}
      {step === "customize" ? (
        <Card style={{ marginTop: 12, gap: 10 }}>
          <Txt weight="bold">{tr("ممتاز! كمّل تخصيص لونه وملابسه وحركاته.")}</Txt>
          <Button title={tr("تخصيص الشخصية")} onPress={() => router.replace("/robot")} />
        </Card>
      ) : null}
      {robot.face || photo ? <Button title={tr("احذف صورتي")} testID="face-delete" tone="danger" icon={<Trash size={16} color={t.onAccent} />} onPress={() => void remove()} style={{ marginTop: 12 }} /> : null}
      <View style={{ height: 8 }} />
    </Shell>
  );
}
