import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isDesktop } from "@/features/desktop/bridge";
import {
  openCurrentRitual,
  readRitualState,
  submitRitualAction,
  submitRitualResponse,
} from "@/features/desktop/ritual-bridge";
import { RitualChecklist } from "@/features/tracking/ritual-overlay";
export function TodayRitualCard() {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["today-ritual"],
    queryFn: readRitualState,
    refetchInterval: 30000,
  });
  const occurrence = query.data?.current;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Current ritual</h2>
        </CardTitle>
        <CardDescription>
          {occurrence?.definition.title ??
            (query.isPending
              ? "Loading…"
              : query.isError
                ? "Ritual unavailable"
                : "No current ritual")}
        </CardDescription>
      </CardHeader>
      {query.data?.syncStatus === "queued" ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Changes waiting to sync</p>
        </CardContent>
      ) : null}
      {occurrence?.status === "pending" ? (
        <CardFooter>
          <Button
            onClick={() => {
              if (isDesktop())
                toast.promise(openCurrentRitual(), {
                  loading: "Opening ritual…",
                  success: "Ritual requested.",
                  error: "Could not open the ritual.",
                });
              else setOpen(true);
            }}
          >
            Continue ritual
          </Button>
        </CardFooter>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Current ritual</DialogTitle>
          {query.data && occurrence ? (
            <RitualChecklist
              key={occurrence.id}
              feedback="toast"
              state={query.data}
              saveResponse={async (stepId, input) => {
                const state = await submitRitualResponse(occurrence.id, stepId, input);
                cache.setQueryData(["today-ritual"], state);
                return state;
              }}
              act={async (input) => {
                const result = await submitRitualAction(occurrence.id, input);
                void query.refetch();
                return result;
              }}
            />
          ) : (
            <p>No current ritual</p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
