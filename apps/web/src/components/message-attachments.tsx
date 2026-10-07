import { useEffect, useRef, useState } from "react";
import { DownloadIcon, FileTextIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileMetadata = {
  id: string;
  filename: string | null;
  contentType: string;
  size: number | null;
};
type FileContent = { filename: string; contentType: string; data: string; size: number };
type LoadAttachment = (id: string, signal?: AbortSignal) => Promise<FileContent>;

function previewType(contentType: string) {
  const mime = contentType.split(";")[0]?.trim().toLowerCase();
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime ?? "")) return "image";
  if (["text/plain", "text/csv", "text/calendar"].includes(mime ?? "")) return "text";
  return null;
}

function AttachmentTile({ file, load }: { file: FileMetadata; load?: LoadAttachment | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; text?: string; filename: string } | null>(
    null,
  );
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const lastAction = useRef<"preview" | "download">("download");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const name = file.filename || "Attachment";
  const canPreview = Boolean(previewType(file.contentType));
  async function open(action: "preview" | "download") {
    if (!load || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    lastAction.current = action;
    setBusy(true);
    setError(null);
    try {
      const content = await load(file.id, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const bytes = Uint8Array.from(atob(content.data), (character) => character.charCodeAt(0));
      let kind = previewType(content.contentType);
      let text: string | undefined;
      if (kind === "text") {
        const charset = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(
          content.contentType,
        );
        try {
          text = new TextDecoder(charset?.[1] ?? charset?.[2] ?? "utf-8").decode(bytes);
        } catch {
          // An unsupported charset remains downloadable without showing corrupted text.
          kind = null;
        }
      }
      const blob = new Blob([bytes], {
        type: kind === "image" ? content.contentType : "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      if (action === "preview" && kind) {
        setPreview({
          url,
          filename: content.filename,
          ...(text !== undefined ? { text } : {}),
        });
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = content.filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Couldn’t load the attachment. Try again.",
        );
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <li className="flex min-w-0 max-w-full flex-col gap-2 rounded-xl bg-secondary px-3 py-2.5 text-secondary-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background">
          <FileTextIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {load && canPreview ? (
            <Button
              variant="link"
              className="h-auto justify-start whitespace-normal break-all p-0 text-start"
              disabled={busy}
              onClick={() => void open(canPreview ? "preview" : "download")}
              aria-label={`${canPreview ? "Preview" : "Download"} ${name}`}
            >
              {name}
            </Button>
          ) : (
            <strong className="break-all text-sm font-medium">{name}</strong>
          )}
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {busy
              ? "Loading attachment…"
              : `${file.contentType}${file.size !== null ? ` · ${formatAttachmentSize(file.size)}` : ""}`}
          </span>
        </div>
        {load ? (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Download ${name}`}
            onClick={() => void open("download")}
          >
            <DownloadIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="flex max-w-sm items-center gap-2 text-sm">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void open(lastAction.current)}>
            Retry
          </Button>
        </div>
      ) : null}
      <ResponsiveDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{preview?.filename || name}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            {preview?.text !== undefined ? (
              <pre className="whitespace-pre-wrap break-words text-sm">{preview.text}</pre>
            ) : preview ? (
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-h-[60dvh] w-full object-contain"
              />
            ) : null}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button disabled={busy} onClick={() => void open("download")}>
              <DownloadIcon aria-hidden="true" />
              Download
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </li>
  );
}

export function MessageAttachments({
  attachments,
  load,
}: {
  attachments: FileMetadata[];
  load?: LoadAttachment | undefined;
}) {
  if (!attachments.length) return null;
  return (
    <div className="mt-4 flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {attachments.length === 1 ? "Attachment" : `${attachments.length} attachments`}
      </span>
      <ul aria-label="Attachments" className="flex flex-wrap gap-2">
        {attachments.map((file) => (
          <AttachmentTile key={file.id} file={file} load={load} />
        ))}
      </ul>
    </div>
  );
}
