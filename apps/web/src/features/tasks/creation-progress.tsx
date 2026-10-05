import { Progress } from "@/components/ui/progress";

export function TaskCreationProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <span className="text-xs font-normal text-muted-foreground">
        Step {step} of {total}
      </span>
      <Progress aria-label="Creation progress" value={(step / total) * 100} />
    </div>
  );
}
