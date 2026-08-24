import type {
  FinanceAccount,
  FinanceAutomationSettings,
  FinanceGuidedSetupContext,
  FinanceProfile,
} from "@personal-os/domain";
import { Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";

const financeHumanOnlyActionLabels = {
  add_manual_transaction: "add manual transactions",
  apply_categorization: "apply category decisions",
  confirm_ambiguous_transfer: "confirm ambiguous transfers",
  connect_or_disconnect_source: "connect or disconnect sources",
  create_merchant_rule: "create permanent merchant rules",
  import_transactions: "import transactions",
  manage_accounts: "manage accounts",
  manage_budgets: "manage budgets",
  manage_financial_profile: "manage the financial profile",
  manage_merchants: "rename or merge merchants",
  refresh_provider_data: "refresh provider data",
  resolve_alert: "resolve or dismiss alerts",
  review_recurring_obligation: "change recurring-obligation review state",
} satisfies Record<FinanceGuidedSetupContext["humanOnlyActions"][number], string>;

type FinanceProfileForm = {
  effectiveDate: string;
  employer: string;
  employmentType: "" | "contract" | "full_time" | "part_time" | "self_employed" | "unemployed";
  expectedNetPay: string;
  grossAnnualIncome: string;
  nextPayday: string;
  payAccountId: string;
  payFrequency: "" | "biweekly" | "irregular" | "monthly" | "semimonthly" | "weekly";
  role: string;
};

function emptyProfileForm(): FinanceProfileForm {
  return {
    effectiveDate: `${new Date().toISOString().slice(0, 7)}-01`,
    employer: "",
    employmentType: "",
    expectedNetPay: "",
    grossAnnualIncome: "",
    nextPayday: "",
    payAccountId: "",
    payFrequency: "",
    role: "",
  };
}

function financeProfileForm(profile: FinanceProfile): FinanceProfileForm {
  return {
    effectiveDate: profile.effectiveDate,
    employer: profile.employer ?? "",
    employmentType: profile.employmentType ?? "",
    expectedNetPay: profile.expectedNetPay?.toString() ?? "",
    grossAnnualIncome: profile.grossAnnualIncome?.toString() ?? "",
    nextPayday: profile.nextPayday ?? "",
    payAccountId: profile.payAccountId ?? "",
    payFrequency: profile.payFrequency ?? "",
    role: profile.role ?? "",
  };
}

export function FinanceSettings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FinanceProfileForm>(emptyProfileForm);
  const [formDirty, setFormDirty] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const setup = useQuery({
    queryFn: api.getFinanceGuidedSetup,
    queryKey: ["finance-guided-setup"],
  });
  const automation = useQuery({
    queryFn: api.getFinanceAutomationSettings,
    queryKey: ["finance-automation-settings"],
  });
  const agentProfile = useQuery({
    queryFn: () => api.getDomainProfile("finances"),
    queryKey: ["domain-profile", "finances"],
  });
  const overview = useQuery({
    queryFn: api.getFinanceOverview,
    queryKey: ["finance-overview", currentMonth],
  });
  const financialProfile = useQuery({
    queryFn: api.getFinanceProfile,
    queryKey: ["finance-profile"],
  });
  const activate = useMutation({
    mutationFn: async () => {
      const current = agentProfile.data;
      if (!current) throw new Error("No Finance guidance draft is available to activate.");
      return api.upsertDomainProfile({
        categories: current.categories,
        domain: "finances",
        expectedVersion: current.version,
        instructions: current.instructions,
        objective: current.objective,
        preferences: current.preferences,
        sourceContexts: current.sourceContexts,
        status: "active",
        summary: current.summary,
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domain-profile", "finances"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-guided-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["finances", "guided-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["ilo-setup-plan", "finances"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-setup-status"] }),
      ]),
  });
  const saveProfile = useMutation({
    mutationFn: () =>
      api.updateFinanceProfile({
        effectiveDate: form.effectiveDate,
        employer: form.employer.trim() || null,
        employmentType: form.employmentType || null,
        expectedNetPay: form.expectedNetPay ? Number(form.expectedNetPay) : null,
        grossAnnualIncome: form.grossAnnualIncome ? Number(form.grossAnnualIncome) : null,
        nextPayday: form.nextPayday || null,
        payAccountId: form.payAccountId || null,
        payFrequency: form.payFrequency || null,
        role: form.role.trim() || null,
      }),
    onSuccess: (profile) => {
      if ("status" in profile) {
        return queryClient.invalidateQueries({ queryKey: ["finance-profile"] });
      }
      queryClient.setQueryData(["finance-profile"], profile);
      setForm(financeProfileForm(profile));
      setFormDirty(false);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finance-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-guided-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["finances", "guided-setup"] }),
      ]);
    },
  });
  const updateAutomation = useMutation<
    FinanceAutomationSettings,
    Error,
    boolean,
    { previous: FinanceAutomationSettings | undefined }
  >({
    mutationFn: (reviewBypassEnabled: boolean) =>
      api.updateFinanceAutomationSettings({ reviewBypassEnabled }),
    onError: (_error, _reviewBypassEnabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["finance-automation-settings"], context.previous);
      }
    },
    onMutate: async (reviewBypassEnabled) => {
      await queryClient.cancelQueries({ queryKey: ["finance-automation-settings"] });
      const previous = queryClient.getQueryData<{ reviewBypassEnabled: boolean }>([
        "finance-automation-settings",
      ]);
      queryClient.setQueryData(["finance-automation-settings"], { reviewBypassEnabled });
      return { previous };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["finance-automation-settings"] }),
  });

  useEffect(() => {
    if (!financialProfile.data || formDirty) return;
    setForm(financeProfileForm(financialProfile.data));
  }, [financialProfile.data, formDirty]);

  return (
    <div className="agent-access" id="guidance">
      <FinanceAutomationPanel
        enabled={automation.data?.reviewBypassEnabled ?? false}
        error={automation.error ?? updateAutomation.error}
        loading={automation.isPending}
        onChange={(enabled) => updateAutomation.mutate(enabled)}
        saving={updateAutomation.isPending}
      />
      <FinanceAgentGuidancePanel
        activating={activate.isPending}
        activationEligible={
          agentProfile.data?.status === "draft" && agentProfile.data.sourceContexts.length > 0
        }
        error={setup.error ?? agentProfile.error ?? activate.error}
        loading={setup.isPending || agentProfile.isPending}
        onActivate={() => activate.mutate()}
        profileStatus={agentProfile.data?.status ?? null}
        setup={setup.data}
      />
      <FinancialProfilePanel
        accounts={overview.data?.accounts ?? []}
        error={financialProfile.error ?? saveProfile.error}
        form={form}
        loading={financialProfile.isPending || overview.isPending}
        onChange={(update) => {
          setFormDirty(true);
          setForm(update);
        }}
        onSave={() => saveProfile.mutate()}
        saving={saveProfile.isPending}
      />
    </div>
  );
}

