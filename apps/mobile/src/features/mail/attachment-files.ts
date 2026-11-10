import {
  MAIL_ATTACHMENT_COUNT,
  MAIL_ATTACHMENT_LIMIT,
  type MailDraftAttachmentInput,
} from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Platform, Share } from "react-native";
export type AttachmentContent = {
  filename: string;
  contentType: string;
  data: string;
  size: number;
};
export const safeFilename = (name: string) =>
  name
    .replace(/[\\/\p{Cc}]/gu, "_")
    .slice(0, 255)
    .replace(/^\.+$/, "attachment") || "attachment";
export async function pickAttachments(
  existing: MailDraftAttachmentInput[],
): Promise<MailDraftAttachmentInput[]> {
  const selection = await File.pickFileAsync({ multipleFiles: true });
  if (selection.canceled) return existing;
  if (selection.result.length + existing.length > MAIL_ATTACHMENT_COUNT)
    throw new Error("Add up to 10 attachments.");
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  const added: MailDraftAttachmentInput[] = [];
  for (const file of selection.result) {
    total += file.size;
    if (total > MAIL_ATTACHMENT_LIMIT) throw new Error("Attachments must total 10 MB or less.");
    const data = await file.base64();
    added.push({
      id: randomUUID(),
      filename: safeFilename(file.name),
      contentType: file.type.split(";")[0]?.trim() || "application/octet-stream",
      size: file.size,
      data,
    });
  }
  return [...existing, ...added];
}
/** Private temporary copies live only for the reader/editor session; explicit exports belong to the user. */
export function attachmentFiles() {
  const directory = new Directory(Paths.cache, "nohmi-mail-attachments", randomUUID());
  let disposed = false;
  return {
    dispose() {
      disposed = true;
      if (directory.exists) directory.delete();
    },
    async open(content: AttachmentContent, download: boolean) {
      if (disposed) return;
      if (content.size > MAIL_ATTACHMENT_LIMIT)
        throw new Error("This attachment exceeds the 10 MB limit.");
      directory.create({ intermediates: true, idempotent: true });
      const folder = new Directory(directory, randomUUID());
      folder.create();
      const file = new File(folder, safeFilename(content.filename));
      await file.write(content.data, { encoding: "base64" });
      if (disposed) {
        if (file.exists) file.delete();
        return;
      }
      if (download && Platform.OS === "ios") {
        await Share.share({ url: file.uri, title: content.filename });
      } else {
        if (!(await file.canPreview({ mimeType: content.contentType })))
          throw new Error("This file can’t be previewed. Use Save or share to open it elsewhere.");
        await file.preview({ title: content.filename, mimeType: content.contentType });
      }
    },
  };
}
