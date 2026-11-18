import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { useCurrentSession } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, rejectionReason } from "./mutations";
import { SetupMaintenance } from "./setup-maintenance";
import { SetupReview, useFinanceOnboarding } from "./setup-review";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

export { useFinanceOnboarding } from "./setup-review";

/**
 * Overview's way into setup. It appears only when a server read says setup is unfinished; a
 * pending or failed read claims nothing.
 */
export function FinishFinanceSetup() {
  const onboarding = useFinanceOnboarding();
  if (!onboarding.data || onboarding.data.completedAt !== null) return null;
  return (
    <Card rows>
      <FinanceRow
        title="Finish Finance setup"
        subtitle="Review your answers and choose how to use Finance"
        icon="settings"
        onPress={() => router.push("/finance-setup")}
      />
    </Card>
  );
}

/** Prepares a draft budget from the recorded profile, or opens the plan that already exists. */
function SetupBudget() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const budget = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function prepare() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Preparing budget…");
    try {
      const result = await api.setupFinances({ operation: "prepare_budget" });
      if (!current()) return void toast.dismiss(id);
      if (result.outcome === "completed") toast.success("Budget draft prepared", { id });
      else if (result.outcome === "failed") toast.error(result.communication.headline, { id });
      else toast.info(result.communication.headline, { id });
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? `Budget not prepared.${rejectionReason(error)}`
          : "Couldn’t confirm the budget was prepared. Check Plan before trying again.",
        { id },
      );
    } finally {
      busy.current = false;
      if (current()) setPending(false);
      // Whether a plan exists now is read again whatever the outcome was.
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    }
  }
  return (
    <Section title="Budget">
      <ReadState query={budget}>
        {budget.data?.data ? (
          <Card rows>
            <FinanceRow
              title="Open budget"
              subtitle="Changes to your profile do not approve or activate a revised budget."
              icon="wallet"
              onPress={() => router.navigate("/finances/plan")}
            />
          </Card>
        ) : (
          <Card>
            <Copy secondary>
              Prepare a draft from the information you have recorded. Unknown amounts remain
              unknown. Approval and financial evidence are checked separately.
            </Copy>
            <Actions inset={false}>
              <Action label="Prepare budget" disabled={pending} onPress={() => void prepare()} />
            </Actions>
          </Card>
        )}
      </ReadState>
    </Section>
  );
}

/** Finance setup on iPhone: the onboarding review, a first budget draft and record maintenance. */
export function FinanceSetupScreen() {
  return (
    <FinanceScreen title="Finance setup">
      <SetupReview />
      <SetupBudget />
      <SetupMaintenance />
    </FinanceScreen>
  );
}
