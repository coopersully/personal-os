import type { MailDraftAttachment, MailDraftAttachmentInput } from "@personal-os/domain";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Icon } from "../../components/icons";
import { RowActions } from "../../components/row-actions";
import { spacing, useTheme } from "../../theme";
import type { AttachmentContent } from "./attachment-files";

export function attachmentSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
export function Attachments({
  files,
  load,
  remove,
  disabled = false,
}: {
  files: (MailDraftAttachment | MailDraftAttachmentInput)[];
  load: (file: MailDraftAttachmentInput) => Promise<AttachmentContent>;
  remove?: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const live = useRef(true);
  const cache = useRef<ReturnType<typeof import("./attachment-files").attachmentFiles> | null>(
    null,
  );
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      cache.current?.dispose();
    };
  }, []);
  const open = async (file: MailDraftAttachmentInput, download: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const id = toast.loading("Opening attachment…");
    try {
      const content = await load(file);
      if (!live.current) return;
      const native = await import("./attachment-files");
      if (!live.current) return;
      cache.current ??= native.attachmentFiles();
      await cache.current.open(content, download);
      if (live.current)
        toast.success(download ? "Share sheet opened" : "Attachment opened", { id });
    } catch (error) {
      if (live.current)
        toast.error(error instanceof Error ? error.message : "Couldn’t open attachment.", { id });
    } finally {
      if (!live.current) toast.dismiss(id);
      lock.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <View>
      {files.map((file) => (
        <View
          key={file.id}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.md,
            padding: spacing.lg,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${file.filename}, ${attachmentSize(file.size)}`}
            disabled={busy || disabled}
            onPress={() => void open(file, false)}
            style={{ flex: 1, minHeight: 44, flexDirection: "row", gap: spacing.md }}
          >
            <Icon name="file" color={t.secondary} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: t.ink, fontSize: 16 }} numberOfLines={2}>
                {file.filename}
              </Text>
              <Text style={{ color: t.secondary, fontSize: 13 }}>{attachmentSize(file.size)}</Text>
            </View>
          </Pressable>
          <RowActions
            label={`Actions for ${file.filename}`}
            actions={
              remove
                ? [
                    {
                      id: "remove",
                      label: `Remove ${file.filename}`,
                      icon: "cancel",
                      disabled: disabled || busy,
                      onPress: () => remove(file.id),
                    },
                  ]
                : [
                    {
                      id: "download",
                      label: `Save or share ${file.filename}`,
                      icon: "download",
                      disabled: busy || disabled,
                      onPress: () => void open(file, true),
                    },
                  ]
            }
          />
        </View>
      ))}
    </View>
  );
}
