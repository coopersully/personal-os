import type { KnowledgePage } from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Platform, Share } from "react-native";

export function memoryShareAvailable() {
  // React Native's Share content URL is supported on iOS.
  return Platform.OS === "ios" && typeof Share?.share === "function";
}

export async function shareMemoryPage(data: KnowledgePage, page: number, current: () => boolean) {
  if (!current()) return false;
  const file = new File(Paths.cache, `nohmi-memory-${page}-${randomUUID()}.json`);
  try {
    await file.write(JSON.stringify(data, null, 2));
    if (!current()) return false;
    const result = await Share.share({ title: "nohmi memory export", url: file.uri });
    return current() && result.action === Share.sharedAction;
  } finally {
    if (file.exists) file.delete();
  }
}
