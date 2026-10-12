import { type FinanceProfileVersion, financeSetupPlanningSchema } from "@personal-os/domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "../settings/settings-layout.js";
import { FinanceConfigurationCollections } from "./configuration-collections.js";
import { FinanceConfigurationField as Setting } from "./configuration-fields.js";
import { FinanceIncomeEditor } from "./configuration-income.js";

import {
  emptyFinancePreferences,
  financeNumber,
  financeStatementSource,
} from "./configuration-values.js";
import { useFinanceConfiguration } from "./use-finance-configuration.js";

const text = (value: number | string | null | undefined) => value?.toString() ?? "";
export function FinanceConfigurationEditor() {
  const query = useFinanceConfiguration();
  if (query.isPending) return <p role="status">Loading financial settings…</p>;
  if (query.isError || query.data?.profile.state !== "loaded")
    return (
      <>
        <Alert>
          <AlertDescription>
            Financial settings could not load.{" "}
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
        <FinanceIncomeEditor />
      </>
    );
  const profile = query.data.profile.value;
  return (
    <div className="settings-stack">
      <SettingsSection title="Household" description="Your financial household and location.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Setting
            id="jurisdiction"
            label="Country and state or region"
            value={text(profile?.jurisdiction)}
            changes={(value) => ({ jurisdiction: value.trim() || null })}
          />
          <Setting
            id="householdSize"
            label="Household size"
            kind="number"
            value={text(profile?.householdSize)}
            changes={(value) => ({ householdSize: financeNumber(value) })}
          />
          <Setting
            id="dependents"
            label="Dependents"
            kind="number"
            value={text(profile?.dependents)}
            changes={(value) => ({ dependents: financeNumber(value) })}
          />
        </div>
      </SettingsSection>
      <SettingsSection title="Income">
        <div className="grid gap-4 sm:grid-cols-2">
          <Setting
            id="expectedMonthlyTakeHome"
            label="Expected monthly take-home"
            kind="currency"
            value={text(profile?.expectedMonthlyTakeHome)}
            changes={(value) => ({ expectedMonthlyTakeHome: financeNumber(value) })}
          />
          <Setting
            id="incomeStability"
            label="Income stability"
            value={profile?.incomeStability ?? "unknown"}
            options={[
              ["unknown", "Unknown"],
              ["stable", "Stable"],
              ["variable", "Variable"],
              ["seasonal", "Seasonal"],
            ]}
            changes={(value) => ({
              incomeStability: value as FinanceProfileVersion["incomeStability"],
            })}
          />
          <Setting
            id="reliable-income"
            label="Reliable monthly income"
            description="The amount you can reliably use in your budget."
            kind="currency"
            value={text(
              profile?.planning?.recurringIncome?.amountCents == null
                ? null
                : profile.planning.recurringIncome.amountCents / 100,
            )}
            changes={(value, current) => {
              const planning = financeSetupPlanningSchema.parse(current?.planning ?? {});
              return {
                planning: {
                  ...planning,
                  recurringIncome: {
                    provenance: financeStatementSource,
                    ...planning.recurringIncome,
                    amountCents: value.trim() ? Math.round(Number(value) * 100) : null,
                    nextDate: planning.recurringIncome?.nextDate ?? null,
                  },
                },
              };
            }}
          />
          <Setting
            id="next-payment"
            label="Next reliable payment"
            kind="date"
            value={profile?.planning?.recurringIncome?.nextDate ?? ""}
            changes={(value, current) => {
              const planning = financeSetupPlanningSchema.parse(current?.planning ?? {});
              return {
                planning: {
                  ...planning,
                  recurringIncome: {
                    provenance: financeStatementSource,
                    ...planning.recurringIncome,
                    amountCents: planning.recurringIncome?.amountCents ?? null,
                    nextDate: value || null,
                  },
                },
              };
            }}
          />
        </div>
      </SettingsSection>
      <FinanceIncomeEditor />
      <FinanceConfigurationCollections profile={profile} />
      <SettingsSection title="Reserves and preferences">
        <div className="grid gap-4 sm:grid-cols-2">
          <Setting
            id="liquidReserves"
            label="Liquid reserves"
            kind="currency"
            value={text(profile?.liquidReserves)}
            changes={(value) => ({ liquidReserves: financeNumber(value) })}
          />
          <Setting
            id="bufferTarget"
            label="Monthly buffer"
            kind="currency"
            value={text(profile?.preferences.bufferTarget)}
            changes={(value, current) => ({
              preferences: {
                ...emptyFinancePreferences,
                ...current?.preferences,
                bufferTarget: financeNumber(value),
              },
            })}
          />
          <Setting
            id="reserveMonths"
            label="Reserve target (months)"
            kind="number"
            value={text(profile?.preferences.emergencyReserveMonths)}
            changes={(value, current) => ({
              preferences: {
                ...emptyFinancePreferences,
                ...current?.preferences,
                emergencyReserveMonths: financeNumber(value),
              },
            })}
          />
          <Setting
            id="debtPriority"
            label="Debt priority"
            value={profile?.preferences.debtPriority ?? ""}
            options={[
              ["", "Not chosen"],
              ["avalanche", "Highest interest first"],
              ["snowball", "Smallest balance first"],
              ["minimums", "Required minimums"],
              ["custom", "Custom"],
            ]}
            changes={(value, current) => ({
              preferences: {
                ...emptyFinancePreferences,
                ...current?.preferences,
                debtPriority: (value ||
                  null) as FinanceProfileVersion["preferences"]["debtPriority"],
              },
            })}
          />
          <Setting
            id="notes"
            label="Planning notes"
            value={profile?.preferences.notes.join("\n") ?? ""}
            changes={(value, current) => ({
              preferences: {
                ...emptyFinancePreferences,
                ...current?.preferences,
                notes: value
                  .split("\n")
                  .map((note) => note.trim())
                  .filter(Boolean),
              },
            })}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
