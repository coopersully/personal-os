import { Platform, Share } from "react-native";
import { csvByteLimit } from "./csv-import";

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
export async function pickCsv(): Promise<{ name: string; text: string | null } | null> {
  const { File } = await files();
  const picked = await File.pickFileAsync({
    mimeTypes: ["text/csv", "text/comma-separated-values"],
  });
  if (picked.canceled) return null;
  const file = picked.result;
  try {
    // `text` is null for a file too large to import: it is never read into memory.
    return { name: file.name, text: file.size > csvByteLimit ? null : await file.text() };
  } finally {
    // Elsewhere the picker returns the person's own file, which must never be deleted.
    if (Platform.OS === "ios") remove(file);
  }
}

function remove(file: { exists: boolean; delete: () => void }) {
  try {
    if (file.exists) file.delete();
  } catch {
    // It sits in the cache directory, which the system clears; nothing else can be done.
  }
}

/**
 * Hands CSV text to the system share sheet as a file, where the person chooses its destination.
 * The file lives in one export directory in the app's cache only while the sheet is open. The
 * directory is removed when the sheet closes, however it closes, and is emptied before every
 * export, so a file left by an app that was closed mid-share does not outlive the next export.
 */
export async function shareCsv(name: string, content: string): Promise<"shared" | "dismissed"> {
  const { Directory, File, Paths } = await files();
  const folder = new Directory(Paths.cache, "finance-export");
  remove(folder);
  try {
    folder.create();
    const file = new File(folder, name);
    file.create();
    file.write(content);
    const result = await Share.share({ url: file.uri });
    return result.action === Share.dismissedAction ? "dismissed" : "shared";
  } finally {
    remove(folder);
  }
}

/** Sharing a file through the system sheet is an iPhone capability of this app. */
export const canShareFiles = () => Platform.OS === "ios";
