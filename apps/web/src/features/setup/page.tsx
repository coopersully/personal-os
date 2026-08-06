import type { AccountSetupStep, AccountSetupWorkspace, User } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Mail,
  ShieldCheck,
  Volleyball,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { CheckboxCardGroup } from "@/components/checkbox-card-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  WorkspaceIcon,
  type WorkspaceId,
  workspaceIdentities,
} from "@/components/workspace-identity";
import { api, errorMessage } from "../../api.js";
import { ConnectionAuthorizationOutcome } from "../connections/authorization-outcome.js";
import { PlaidConnectButton } from "../finances/plaid-connect.js";

const workspaceOptions: Array<{
  description: string;
  label: string;
  value: WorkspaceId & AccountSetupWorkspace;
}> = [
  {
    description: "See commitments across every calendar.",
    label: workspaceIdentities.calendar.label,
    value: "calendar",
  },
  {
    description: "Capture and plan locally from the start.",
    label: workspaceIdentities.tasks.label,
    value: "tasks",
  },
  {
    description: "Bring the conversations that need attention together.",
    label: workspaceIdentities.mail.label,
    value: "mail",
  },
  {
    description: "Track accounts, spending, and decisions.",
    label: workspaceIdentities.finances.label,
    value: "finances",
  },
];

function setupSteps(
  workspaces: AccountSetupWorkspace[],
  emailVerified: boolean,
): AccountSetupStep[] {
  const providerSetupSelected = workspaces.includes("calendar") || workspaces.includes("mail");
  return [
    "welcome",
    "workspaces",
    ...(providerSetupSelected
      ? ([...(!emailVerified ? (["verify_email"] as const) : []), "google", "icloud"] as const)
      : []),
    ...(workspaces.includes("finances") ? (["finances"] as const) : []),
    "ready",
  ];
}

function adjacentStep(
  current: AccountSetupStep,
  workspaces: AccountSetupWorkspace[],
  emailVerified: boolean,
  direction: -1 | 1,
) {
  const steps = setupSteps(workspaces, emailVerified);
  const index = Math.max(0, steps.indexOf(current));
  return steps[Math.max(0, Math.min(steps.length - 1, index + direction))] ?? "ready";
}

