// Picks an image from the device and returns it as a data URL (≤ 2 MB) for upload
// to the store's own server (returns / support). Nothing is sent to third parties.
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

export type PickedImage = { uri: string; dataUrl: string; name: string };
export async function pickImageDataUrl(maxBytes = 2_000_000): Promise<PickedImage | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  if (a.size && a.size > maxBytes) throw new Error("الصورة أكبر من 2 ميغابايت؛ اختر صورة أصغر.");
  const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
  if (base64.length > maxBytes * 1.4) throw new Error("الصورة أكبر من 2 ميغابايت؛ اختر صورة أصغر.");
  const mime = a.mimeType && /^image\/(jpeg|png|webp)$/.test(a.mimeType) ? a.mimeType : "image/jpeg";
  return { uri: a.uri, dataUrl: `data:${mime};base64,${base64}`, name: a.name };
}
