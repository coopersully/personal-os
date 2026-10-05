import { FileTextIcon } from "@/components/icons";

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** File metadata stays attached to its message; do not imply download capability. */
export function MessageAttachments({
  attachments,
}: {
  attachments: Array<{
    id: string;
    filename: string | null;
    contentType: string;
    size: number | null;
  }>;
}) {
  if (!attachments.length) return null;
  return (
    <div className="mt-4 flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {attachments.length === 1 ? "Attachment" : `${attachments.length} attachments`}
      </span>
      <ul aria-label="Attachments" className="flex flex-wrap gap-2">
        {attachments.map((file) => (
          <li
            key={file.id}
            className="flex min-w-0 max-w-full items-center gap-3 rounded-xl bg-secondary px-3 py-2.5 text-secondary-foreground"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background">
              <FileTextIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <strong className="break-all text-sm font-medium">
                {file.filename || "Attachment"}
              </strong>
              <span className="text-xs text-muted-foreground">
                {file.contentType}
                {file.size !== null ? ` · ${formatAttachmentSize(file.size)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