export function SetupPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const stageRef = useRef<HTMLElement>(null);
  const [completionSucceeded, setCompletionSucceeded] = useState(false);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<AccountSetupWorkspace[]>(
    user.setup.selectedWorkspaces,
  );
  const providerSetupSelected =
    selectedWorkspaces.includes("calendar") || selectedWorkspaces.includes("mail");
  const currentStep = user.emailVerified
    ? user.setup.currentStep === "verify_email"
      ? "google"
      : user.setup.currentStep
    : providerSetupSelected &&
        (user.setup.currentStep === "google" || user.setup.currentStep === "icloud")
      ? "verify_email"
      : user.setup.currentStep;
  const connectors = useQuery({
    enabled: providerSetupSelected && ["google", "icloud", "ready"].includes(currentStep),
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
  });
  const finances = useQuery({
    enabled: selectedWorkspaces.includes("finances") && ["finances", "ready"].includes(currentStep),
    queryFn: api.getFinanceOverview,
    queryKey: ["finance-overview", "setup"],
  });
  const save = useMutation({
    mutationFn: api.updateAccountSetup,
    onSuccess: (nextUser, mutation) => {
      if (mutation.action !== "progress") setCompletionSucceeded(true);
      queryClient.setQueryData(["me"], nextUser);
    },
  });

  const progress = (
    nextStep: AccountSetupStep,
    nextWorkspaces: AccountSetupWorkspace[] = selectedWorkspaces,
  ) =>
    save.mutate({
      action: "progress",
      currentStep: nextStep,
      selectedWorkspaces: nextWorkspaces,
    });
  const checkVerification = useMutation({
    mutationFn: api.getMe,
    onSuccess: (nextUser) => {
      if (nextUser.emailVerified) {
        progress("google");
      } else {
        queryClient.setQueryData(["me"], nextUser);
      }
    },
  });
  const resendVerification = useMutation({ mutationFn: api.resendEmailVerification });
  const steps = setupSteps(selectedWorkspaces, user.emailVerified);
  const stepIndex = Math.max(0, steps.indexOf(currentStep));
  const exitSetup = () => {
    setCompletionSucceeded(false);
    setPendingDestination("/today");
    save.mutate({ action: "dismiss" });
  };
  const completeSetup = (redirectDestination = "/today") => {
    setCompletionSucceeded(false);
    setPendingDestination(redirectDestination);
    save.mutate({ action: "complete" });
  };

  useEffect(() => {
    if (window.scrollY !== 0) window.scrollTo({ behavior: "auto", left: 0, top: 0 });
    stageRef.current
      ?.querySelector<HTMLElement>(`h1[data-setup-step="${currentStep}"]`)
      ?.focus({ preventScroll: true });
  }, [currentStep]);

  if (
    pendingDestination &&
    completionSucceeded &&
    (user.setup.status === "complete" || user.setup.status === "dismissed")
  ) {
    return <Navigate replace to={pendingDestination} />;
  }

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <div className="setup-wordmark">
          <span className="logo-mark logo-mark--compact">
            <Volleyball aria-hidden="true" />
          </span>
          ilo
        </div>
        <Button disabled={save.isPending} onClick={exitSetup} variant="ghost">
          Exit setup
        </Button>
      </header>
      <div className="setup-progress">
        <div>
          <span>
            Step {stepIndex + 1} of {steps.length}
          </span>
          <span>{Math.round(((stepIndex + 1) / steps.length) * 100)}%</span>
        </div>
        <div
          aria-valuemax={steps.length}
          aria-valuemin={1}
          aria-valuenow={stepIndex + 1}
          aria-label="Setup progress"
          className="setup-progress__track"
          role="progressbar"
        >
          <span style={{ transform: `scaleX(${(stepIndex + 1) / steps.length})` }} />
        </div>
      </div>
      <section className="setup-stage" key={currentStep} ref={stageRef}>
        {currentStep === "welcome" ? (
          <WelcomeStep
            displayName={user.displayName}
            pending={save.isPending}
            start={() => progress("workspaces")}
          />
        ) : null}
        {currentStep === "workspaces" ? (
          <WorkspacesStep
            back={() => progress("welcome")}
            continueSetup={() =>
              progress(
                adjacentStep("workspaces", selectedWorkspaces, user.emailVerified, 1),
                selectedWorkspaces,
              )
            }
            pending={save.isPending}
            selected={selectedWorkspaces}
            setSelected={setSelectedWorkspaces}
          />
        ) : null}
        {currentStep === "verify_email" ? (
          <VerifyEmailStep
            back={() => progress("workspaces")}
            check={() => checkVerification.mutate()}
            checkError={checkVerification.error}
            checkFailed={
              checkVerification.isSuccess && checkVerification.data.emailVerified === false
            }
            email={user.email}
            pending={checkVerification.isPending || save.isPending}
            resend={() => resendVerification.mutate()}
            resendPending={resendVerification.isPending}
            resendSucceeded={resendVerification.isSuccess}
          />
        ) : null}
        {currentStep === "google" ? (
          <GoogleStep
            accounts={connectors.data?.filter((account) => account.provider === "google") ?? []}
            back={() => progress(adjacentStep("google", selectedWorkspaces, true, -1))}
            continueSetup={() => progress(adjacentStep("google", selectedWorkspaces, true, 1))}
            onConnected={() => void connectors.refetch()}
            pending={save.isPending}
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {currentStep === "icloud" ? (
          <ICloudStep
            accounts={connectors.data?.filter((account) => account.provider === "icloud") ?? []}
            back={() => progress(adjacentStep("icloud", selectedWorkspaces, true, -1))}
            continueSetup={() => progress(adjacentStep("icloud", selectedWorkspaces, true, 1))}
            pending={save.isPending}
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {currentStep === "finances" ? (
          <FinancesStep
            accounts={finances.data?.accounts ?? []}
            back={() =>
              progress(adjacentStep("finances", selectedWorkspaces, user.emailVerified, -1))
            }
            continueSetup={() => progress("ready")}
            pending={save.isPending}
            refresh={() => queryClient.invalidateQueries({ queryKey: ["finance-overview"] })}
          />
        ) : null}
        {currentStep === "ready" ? (
          <ReadyStep
            complete={() => completeSetup()}
            connectAgent={() => completeSetup("/settings?section=agents")}
            connectedAccounts={connectors.data?.length ?? 0}
            financeAccounts={finances.data?.accounts.length ?? 0}
            pending={save.isPending}
            review={() =>
              progress(adjacentStep("ready", selectedWorkspaces, user.emailVerified, -1))
            }
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <ShieldCheck />
            <AlertTitle>Setup progress was not saved</AlertTitle>
            <AlertDescription>{errorMessage(save.error)}</AlertDescription>
          </Alert>
        ) : null}
      </section>
    </main>
  );
}

function WelcomeStep({
  displayName,
  pending,
  start,
}: {
  displayName: string;
  pending: boolean;
  start: () => void;
}) {
  const firstName = displayName.trim().split(/\s+/)[0] || "there";
  return (
    <div className="setup-step setup-step--welcome">
      <div className="setup-step__heading">
        <h1 data-setup-step="welcome" tabIndex={-1}>
          Hi, {firstName}.
        </h1>
        <p>Let’s connect the parts of your life you want in one place.</p>
      </div>
      <ItemGroup className="setup-intro">
        <Item>
          <ItemMedia variant="icon">
            <Check />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>You choose the sources</ItemTitle>
            <ItemDescription>Connect only the accounts and services you want.</ItemDescription>
          </ItemContent>
        </Item>
        <Item>
          <ItemMedia variant="icon">
            <ShieldCheck />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>You stay in control</ItemTitle>
            <ItemDescription>No agent gets access during setup.</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <Button disabled={pending} onClick={start} size="lg">
        Set up ilo
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}

function WorkspacesStep({
  back,
  continueSetup,
  pending,
  selected,
  setSelected,
}: {
  back: () => void;
  continueSetup: () => void;
  pending: boolean;
  selected: AccountSetupWorkspace[];
  setSelected: (selected: AccountSetupWorkspace[]) => void;
}) {
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="workspaces" tabIndex={-1}>
          What should ilo help with?
        </h1>
        <p>You can always add more later.</p>
      </div>
      <CheckboxCardGroup
        aria-label="Workspaces to set up"
        onValuesChange={setSelected}
        options={workspaceOptions.map((option) => ({
          ...option,
          icon: <WorkspaceIcon size="lg" workspace={option.value} />,
        }))}
        values={selected}
      />
      <SetupFooter
        back={back}
        continueDisabled={selected.length === 0}
        continueLabel="Continue"
        next={continueSetup}
        pending={pending}
      />
    </div>
  );
}

function VerifyEmailStep({
  back,
  check,
  checkError,
  checkFailed,
  email,
  pending,
  resend,
  resendPending,
  resendSucceeded,
}: {
  back: () => void;
  check: () => void;
  checkError: Error | null;
  checkFailed: boolean;
  email: string;
  pending: boolean;
  resend: () => void;
  resendPending: boolean;
  resendSucceeded: boolean;
}) {
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="verify_email" tabIndex={-1}>
          Verify your email
        </h1>
        <p>
          Open the link sent to <strong>{email}</strong>.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            Verify this address before connecting Google or Apple accounts.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button disabled={resendPending} onClick={resend} variant="outline">
            {resendPending ? "Sending" : "Send another email"}
          </Button>
          {resendSucceeded ? <span className="setup-note">Email sent.</span> : null}
        </CardFooter>
      </Card>
      {checkFailed ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>Still waiting for verification</AlertTitle>
          <AlertDescription>Open the link in your inbox, then check again.</AlertDescription>
        </Alert>
      ) : null}
      {checkError ? (
        <Alert variant="destructive">
          <ShieldCheck />
          <AlertTitle>Verification could not be checked</AlertTitle>
          <AlertDescription>{errorMessage(checkError)}</AlertDescription>
        </Alert>
      ) : null}
      <SetupFooter
        back={back}
        continueLabel={pending ? "Checking" : "I’ve verified"}
        next={check}
        pending={pending}
      />
    </div>
  );
}

