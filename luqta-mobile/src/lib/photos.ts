import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

// Picks or takes a photo and returns a small data URI, so uploads stay light and the server never receives full photos.
export async function pickPhoto({ camera = false, width = 96, format = "png" }: { camera?: boolean; width?: number; format?: "png" | "jpeg" } = {}): Promise<string | null> {
  const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("permission");
  const result = camera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets?.[0]) return null;
  const small = await manipulateAsync(result.assets[0].uri, [{ resize: { width } }], { format: format === "png" ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.82, base64: true });
  return small.base64 ? `data:image/${format};base64,${small.base64}` : null;
}