function FinanceAutomationPanel({
  enabled,
  error,
  loading,
  onChange,
  saving,
}: {
  enabled: boolean;
  error: Error | null;
  loading: boolean;
  onChange: (enabled: boolean) => void;
  saving: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent review</CardTitle>
        <CardDescription>
          This setting applies to Finance ledger changes from every connected agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <InlineError error={error} /> : null}
        <Field data-disabled={loading || saving} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="finance-review-bypass">
              Let agents apply confident Finance changes
            </FieldLabel>
            <FieldDescription>
              {enabled
                ? "Confident changes apply immediately. Questions and ambiguous activity still come to Review."
                : "Agents still do the work, but confident changes wait in Review."}
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={enabled}
            disabled={loading || saving}
            id="finance-review-bypass"
            onCheckedChange={onChange}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

function FinanceAgentGuidancePanel({
  activating,
  activationEligible,
  error,
  loading,
  onActivate,
  profileStatus,
  setup,
}: {
  activating: boolean;
  activationEligible: boolean;
  error: Error | null;
  loading: boolean;
  onActivate: () => void;
  profileStatus: "active" | "draft" | null;
  setup: FinanceGuidedSetupContext | undefined;
}) {
  const approvedProfile = setup?.guidance.approvedProfile ?? null;
  const draftProposal = setup?.guidance.draftProposal ?? null;
  const guidanceStatus =
    approvedProfile && draftProposal
      ? "Active + draft"
      : approvedProfile
        ? "Active"
        : draftProposal || profileStatus === "draft"
          ? "Draft"
          : "Not configured";
  const availableWorkflows =
    setup?.suggestedWorkflows.filter((workflow) => workflow.available).length ?? 0;
  const humanOnlyActionLabels =
    setup?.humanOnlyActions
      .map((action) => financeHumanOnlyActionLabels[action])
      .filter((label): label is string => Boolean(label)) ?? [];
  const monthlyReviewGuidance =
    draftProposal?.preferences.monthly_review === true ||
    approvedProfile?.preferences.monthly_review === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent guidance</CardTitle>
        <CardDescription>
          Durable source meanings, review preferences, terminology, thresholds, and safety
          constraints for Claude, Codex, and other scoped hosts.
        </CardDescription>
        <CardAction>
          <Badge variant={approvedProfile ? "default" : "secondary"}>{guidanceStatus}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? <Spinner label="Loading Finance agent guidance" /> : null}
        {error ? <InlineError error={error} /> : null}
        {setup ? (
          <ItemGroup>
            <Item size="sm" variant="muted">
              <ItemContent>
                <ItemTitle>Sources ready</ItemTitle>
                <ItemDescription>
                  {setup.accountSources.length} account
                  {setup.accountSources.length === 1 ? "" : "s"} available for a short,
                  example-based interview.
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item size="sm" variant="muted">
              <ItemContent>
                <ItemTitle>Suggested workflows</ItemTitle>
                <ItemDescription>{availableWorkflows} available now.</ItemDescription>
              </ItemContent>
            </Item>
            <Item size="sm" variant="muted">
              <ItemContent>
                <ItemTitle>Human-only boundaries</ItemTitle>
                <ItemDescription>
                  {humanOnlyActionLabels.length > 0
                    ? `${humanOnlyActionLabels.join(", ")} stay in Finance.`
                    : "Consequential finance actions stay in Finance."}
                </ItemDescription>
              </ItemContent>
            </Item>
            {monthlyReviewGuidance ? (
              <Item size="sm" variant="muted">
                <ItemContent>
                  <ItemTitle>Monthly review guidance</ItemTitle>
                  <ItemDescription>
                    This preference guides agent behavior. No recurring schedule has been created.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : null}
            {approvedProfile ? (
              <Item size="sm" variant="muted">
                <ItemContent>
                  <ItemTitle>Active approved guidance</ItemTitle>
                  <ItemDescription>
                    This approved snapshot remains operative
                    {draftProposal ? " while the pending draft is reviewed." : "."}
                  </ItemDescription>
                  <FinanceGuidanceDetails
                    legend="Active approved Finance guidance contents"
                    profile={approvedProfile}
                  />
                </ItemContent>
              </Item>
            ) : null}
            {draftProposal || profileStatus === "draft" ? (
              <Item size="sm" variant="muted">
                <ItemContent>
                  <ItemTitle>Draft activation</ItemTitle>
                  <ItemDescription>
                    {activationEligible
                      ? "Review the recorded source meanings, thresholds, terminology, and safety constraints before activating this guidance."
                      : "Add at least one owned account source to the draft before activation."}
                  </ItemDescription>
                  {draftProposal ? (
                    <FinanceGuidanceDetails
                      legend="Finance guidance draft contents"
                      profile={draftProposal}
                    />
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Button
                    disabled={!activationEligible || activating}
                    onClick={onActivate}
                    size="sm"
                  >
                    {activating ? "Activating…" : "Activate guidance"}
                  </Button>
                </ItemActions>
              </Item>
            ) : null}
          </ItemGroup>
        ) : null}
      </CardContent>
    </Card>
  );
}

function withOccurrenceKeys(values: string[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const occurrence = (occurrences.get(value) ?? 0) + 1;
    occurrences.set(value, occurrence);
    return { key: `${value}:${occurrence}`, value };
  });
}

function FinanceGuidanceDetails({
  legend,
  profile,
}: {
  legend: string;
  profile: NonNullable<FinanceGuidedSetupContext["guidance"]["approvedProfile"]>;
}) {
  return (
    <fieldset className="mt-3 grid gap-3 text-sm">
      <legend className="sr-only">{legend}</legend>
      <div>
        <p className="font-medium">Objective</p>
        <p className="text-muted-foreground">{profile.objective}</p>
      </div>
      <div>
        <p className="font-medium">Summary</p>
        <p className="text-muted-foreground">{profile.summary}</p>
      </div>
      <div>
        <p className="font-medium">Safety and operating instructions</p>
        {profile.instructions.length > 0 ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {withOccurrenceKeys(profile.instructions).map(({ key, value }) => (
              <li key={key}>{value}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </div>
      <div>
        <p className="font-medium">Account meanings</p>
        {profile.sourceContexts.length > 0 ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {profile.sourceContexts.map((source) => (
              <li key={source.sourceId}>
                {source.sourceLabel} — {source.purpose}
                {source.notes ? ` — ${source.notes}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </div>
      <div>
        <p className="font-medium">Categories</p>
        <p className="text-muted-foreground">
          {profile.categories.length > 0
            ? profile.categories
                .map((category) => `${category.label}: ${category.description}`)
                .join("; ")
            : "None recorded."}
        </p>
      </div>
      <div>
        <p className="font-medium">Preferences</p>
        <p className="text-muted-foreground">
          {Object.keys(profile.preferences).length > 0
            ? Object.entries(profile.preferences)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join("; ")
            : "None recorded."}
        </p>
      </div>
    </fieldset>
  );
}

function FinancialProfilePanel({
  accounts,
  error,
  form,
  loading,
  onChange,
  onSave,
  saving,
}: {
  accounts: FinanceAccount[];
  error: Error | null;
  form: FinanceProfileForm;
  loading: boolean;
  onChange: React.Dispatch<React.SetStateAction<FinanceProfileForm>>;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial profile</CardTitle>
        <CardDescription>
          Your private baseline for paycheck and cash-flow checks. It is never inferred as a job
          change without your confirmation.
        </CardDescription>
        <CardAction>
          <Button disabled={loading || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? <Spinner label="Loading financial profile" /> : null}
        {error ? <InlineError error={error} /> : null}
        <FieldGroup className="grid gap-4 md:grid-cols-2">
          <ProfileTextField
            id="finance-employer"
            label="Employer"
            onChange={(employer) => onChange((value) => ({ ...value, employer }))}
            value={form.employer}
          />
          <ProfileTextField
            id="finance-role"
            label="Role"
            onChange={(role) => onChange((value) => ({ ...value, role }))}
            value={form.role}
          />
          <Field>
            <FieldLabel htmlFor="finance-employment-type">Employment type</FieldLabel>
            <NativeSelect
              id="finance-employment-type"
              onChange={(event) =>
                onChange((value) => ({
                  ...value,
                  employmentType: event.target.value as FinanceProfileForm["employmentType"],
                }))
              }
              value={form.employmentType}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              <NativeSelectOption value="full_time">Full time</NativeSelectOption>
              <NativeSelectOption value="part_time">Part time</NativeSelectOption>
              <NativeSelectOption value="contract">Contract</NativeSelectOption>
              <NativeSelectOption value="self_employed">Self-employed</NativeSelectOption>
              <NativeSelectOption value="unemployed">Not employed</NativeSelectOption>
            </NativeSelect>
          </Field>
          <ProfileTextField
            id="finance-effective-date"
            label="Effective date"
            onChange={(effectiveDate) => onChange((value) => ({ ...value, effectiveDate }))}
            type="date"
            value={form.effectiveDate}
          />
          <ProfileTextField
            id="finance-gross-income"
            label="Gross annual income"
            onChange={(grossAnnualIncome) => onChange((value) => ({ ...value, grossAnnualIncome }))}
            value={form.grossAnnualIncome}
          />
          <ProfileTextField
            id="finance-net-pay"
            label="Expected net paycheck"
            onChange={(expectedNetPay) => onChange((value) => ({ ...value, expectedNetPay }))}
            value={form.expectedNetPay}
          />
          <Field>
            <FieldLabel htmlFor="finance-pay-frequency">Pay frequency</FieldLabel>
            <NativeSelect
              id="finance-pay-frequency"
              onChange={(event) =>
                onChange((value) => ({
                  ...value,
                  payFrequency: event.target.value as FinanceProfileForm["payFrequency"],
                }))
              }
              value={form.payFrequency}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
              <NativeSelectOption value="biweekly">Every two weeks</NativeSelectOption>
              <NativeSelectOption value="semimonthly">Twice monthly</NativeSelectOption>
              <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
              <NativeSelectOption value="irregular">Irregular</NativeSelectOption>
            </NativeSelect>
          </Field>
          <ProfileTextField
            id="finance-next-payday"
            label="Next payday"
            onChange={(nextPayday) => onChange((value) => ({ ...value, nextPayday }))}
            type="date"
            value={form.nextPayday}
          />
          <Field>
            <FieldLabel htmlFor="finance-pay-account">Pay account</FieldLabel>
            <NativeSelect
              id="finance-pay-account"
              onChange={(event) =>
                onChange((value) => ({ ...value, payAccountId: event.target.value }))
              }
              value={form.payAccountId}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {account.institution} · {account.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function ProfileTextField({
  id,
  label,
  onChange,
  type = "text",
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode={type === "text" ? "text" : undefined}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </Field>
  );
}
