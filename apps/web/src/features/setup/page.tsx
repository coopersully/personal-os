import type { AccountSetupStep, AccountSetupWorkspace, User } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { BRAND_NAME } from "@/brand";
import { CheckboxCardGroup } from "@/components/checkbox-card-group";
import {
  CalendarIcon,
  CheckIcon,
  CircleCheckIcon,
  CloudIcon,
  ExternalLinkIcon,
  MailIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogActions,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { type WorkspaceId, workspaceIdentities } from "@/components/workspace-identity";
import { api, errorMessage } from "../../api.js";
import { ConnectionAuthorizationOutcome } from "../connections/authorization-outcome.js";
import { PlaidConnectButton } from "../finances/plaid-connect.js";
import { ConnectionList } from "./connection-list.js";
import { ProviderConnectionStep } from "./provider-connection-step.js";
import { SetupFrame } from "./setup-frame.js";
import { WorkspaceSetupGrid } from "./workspace-setup-grid.js";

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
  const stageRef = useRef<HTMLDivElement>(null);
  const providerContinueRef = useRef<() => void>(() => undefined);
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
  const registerProviderContinue = useCallback((handler: () => void) => {
    providerContinueRef.current = handler;
  }, []);
  const back =
    currentStep === "welcome"
      ? undefined
      : () => {
          if (currentStep === "workspaces") progress("welcome");
          else if (currentStep === "verify_email") progress("workspaces");
          else if (currentStep === "ready") {
            progress(adjacentStep("ready", selectedWorkspaces, user.emailVerified, -1));
          } else {
            progress(adjacentStep(currentStep, selectedWorkspaces, user.emailVerified, -1));
          }
        };
  const forward =
    currentStep === "ready"
      ? undefined
      : () => {
          if (currentStep === "welcome") progress("workspaces");
          else if (currentStep === "workspaces") {
            progress(
              adjacentStep("workspaces", selectedWorkspaces, user.emailVerified, 1),
              selectedWorkspaces,
            );
          } else if (currentStep === "verify_email") checkVerification.mutate();
          else providerContinueRef.current();
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
    <SetupFrame
      back={back}
      continueDisabled={currentStep === "workspaces" && selectedWorkspaces.length === 0}
      currentStep={stepIndex + 1}
      exit={exitSetup}
      forward={forward}
      pending={save.isPending || (currentStep === "verify_email" && checkVerification.isPending)}
      totalSteps={steps.length}
    >
      <div className="setup-stage__content" key={currentStep} ref={stageRef}>
        {currentStep === "welcome" ? <WelcomeStep displayName={user.displayName} /> : null}
        {currentStep === "workspaces" ? (
          <WorkspacesStep selected={selectedWorkspaces} setSelected={setSelectedWorkspaces} />
        ) : null}
        {currentStep === "verify_email" ? (
          <VerifyEmailStep
            checkError={checkVerification.error}
            checkFailed={
              checkVerification.isSuccess && checkVerification.data.emailVerified === false
            }
            email={user.email}
            resend={() => resendVerification.mutate()}
            resendPending={resendVerification.isPending}
            resendSucceeded={resendVerification.isSuccess}
          />
        ) : null}
        {currentStep === "google" ? (
          <GoogleStep
            accounts={connectors.data?.filter((account) => account.provider === "google") ?? []}
            continueSetup={() => progress(adjacentStep("google", selectedWorkspaces, true, 1))}
            onConnected={() => void connectors.refetch()}
            registerContinue={registerProviderContinue}
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {currentStep === "icloud" ? (
          <ICloudStep
            accounts={connectors.data?.filter((account) => account.provider === "icloud") ?? []}
            continueSetup={() => progress(adjacentStep("icloud", selectedWorkspaces, true, 1))}
            registerContinue={registerProviderContinue}
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {currentStep === "finances" ? (
          <FinancesStep
            accounts={finances.data?.accounts ?? []}
            continueSetup={() => progress("ready")}
            registerContinue={registerProviderContinue}
            refresh={() => queryClient.invalidateQueries({ queryKey: ["finance-overview"] })}
          />
        ) : null}
        {currentStep === "ready" ? (
          <ReadyStep
            complete={() => completeSetup()}
            connectAgent={() => completeSetup("/settings?section=agent-connections")}
            connectedAccounts={connectors.data?.length ?? 0}
            financeAccounts={finances.data?.accounts.length ?? 0}
            pending={save.isPending}
            selectedWorkspaces={selectedWorkspaces}
          />
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <ShieldCheckIcon />
            <AlertTitle>Setup progress was not saved</AlertTitle>
            <AlertDescription>{errorMessage(save.error)}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </SetupFrame>
  );
}

function WelcomeStep({ displayName }: { displayName: string }) {
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
            <CheckIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>You choose the sources</ItemTitle>
            <ItemDescription>Connect only the accounts and services you want.</ItemDescription>
          </ItemContent>
        </Item>
        <Item>
          <ItemMedia variant="icon">
            <ShieldCheckIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>You stay in control</ItemTitle>
            <ItemDescription>No agent gets access during setup.</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </div>
  );
}

function WorkspacesStep({
  selected,
  setSelected,
}: {
  selected: AccountSetupWorkspace[];
  setSelected: (selected: AccountSetupWorkspace[]) => void;
}) {
  return (
    <div className="setup-step">
      <div className="setup-step__heading">
        <h1 data-setup-step="workspaces" tabIndex={-1}>
          What should {BRAND_NAME} help with?
        </h1>
        <p>You can always add more later.</p>
      </div>
      <WorkspaceSetupGrid
        onValuesChange={setSelected}
        options={workspaceOptions}
        values={selected}
      />
    </div>
  );
}

function VerifyEmailStep({
  checkError,
  checkFailed,
  email,
  resend,
  resendPending,
  resendSucceeded,
}: {
  checkError: Error | null;
  checkFailed: boolean;
  email: string;
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
          <ShieldCheckIcon />
          <AlertTitle>Still waiting for verification</AlertTitle>
          <AlertDescription>Open the link in your inbox, then check again.</AlertDescription>
        </Alert>
      ) : null}
      {checkError ? (
        <Alert variant="destructive">
          <ShieldCheckIcon />
          <AlertTitle>Verification could not be checked</AlertTitle>
          <AlertDescription>{errorMessage(checkError)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function GoogleStep({
  accounts,
  continueSetup,
  onConnected,
  registerContinue,
  selectedWorkspaces,
}: {
  accounts: Array<{
    calendarEnabled: boolean;
    email: string | null;
    id: string;
    label: string;
    mailEnabled: boolean;
  }>;
  continueSetup: () => void;
  onConnected: () => void;
  registerContinue: (handler: () => void) => void;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  const [calendar, setCalendar] = useState(selectedWorkspaces.includes("calendar"));
  const [mail, setMail] = useState(selectedWorkspaces.includes("mail"));
  const [addOpen, setAddOpen] = useState(false);
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
    <ProviderConnectionStep
      accountCount={accounts.length}
      confirmation="You haven’t added a Google account. Continue without one?"
      confirmLabel="Continue without Google"
      continueSetup={continueSetup}
      registerContinue={registerContinue}
    >
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
        <ConnectionList
          addLabel={accounts.length ? "Add another Google account" : "Add a Google account"}
          connections={accounts.map((account) => ({
            description:
              [account.calendarEnabled ? "Calendar" : null, account.mailEnabled ? "Mail" : null]
                .filter(Boolean)
                .join(" · ") || "Connected",
            id: account.id,
            label: account.email ?? account.label,
          }))}
          emptyText="No Google accounts connected"
          mark="google"
          onAdd={() => setAddOpen(true)}
        />
        <ResponsiveDialog onOpenChange={setAddOpen} open={addOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {accounts.length ? "Add another Google account" : "Add a Google account"}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Choose what this account contributes to {BRAND_NAME}.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <ServiceChoices
                calendar={calendar}
                mail={mail}
                prefix="google"
                setCalendar={setCalendar}
                setMail={setMail}
              />
              {connect.isError ? (
                <Alert variant="destructive">
                  <CloudIcon />
                  <AlertTitle>Google did not open</AlertTitle>
                  <AlertDescription>{errorMessage(connect.error)}</AlertDescription>
                </Alert>
              ) : null}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <ResponsiveDialogActions>
                <ResponsiveDialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </ResponsiveDialogClose>
                <Button
                  disabled={(!calendar && !mail) || connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  {connect.isPending ? "Opening Google" : "Connect Google"}
                </Button>
              </ResponsiveDialogActions>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </ProviderConnectionStep>
  );
}

function ICloudStep({
  accounts,
  continueSetup,
  registerContinue,
  selectedWorkspaces,
}: {
  accounts: Array<{
    calendarEnabled: boolean;
    email: string | null;
    id: string;
    label: string;
    mailEnabled: boolean;
  }>;
  continueSetup: () => void;
  registerContinue: (handler: () => void) => void;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  const [calendar, setCalendar] = useState(selectedWorkspaces.includes("calendar"));
  const [mail, setMail] = useState(selectedWorkspaces.includes("mail"));
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: (form: FormData) =>
      api.connectICloud({
        appSpecificPassword: String(form.get("appSpecificPassword")),
        calendar,
        email: String(form.get("appleAccountEmail")),
        mail,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["connectors"] });
      setAddOpen(false);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    connect.mutate(new FormData(event.currentTarget));
  };
  return (
    <ProviderConnectionStep
      accountCount={accounts.length}
      confirmation="You haven’t added an Apple account. Continue without one?"
      confirmLabel="Continue without Apple"
      continueSetup={continueSetup}
      registerContinue={registerContinue}
    >
      <div className="setup-step">
        <div className="setup-step__heading">
          <h1 data-setup-step="icloud" tabIndex={-1}>
            Connect your Apple accounts
          </h1>
          <p>Use an app-specific password for Calendar, Mail, or both.</p>
        </div>
        <ConnectionList
          addLabel={accounts.length ? "Add another Apple account" : "Add an Apple account"}
          connections={accounts.map((account) => ({
            description:
              [account.calendarEnabled ? "Calendar" : null, account.mailEnabled ? "Mail" : null]
                .filter(Boolean)
                .join(" · ") || "Connected",
            id: account.id,
            label: account.email ?? account.label,
          }))}
          emptyText="No Apple accounts connected"
          mark="apple"
          onAdd={() => setAddOpen(true)}
        />
        <ResponsiveDialog onOpenChange={setAddOpen} open={addOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>
                {accounts.length ? "Add another Apple account" : "Add an Apple account"}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Use an app-specific password you can revoke from Apple.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
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
                        Create one with Apple <ExternalLinkIcon aria-hidden="true" />
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
              {connect.isError ? (
                <Alert variant="destructive">
                  <CloudIcon />
                  <AlertTitle>Apple did not connect</AlertTitle>
                  <AlertDescription>{errorMessage(connect.error)}</AlertDescription>
                </Alert>
              ) : null}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <ResponsiveDialogActions>
                <ResponsiveDialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </ResponsiveDialogClose>
                <Button
                  disabled={(!calendar && !mail) || connect.isPending}
                  form="setup-icloud-form"
                  type="submit"
                >
                  {connect.isPending ? "Connecting Apple" : "Connect Apple"}
                </Button>
              </ResponsiveDialogActions>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </ProviderConnectionStep>
  );
}

function FinancesStep({
  accounts,
  continueSetup,
  registerContinue,
  refresh,
}: {
  accounts: Array<{ id: string; institution: string; name: string }>;
  continueSetup: () => void;
  registerContinue: (handler: () => void) => void;
  refresh: () => Promise<unknown>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const connected = async () => {
    await refresh();
    setAddOpen(false);
  };
  return (
    <ProviderConnectionStep
      accountCount={accounts.length}
      confirmation="You haven’t added a financial institution. Continue without one?"
      confirmLabel="Continue without finances"
      continueSetup={continueSetup}
      registerContinue={registerContinue}
    >
      <div className="setup-step">
        <div className="setup-step__heading">
          <h1 data-setup-step="finances" tabIndex={-1}>
            Connect the accounts you track
          </h1>
          <p>Plaid provides read-only account and transaction data.</p>
        </div>
        <ConnectionList
          addLabel={accounts.length ? "Add another institution" : "Add a financial institution"}
          connections={accounts.map((account) => ({
            description: account.institution,
            id: account.id,
            label: account.name,
          }))}
          emptyText="No financial institutions connected"
          mark="plaid"
          onAdd={() => setAddOpen(true)}
        />
        <p className="setup-note">Manual accounts and imports remain available in Finances.</p>
        <ResponsiveDialog onOpenChange={setAddOpen} open={addOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Add a financial institution</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Choose the accounts after selecting an institution. {BRAND_NAME} cannot move money.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <p className="setup-note">Plaid provides read-only account and transaction data.</p>
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <ResponsiveDialogActions>
                <ResponsiveDialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </ResponsiveDialogClose>
                <PlaidConnectButton label="Connect with Plaid" onConnected={connected} />
              </ResponsiveDialogActions>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </ProviderConnectionStep>
  );
}

function ReadyStep({
  complete,
  connectAgent,
  connectedAccounts,
  financeAccounts,
  pending,
  selectedWorkspaces,
}: {
  complete: () => void;
  connectAgent: () => void;
  connectedAccounts: number;
  financeAccounts: number;
  pending: boolean;
  selectedWorkspaces: AccountSetupWorkspace[];
}) {
  return (
    <div className="setup-step setup-step--ready">
      <div className="setup-step__heading">
        <span className="setup-ready-mark">
          <CircleCheckIcon aria-hidden="true" />
        </span>
        <h1 data-setup-step="ready" tabIndex={-1}>
          Your workspace is ready.
        </h1>
        <p>Start using {BRAND_NAME} now. Connections and setup stay available in Settings.</p>
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
            <ItemTitle>Connected agents</ItemTitle>
            <ItemDescription>
              Ready when you connect {BRAND_NAME} from an MCP-compatible agent host.
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <div className="setup-ready-actions">
        <Button className="w-full" disabled={pending} onClick={complete} size="lg">
          Today at a Glance
        </Button>
        <Button
          className="w-full"
          disabled={pending}
          onClick={connectAgent}
          size="lg"
          variant="secondary"
        >
          Connect an Agent
        </Button>
      </div>
    </div>
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
          icon: <CalendarIcon />,
          label: "Calendar",
          value: "calendar",
        },
        {
          description: "Read, organize, draft, and send mail.",
          icon: <MailIcon />,
          label: "Mail",
          value: "mail",
        },
      ]}
      values={values}
    />
  );
}

function workspaceLabel(workspace: AccountSetupWorkspace) {
  return workspaceIdentities[workspace].label;
}
