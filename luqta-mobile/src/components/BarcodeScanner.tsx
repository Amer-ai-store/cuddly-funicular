import React, { useState } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ScanBarcode, X } from "lucide-react-native";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { Button, Field, Notice, Txt } from "./ui";

// Scans EAN/UPC/Code128/QR with the camera on phones; every platform can also type the number printed under the bars.
export function BarcodeScanner({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [locked, setLocked] = useState(false);
  const camera = Platform.OS !== "web";
  const submit = (code: string) => { const clean = code.trim(); if (!clean || locked) return; setLocked(true); onCode(clean); setTimeout(() => setLocked(false), 1500); };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: t.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 14 }} testID="barcode-sheet">
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10 }}>
            <ScanBarcode size={22} color={t.primary} />
            <Txt weight="extra" style={{ fontSize: 19, flex: 1 }}>{tr("امسح الباركود")}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={tr("إغلاق")} onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: t.secondary }}><X size={18} color={t.ink} /></Pressable>
          </View>
          {camera ? (
            permission?.granted ? (
              <View style={{ height: 240, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" }}>
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "qr"] }} onBarcodeScanned={({ data }) => submit(data)} />
                <View pointerEvents="none" style={{ position: "absolute", left: "12%", right: "12%", top: "40%", height: 2, backgroundColor: t.orange }} />
              </View>
            ) : <Button title={tr("السماح باستخدام الكاميرا")} onPress={() => { void requestPermission(); }} tone="primary" />
          ) : <Notice text="على الويب أدخل رقم الباركود المطبوع تحت الخطوط." />}
          <Field label="رقم الباركود" testID="barcode-input" value={manual} onChangeText={setManual} keyboardType="number-pad" onSubmitEditing={() => submit(manual)} placeholder="6250000000133" />
          <Button title={tr("ابحث بالباركود")} testID="barcode-submit" onPress={() => submit(manual)} disabled={!manual.trim()} />
        </View>
      </View>
    </Modal>
  );
}
