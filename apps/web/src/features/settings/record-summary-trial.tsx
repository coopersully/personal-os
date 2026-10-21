import { type ReactNode, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { RecordTextEditor } from "./record-text-editor";
import { ProfileRow } from "./profile-rows";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";

/** Goals/Motives design trial; intentionally not a shared settings primitive. */
export function RecordSummaryTrial({
  title,
  kind,
  progress,
  inactive = false,
  completed = false,
  details,
  summary,
  value,
  description,
  metadata,
  actions,
  editing,
}: {
  editing?: { pending: boolean; description: string; saveTitle: (value: string) => Promise<unknown>; saveDescription: (value: string) => Promise<unknown> };
  title: string;
  kind: "Goal" | "Motive";
  progress?: number;
  inactive?: boolean;
  completed?: boolean;
  details?: ReactNode;
  summary?: ReactNode;
  value: ReactNode;
  description: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div role="listitem" className="settings-inline-row">
        <ProfileRow
          label={title}
          variant={inactive ? "inactive" : "default"}
          icon={progress === undefined ? undefined : (
            <span className="relative flex size-8 shrink-0 items-center justify-center text-[9px] font-medium tabular-nums text-foreground">
              <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{
                background: progress >= 100 ? "var(--foreground)" : progress <= 0 ? "var(--border)" : `conic-gradient(var(--foreground) ${Math.max(0, Math.min(100, progress) * 3.6 - 0.5)}deg, var(--border) ${Math.min(100, progress) * 3.6 + 0.5}deg)`,
                maskImage: "radial-gradient(farthest-side, transparent calc(100% - 2.75px), black calc(100% - 2px), black calc(100% - 0.75px), transparent 100%)",
              }} />
              {completed ? <CheckIcon className="size-4" /> : `${progress}%`}
            </span>
          )}
          ariaLabel={[title, typeof summary === "string" ? summary : "", completed ? "Completed" : progress === undefined ? value : `${progress}%`].filter(Boolean).join(" ")}
          description={summary}
          truncateDescription
          value={value}
          onClick={() => setOpen(true)}
        />
      </div>
      <DialogContent aria-label={title} onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }} showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto gap-5 p-6 sm:max-w-lg">
        <span className="text-xs font-medium text-muted-foreground">{kind}</span>
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl leading-snug outline-none">{editing ? <RecordTextEditor label="Title" value={title} required pending={editing.pending} onSave={editing.saveTitle} /> : title}</DialogTitle>
          {!details && !editing ? <DialogDescription className="whitespace-pre-wrap leading-relaxed">{description}</DialogDescription> : null}
        </DialogHeader>
        {details || editing ? (
          <section className="space-y-2">
            <h3 className="settings-detail-heading">{kind === "Goal" ? "Success looks like" : "Why it matters"}</h3>
            <DialogDescription asChild className="whitespace-pre-wrap leading-relaxed">
              <div>{editing ? <RecordTextEditor label={kind === "Goal" ? "Success looks like" : "Why it matters"} value={editing.description} multiline pending={editing.pending} onSave={editing.saveDescription} /> : description}</div>
            </DialogDescription>
          </section>
        ) : null}
        {details}
        {metadata ? <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{metadata}</div> : null}
        <DialogFooter className="mx-0 mb-0 p-0 pt-2 rounded-none">
          {actions}
          <DialogClose asChild><Button>Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
