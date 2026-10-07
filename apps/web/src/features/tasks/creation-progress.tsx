import { Progress } from "@/components/ui/progress";

export function TaskCreationProgress({
  step,
  total,
}: {
  step: number;
  total?: number | undefined;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <span className="text-xs font-normal text-muted-foreground">
        Step {step}
        {total ? ` of ${total}` : ""}
      </span>
      {total ? <Progress aria-label="Creation progress" value={(step / total) * 100} /> : null}
    </div>
  );
}
