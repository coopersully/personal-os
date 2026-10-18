import type { AutomationHostPromptIssue } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";

type HostScheduleStatus = Awaited<ReturnType<typeof api.listAutomationHostSchedules>>[number];

export function HostPromptPanel({ status }: { status: HostScheduleStatus }) {
  const { schedule, prompt } = status;
  const queryClient = useQueryClient();
  const [issues, setIssues] = useState<AutomationHostPromptIssue[]>([]);
  const [selected, setSelected] = useState<AutomationHostPromptIssue | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const saved = [...issues, ...(prompt?.latestIssued ? [prompt.latestIssued] : [])]
    .filter(
      (issue, index, all) =>
        all.findIndex((item) => item.templateVersion === issue.templateVersion) === index,
    )
    .sort((a, b) => b.templateVersion - a.templateVersion);
  const current = selected ?? saved[0] ?? null;
  async function history(older = false, explicit = false) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const notification = explicit ? toast.loading("Loading saved instructions…") : undefined;
    try {
      const page = await api.getAutomationHostPromptHistory(schedule.id, {
        limit: 10,
        ...(older && cursor !== null ? { beforeVersion: cursor } : {}),
      });
      setIssues((previous) => (older ? [...previous, ...page.issues] : page.issues));
      setCursor(page.nextCursor);
      setLoaded(true);
      if (notification !== undefined)
        toast.success(older ? "Older instructions loaded." : "Saved instructions loaded.", {
          id: notification,
        });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Instructions could not be loaded. Try again.";
      if (notification !== undefined) toast.error(message, { id: notification });
      else toast.error(message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function issue() {
    if (!prompt || busy.current) return;
    busy.current = true;
    setPending(true);
    const notification = toast.loading("Saving instructions…");
    try {
      const result = await api.issueAutomationHostPrompt(
        schedule.id,
        prompt.currentTemplateVersion,
        { expectedScheduleVersion: schedule.version },
      );
      setIssues((previous) => [
        result,
        ...previous.filter((item) => item.templateVersion !== result.templateVersion),
      ]);
      setSelected(result);
      toast.success("Instructions saved. Copy them to your host to apply them.", {
        id: notification,
      });
      void queryClient.invalidateQueries({ queryKey: ["finance-host-schedules"] });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Instructions could not be saved. Reload host status and try again.",
        { id: notification },
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function copy() {
    if (!current) return;
    const notification = toast.loading("Copying instructions…");
    try {
      await navigator.clipboard.writeText(current.text);
      toast.success("Instructions copied.", { id: notification });
    } catch {
      toast.error("Instructions could not be copied. Select the text and copy it manually.", {
        id: notification,
      });
    }
  }
  const canIssue =
    prompt &&
    status.connectionAvailable !== false &&
    !["revoked", "cancelled"].includes(schedule.state);
  const id = `host-prompt-${schedule.id}`;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open && prompt && !loaded) void history();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Instructions</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{schedule.label} instructions</DialogTitle>
          <DialogDescription>
            Saved setup text for this host. Installation status is unknown.
          </DialogDescription>
        </DialogHeader>
        {!prompt ? (
          <p>Saved instructions are unavailable. Reload host status to try again.</p>
        ) : (
          <>
            {saved.length ? (
              <>
                <Label htmlFor={`${id}-version`}>Saved version</Label>
                <NativeSelect
                  id={`${id}-version`}
                  value={String(current?.templateVersion ?? "")}
                  onChange={(event) =>
                    setSelected(
                      saved.find((item) => item.templateVersion === Number(event.target.value)) ??
                        null,
                    )
                  }
                >
                  {saved.map((item) => (
                    <NativeSelectOption
                      key={item.templateVersion}
                      value={String(item.templateVersion)}
                    >
                      Version {item.templateVersion} · {item.issuedAt}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Label htmlFor={id}>Host prompt</Label>
                <Textarea id={id} readOnly value={current?.text ?? ""} className="min-h-64" />
                <Button onClick={() => void copy()}>Copy instructions</Button>
              </>
            ) : (
              <p>No instructions have been recorded for this host.</p>
            )}
            {!loaded ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void history(false, true)}
              >
                Reload saved instructions
              </Button>
            ) : null}
            {cursor !== null ? (
              <Button variant="outline" disabled={pending} onClick={() => void history(true, true)}>
                Load older versions
              </Button>
            ) : null}
            {canIssue && (!prompt.latestIssued || prompt.upgradeAvailable) ? (
              <Button disabled={pending} onClick={() => void issue()}>
                {prompt.latestIssued ? "Save latest instructions" : "Issue instructions"}
              </Button>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
