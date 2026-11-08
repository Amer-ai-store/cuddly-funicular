import { Platform, Share } from "react-native";

// Saves generated text (CSV/JSON) as a file in the browser, or hands it to the share sheet on phones.
export async function saveText(filename: string, text: string, type = "text/plain") {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: filename, message: text });
}
