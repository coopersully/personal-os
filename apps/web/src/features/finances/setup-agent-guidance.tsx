import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const financeInitialAgentInstructions = `Help me set up nohmi Finance using the connected nohmi MCP tools.
First call get_finance_playbook, then call setup_finances with operation "start" and follow the server's current questions and next actions.
Then call get_finance_onboarding for the durable workspace review. Save canonical financial values first, review the returned question IDs and exact revision with save_finance_onboarding_answers, and call complete_finance_onboarding with the saved revision only when its actual blockers are resolved. Only returned completedAt confirms completion. Keep Chat verification separate; never invent registration or proof.
Use my canonical financial profile and records. Keep unknown facts unknown, ask for decisions you cannot make, and do not approve a budget on my behalf.
For ongoing automation, help me connect an authorized host and choose its cadence. Use the Finance Automations page for the actual registration and server-issued host instructions. Registration alone does not verify Chat capability; follow the actual server verification flow.`;

/** Initial orientation only; registered hosts receive their bound instructions from the server. */
export function FinanceSetupAgentGuidance() {
  const id = useId();
  const copy = useMutation({
    mutationFn: async () => {
      const toastId = toast.loading("Copying initial agent instructions…");
      try {
        await navigator.clipboard.writeText(financeInitialAgentInstructions);
        toast.success("Initial agent instructions copied", { id: toastId });
      } catch (error) {
        toast.error("Instructions could not be copied. Select and copy the text below.", {
          id: toastId,
        });
        throw error;
      }
    },
  });
  return (
    <section aria-label="Initial agent guidance" className="grid gap-3">
      <h3 className="font-medium">Set up with an agent</h3>
      <p className="text-sm text-muted-foreground">
        Start with these instructions in your connected agent. After registration, use the host
        instructions issued for that connection in Finance Automations.
      </p>
      <Label htmlFor={id}>Initial agent instructions</Label>
      <Textarea id={id} readOnly value={financeInitialAgentInstructions} />
      <Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>
        Copy initial instructions
      </Button>
      <a className="text-sm underline" href="/finances/automations">
        Connect an agent and get host instructions
      </a>
    </section>
  );
}
