import React, { useState } from "react";
import { Platform, View } from "react-native";
import * as Location from "expo-location";
import { LocateFixed, MapPin } from "lucide-react-native";
import DeliveryMap from "./DeliveryMap";
import { Button, Chip, Field, Notice, Row, Txt } from "./ui";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import type { Address } from "../lib/commerce-types";

export type AddressDraft = { label: string; name: string; phone: string; city: string; district: string; street: string; building: string; details: string; latitude?: number; longitude?: number; isDefault: boolean };
export const emptyAddress: AddressDraft = { label: "البيت", name: "", phone: "", city: "", district: "", street: "", building: "", details: "", isDefault: false };
export const draftFrom = (a: Partial<Address>): AddressDraft => ({ ...emptyAddress, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== null)) } as AddressDraft);
export function addressPayload(a: AddressDraft) {
  return { label: a.label || undefined, name: a.name.trim(), phone: a.phone.trim(), city: a.city.trim(), street: a.street.trim(), district: a.district.trim() || undefined, building: a.building.trim() || undefined, details: a.details.trim() || undefined, latitude: a.latitude, longitude: a.longitude, isDefault: a.isDefault };
}
export const addressProblem = (a: AddressDraft) => a.name.trim().length < 2 || a.city.trim().length < 2 || a.street.trim().length < 4 || a.phone.replace(/\D/g, "").length < 8 ? "أكمل اسم المستلم ورقم هاتف صالح والمدينة والشارع." : "";

// The address step of the "وين نوصلك؟" mockup: current location with a map pin, nearest branch, and the address fields.
export function AddressForm({ value, onChange }: { value: AddressDraft; onChange: (next: AddressDraft) => void }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { setBranch } = useStore();
  const { configured } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const set = (key: keyof AddressDraft, v: string | boolean) => onChange({ ...value, [key]: v });
  async function locate() {
    setBusy(true); setNote("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("لم تمنح إذن الموقع. يمكنك كتابة العنوان يدويًا.");
      const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { ...value, latitude: point.coords.latitude, longitude: point.coords.longitude };
      if (Platform.OS !== "web") {
        const [place] = await Location.reverseGeocodeAsync(point.coords).catch(() => []);
        if (place) Object.assign(next, { city: place.city || place.region || next.city, district: place.district || place.subregion || next.district, street: [place.street, place.streetNumber].filter(Boolean).join(" ") || next.street });
      }
      onChange(next);
      if (configured) {
        const nearest = await api.get<{ nearest: { id: string; name: string; distanceKm: number } | null }>(`/delivery/nearest?lat=${next.latitude}&lng=${next.longitude}`).catch(() => null);
        if (nearest?.nearest) { setBranch(nearest.nearest.id); setNote(tr("أقرب فرع لك: {b} ({d} كم) — اخترناه لك", { b: nearest.nearest.name, d: nearest.nearest.distanceKm })); }
      }
    } catch (error) { setNote(error instanceof Error ? error.message : "تعذّر تحديد الموقع"); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Button title={tr("استخدم موقعي")} testID="use-location" busy={busy} tone="primary" icon={<LocateFixed size={18} color={t.onPrimary} />} onPress={() => void locate()} />
      {note ? <Notice text={note} tone="success" /> : null}
      {value.latitude !== undefined && value.longitude !== undefined ? (
        <View testID="map-pin">
          <DeliveryMap destination={{ latitude: value.latitude, longitude: value.longitude }} height={180} />
          <Row style={{ marginTop: 6 }}><MapPin size={14} color={t.orange} /><Txt style={{ fontSize: 12, color: t.muted }}>{value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}</Txt></Row>
        </View>
      ) : null}
      <Row wrap>{["البيت", "العمل", "أهلي"].map((l) => <Chip key={l} label={l} active={value.label === l} onPress={() => set("label", l)} />)}</Row>
      <Field label="اسم المستلم" testID="address-name" value={value.name} onChangeText={(v) => set("name", v)} />
      <Field label="رقم الهاتف" testID="address-phone" value={value.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" placeholder="+9627XXXXXXXX" />
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}><Field label="المدينة" testID="address-city" value={value.city} onChangeText={(v) => set("city", v)} placeholder={tr("عمّان")} /></View>
        <View style={{ flex: 1 }}><Field label="الحي" testID="address-district" value={value.district} onChangeText={(v) => set("district", v)} /></View>
      </Row>
      <Field label="الشارع" testID="address-street" value={value.street} onChangeText={(v) => set("street", v)} />
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}><Field label="رقم المبنى" testID="address-building" value={value.building} onChangeText={(v) => set("building", v)} /></View>
        <View style={{ flex: 2 }}><Field label="تفاصيل إضافية" testID="address-details" value={value.details} onChangeText={(v) => set("details", v)} placeholder={tr("الطابق، علامة مميزة…")} /></View>
      </Row>
    </View>
  );
}
