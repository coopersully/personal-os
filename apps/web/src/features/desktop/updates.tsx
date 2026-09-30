import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { isDesktop } from "./bridge.js";
import {
  checkForUpdate,
  getUpdateStatus,
  openWithoutUpdate,
  restartForUpdate,
  type UpdateStatus,
} from "./update-bridge.js";

const updateKey = ["desktop-update-status"];
function useStatus() {
  return useQuery({
    queryKey: updateKey,
    queryFn: getUpdateStatus,
    enabled: isDesktop(),
    refetchInterval: (query) =>
      query.state.data?.phase === "unavailable"
        ? false
        : query.state.data?.startupBlocking ||
            ["checking", "downloading", "installing"].includes(query.state.data?.phase ?? "")
          ? 500
          : 10_000,
    retry: false,
  });
}
function statusText(status: UpdateStatus) {
  switch (status.phase) {
    case "checking":
      return "Checking for updates";
    case "downloading":
      return `Downloading nohmi ${status.availableVersion}`;
    case "installing":
      return "Installing update and restarting";
    case "ready":
      return `nohmi ${status.availableVersion} is ready to install`;
    case "current":
      return "You’re up to date";
    case "unavailable":
      return "Automatic updates are unavailable in this build";
    case "error":
      return status.error ?? "Could not check for updates";
  }
}
function UpdateProgress({ status }: { status: UpdateStatus }) {
  return (
    <div className="flex flex-col gap-3" role="status">
      <p>{statusText(status)}</p>
      {status.phase === "downloading" && status.totalBytes ? (
        <Progress
          aria-label="Update download"
          value={Math.min(100, (status.downloadedBytes / status.totalBytes) * 100)}
        />
      ) : null}
    </div>
  );
}
export function DesktopStartupGate({ children }: { children: ReactNode }) {
  const status = useStatus();
  const cache = useQueryClient();
  const open = useMutation({
    mutationFn: openWithoutUpdate,
    onSuccess: () => cache.invalidateQueries({ queryKey: updateKey }),
  });
  if (!isDesktop() || (status.data && !status.data.startupBlocking)) return children;
  return (
    <main className="center-screen">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Opening nohmi</CardTitle>
          <CardDescription>Updates keep your desktop app current</CardDescription>
        </CardHeader>
        <CardContent>
          {status.data ? (
            <UpdateProgress status={status.data} />
          ) : (
            <p role="status">Checking desktop update status</p>
          )}
          {status.error || open.error ? (
            <Alert>
              <AlertDescription>
                Update status is unavailable. Retry to open safely.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          {status.error ? (
            <Button onClick={() => void status.refetch()}>Retry</Button>
          ) : (
            <Button
              variant="ghost"
              disabled={!status.data || status.data.phase === "installing" || open.isPending}
              onClick={() => open.mutate()}
            >
              Open now
            </Button>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
export function DesktopUpdates() {
  const status = useStatus();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => cache.invalidateQueries({ queryKey: updateKey });
  const check = useMutation({ mutationFn: checkForUpdate, onSettled: refresh });
  const restart = useMutation({ mutationFn: restartForUpdate, onSettled: refresh });
  if (!isDesktop()) return null;
  const busy = status.data && ["checking", "downloading", "installing"].includes(status.data.phase);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          {status.data
            ? `Installed version ${status.data.installedVersion}`
            : "Reading installed version"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.data ? <UpdateProgress status={status.data} /> : null}
        {status.data?.checkedAt ? (
          <p className="text-sm text-muted-foreground">
            Last checked {new Date(status.data.checkedAt).toLocaleString()}
          </p>
        ) : null}
        {status.error || check.error ? (
          <Alert>
            <AlertDescription>
              Could not read update status{" "}
              <Button variant="ghost" onClick={() => void status.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {status.data?.phase === "ready" ? (
          <Button onClick={() => setConfirm(true)}>Restart to update</Button>
        ) : (
          <Button
            variant="secondary"
            disabled={
              !status.data ||
              Boolean(busy) ||
              check.isPending ||
              status.data.phase === "unavailable"
            }
            onClick={() => check.mutate()}
          >
            Check for updates
          </Button>
        )}
        <Button variant="ghost" asChild>
          <a href="/downloads">Downloads and release notes</a>
        </Button>
      </CardFooter>
      <Dialog
        open={confirm}
        onOpenChange={(value) => {
          if (!restart.isPending) setConfirm(value);
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (restart.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (restart.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Restart to update?</DialogTitle>
            <DialogDescription>
              Save your work before restarting. Your account and saved data will stay in place.
            </DialogDescription>
          </DialogHeader>
          {restart.error ? (
            <p role="alert">
              {restart.error instanceof Error ? restart.error.message : String(restart.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" disabled={restart.isPending} onClick={() => setConfirm(false)}>
              Not now
            </Button>
            <Button disabled={restart.isPending} onClick={() => restart.mutate()}>
              {restart.isPending ? "Installing update" : "Restart to update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