function GoogleStep({
  accounts,
  back,
  continueSetup,
  onConnected,
  pending,
  selectedWorkspaces,
}: {
  accounts: Array<{
    calendarEnabled: boolean;
    email: string | null;
    id: string;
    label: string;
    mailEnabled: boolean;
  }>;
  back: () => void;
  continueSetup: () => void;
  onConnected: () => void;
  pending: boolean;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  const [calendar, setCalendar] = useState(selectedWorkspaces.includes("calendar"));
  const [mail, setMail] = useState(selectedWorkspaces.includes("mail"));
  const connect = useMutation({
    mutationFn: async () => {
      const url = await api.getGoogleAuthorizationUrl({
        returnTo: "/setup",
        services: [
          ...(calendar ? (["calendar"] as const) : []),
          ...(mail ? (["mail"] as const) : []),
        ],
      });
      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } else {
        window.location.assign(url);
      }
    },
  });
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="google" tabIndex={-1}>
          Connect your Google accounts
        </h1>
        <p>Choose what each account contributes. Add as many as you use.</p>
      </div>
      <ConnectionAuthorizationOutcome
        onConnected={onConnected}
        onRetry={() => connect.mutate()}
      />
      <ConnectedAccounts accounts={accounts} />
      <Card>
        <CardHeader>
          <CardTitle>
            {accounts.length ? "Add another Google account" : "Google services"}
          </CardTitle>
          <CardDescription>ilo requests only the services selected here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceChoices
            calendar={calendar}
            mail={mail}
            prefix="google"
            setCalendar={setCalendar}
            setMail={setMail}
          />
        </CardContent>
        <CardFooter>
          <Button
            disabled={(!calendar && !mail) || connect.isPending}
            onClick={() => connect.mutate()}
          >
            {connect.isPending
              ? "Opening Google"
              : accounts.length
                ? "Add Google account"
                : "Connect Google"}
          </Button>
        </CardFooter>
      </Card>
      {connect.isError ? (
        <Alert variant="destructive">
          <Cloud />
          <AlertTitle>Google did not open</AlertTitle>
          <AlertDescription>{errorMessage(connect.error)}</AlertDescription>
        </Alert>
      ) : null}
      <SetupFooter
        back={back}
        continueLabel={accounts.length ? "Continue" : "Skip Google"}
        next={continueSetup}
        pending={pending}
      />
    </div>
  );
}

