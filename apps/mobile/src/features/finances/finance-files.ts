import { Platform, Share } from "react-native";

/**
 * The file system module is loaded when a file is picked or shared, not when a Finance screen
 * opens.
 */
const files = () => import("expo-file-system");

/**
 * Asks the person for a CSV file and returns its name and text, or `null` when they cancel.
 * On iPhone the picker hands over a temporary copy inside the app; it is deleted once read,
 * so the app keeps no copy of the file.
 */
export async function pickCsv(): Promise<{ name: string; text: string } | null> {
  const { File } = await files();
  const picked = await File.pickFileAsync({
    mimeTypes: ["text/csv", "text/comma-separated-values"],
  });
  if (picked.canceled) return null;
  const file = picked.result;
  try {
    return { name: file.name, text: await file.text() };
  } finally {
    // Elsewhere the picker returns the person's own file, which must never be deleted.
    if (Platform.OS === "ios") remove(file);
  }
}

function remove(file: { exists: boolean; delete: () => void }) {
  try {
    if (file.exists) file.delete();
  } catch {
    // The copy sits in the cache directory, which the system clears; nothing else can be done.
  }
}

/**
 * Hands CSV text to the system share sheet as a file, where the person chooses its destination.
 * The file exists in the app's cache only while the sheet is open and is deleted whether the
 * person shares it, cancels or the sheet fails.
 */
export async function shareCsv(name: string, content: string): Promise<"shared" | "dismissed"> {
  const { File, Paths } = await files();
  const file = new File(Paths.cache, name);
  remove(file);
  try {
    file.create();
    file.write(content);
    const result = await Share.share({ url: file.uri });
    return result.action === Share.dismissedAction ? "dismissed" : "shared";
  } finally {
    remove(file);
  }
}

/** Sharing a file through the system sheet is an iPhone capability of this app. */
export const canShareFiles = () => Platform.OS === "ios";