function ICloudStep({
  accounts,
  back,
  continueSetup,
  pending,
  selectedWorkspaces,
}: {
  accounts: Array<{
    calendarEnabled: boolean;
    email: string | null;
    id: string;
    label: string;
    mailEnabled: boolean;
  }>;
  back: () => void;
  continueSetup: () => void;
  pending: boolean;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  const [calendar, setCalendar] = useState(selectedWorkspaces.includes("calendar"));
  const [mail, setMail] = useState(selectedWorkspaces.includes("mail"));
  const [showForm, setShowForm] = useState(accounts.length === 0);
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: (form: FormData) =>
      api.connectICloud({
        appSpecificPassword: String(form.get("appSpecificPassword")),
        calendar,
        email: String(form.get("appleAccountEmail")),
        mail,
      }),
    onSuccess: () => {
      setShowForm(false);
      return queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    connect.mutate(new FormData(event.currentTarget));
  };
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="icloud" tabIndex={-1}>
          Connect your Apple accounts
        </h1>
        <p>Use an app-specific password for Calendar, Mail, or both.</p>
      </div>
      <ConnectedAccounts accounts={accounts} />
      {!showForm ? (
        <Button onClick={() => setShowForm(true)} variant="outline">
          Add another Apple account
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Apple Account</CardTitle>
            <CardDescription>
              Your app-specific password is encrypted and can be revoked from Apple.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="setup-icloud-form" onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="setup-icloud-email">Apple Account email</FieldLabel>
                  <Input
                    autoCapitalize="none"
                    autoComplete="off"
                    id="setup-icloud-email"
                    name="appleAccountEmail"
                    placeholder="name@icloud.com"
                    required
                    spellCheck={false}
                    type="email"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="setup-icloud-password">App-specific password</FieldLabel>
                  <Input
                    autoComplete="new-password"
                    id="setup-icloud-password"
                    name="appSpecificPassword"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    required
                    type="password"
                  />
                  <FieldDescription>
                    <a
                      href="https://account.apple.com/account/manage"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Create one with Apple <ExternalLink aria-hidden="true" />
                    </a>
                  </FieldDescription>
                </Field>
                <ServiceChoices
                  calendar={calendar}
                  mail={mail}
                  prefix="icloud"
                  setCalendar={setCalendar}
                  setMail={setMail}
                />
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter>
            <Button
              disabled={(!calendar && !mail) || connect.isPending}
              form="setup-icloud-form"
              type="submit"
            >
              {connect.isPending ? "Connecting Apple" : "Connect Apple"}
            </Button>
          </CardFooter>
        </Card>
      )}
      {connect.isError ? (
        <Alert variant="destructive">
          <Cloud />
          <AlertTitle>Apple did not connect</AlertTitle>
          <AlertDescription>{errorMessage(connect.error)}</AlertDescription>
        </Alert>
      ) : null}
      <SetupFooter
        back={back}
        continueLabel={accounts.length ? "Continue" : "Skip Apple"}
        next={continueSetup}
        pending={pending}
      />
    </div>
  );
}

function FinancesStep({
  accounts,
  back,
  continueSetup,
  pending,
  refresh,
}: {
  accounts: Array<{ id: string; institution: string; name: string }>;
  back: () => void;
  continueSetup: () => void;
  pending: boolean;
  refresh: () => Promise<unknown>;
}) {
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="finances" tabIndex={-1}>
          Connect the accounts you track
        </h1>
        <p>Plaid provides read-only account and transaction data.</p>
      </div>
      {accounts.length ? (
        <ItemGroup>
          {accounts.map((account) => (
            <Item key={account.id} variant="outline">
              <ItemMedia variant="icon">
                <Banknote />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{account.name}</ItemTitle>
                <ItemDescription>{account.institution}</ItemDescription>
              </ItemContent>
              <Badge variant="secondary">Connected</Badge>
            </Item>
          ))}
        </ItemGroup>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>
            {accounts.length ? "Connect another institution" : "Connect with Plaid"}
          </CardTitle>
          <CardDescription>
            You choose the accounts after selecting an institution. ilo cannot move money.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <PlaidConnectButton
            label={accounts.length ? "Add institution" : "Connect bank"}
            onConnected={refresh}
          />
        </CardFooter>
      </Card>
      <p className="setup-note">Manual accounts and imports remain available in Finances.</p>
      <SetupFooter
        back={back}
        continueLabel={accounts.length ? "Continue" : "Skip finances"}
        next={continueSetup}
        pending={pending}
      />
    </div>
  );
}

function ReadyStep({
  complete,
  connectAgent,
  connectedAccounts,
  financeAccounts,
  pending,
  review,
  selectedWorkspaces,
}: {
  complete: () => void;
  connectAgent: () => void;
  connectedAccounts: number;
  financeAccounts: number;
  pending: boolean;
  review: () => void;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  return (
    <div className="setup-step setup-step--ready">
      <div className="setup-step__heading">
        <span className="setup-ready-mark">
          <CheckCircle2 aria-hidden="true" />
        </span>
        <h1 data-setup-step="ready" tabIndex={-1}>
          Your workspace is ready.
        </h1>
        <p>Start using ilo now. Connections and setup stay available in Settings.</p>
      </div>
      <ItemGroup>
        <Item>
          <ItemContent>
            <ItemTitle>Workspaces</ItemTitle>
            <ItemDescription>
              {selectedWorkspaces.map(workspaceLabel).join(", ") || "Local workspace"}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item>
          <ItemContent>
            <ItemTitle>Connected sources</ItemTitle>
            <ItemDescription>
              {connectedAccounts + financeAccounts
                ? `${connectedAccounts + financeAccounts} account${connectedAccounts + financeAccounts === 1 ? "" : "s"} connected`
                : "None yet—you can connect them later"}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item>
          <ItemContent>
            <ItemTitle>Agent access</ItemTitle>
            <ItemDescription>
              Ready when you connect Ilo from an MCP-compatible agent host.
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <div className="setup-footer">
        <Button disabled={pending} onClick={review} variant="ghost">
          <ArrowLeft data-icon="inline-start" />
          Review setup
        </Button>
        <div className="setup-footer__actions">
          <Button disabled={pending} onClick={complete} variant="outline">
            Open Today
          </Button>
          <Button disabled={pending} onClick={connectAgent} size="lg">
            Connect an agent
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConnectedAccounts({
  accounts,
}: {
  accounts: Array<{
    calendarEnabled: boolean;
    email: string | null;
    id: string;
    label: string;
    mailEnabled: boolean;
  }>;
}) {
  if (!accounts.length) return null;
  return (
    <ItemGroup>
      {accounts.map((account) => (
        <Item key={account.id} variant="outline">
          <ItemMedia variant="icon">
            <Cloud />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{account.email ?? account.label}</ItemTitle>
            <ItemDescription>
              {[account.calendarEnabled ? "Calendar" : null, account.mailEnabled ? "Mail" : null]
                .filter(Boolean)
                .join(" · ")}
            </ItemDescription>
          </ItemContent>
          <Badge variant="secondary">Connected</Badge>
        </Item>
      ))}
    </ItemGroup>
  );
}

function ServiceChoices({
  calendar,
  mail,
  prefix,
  setCalendar,
  setMail,
}: {
  calendar: boolean;
  mail: boolean;
  prefix: string;
  setCalendar: (checked: boolean) => void;
  setMail: (checked: boolean) => void;
}) {
  const values = [
    ...(calendar ? (["calendar"] as const) : []),
    ...(mail ? (["mail"] as const) : []),
  ];
  return (
    <CheckboxCardGroup
      aria-label="Services to connect"
      className={`setup-service-options setup-service-options--${prefix}`}
      onValuesChange={(nextValues) => {
        setCalendar(nextValues.includes("calendar"));
        setMail(nextValues.includes("mail"));
      }}
      options={[
        {
          description: "Read and edit the calendars you select.",
          icon: <CalendarDays />,
          label: "Calendar",
          value: "calendar",
        },
        {
          description: "Read, organize, draft, and send mail.",
          icon: <Mail />,
          label: "Mail",
          value: "mail",
        },
      ]}
      values={values}
    />
  );
}

function SetupFooter({
  back,
  continueDisabled = false,
  continueLabel,
  next,
  pending,
}: {
  back: () => void;
  continueDisabled?: boolean;
  continueLabel: string;
  next: () => void;
  pending: boolean;
}) {
  return (
    <div className="setup-footer">
      <Button disabled={pending} onClick={back} variant="ghost">
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
      <Button disabled={pending || continueDisabled} onClick={next}>
        {continueLabel}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}

function workspaceLabel(workspace: AccountSetupWorkspace) {
  return workspaceIdentities[workspace].label;
}
