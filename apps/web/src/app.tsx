import type { CalendarAccount, Session, XBookmarkAccount } from "@personal-os/api-client";
import type {
  Calendar,
  CalendarEvent,
  DailyBrief,
  Goal,
  HomeLocation,
  Invitation,
  LocalDate,
  PinterestPin,
  PinterestWallpaperSettings,
  Reminder,
  Task,
  Theme,
  User,
  WeatherCoordinates,
  WeatherLocationOption,
  WeatherSnapshot,
} from "@personal-os/domain";
import {
  addLocalDays,
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  localDateToIso,
  parseLocalDate,
  sameLocalDate,
} from "@personal-os/domain";
import { Badge, Button, EmptyState, Input, Label, Spinner } from "@personal-os/ui";
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  type FormEvent,
  lazy,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  Suspense,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import {
  EmailField,
  InviteCodeField,
  isValidEmailAddress,
  isValidPassword,
  PasswordFields,
  TextField,
} from "@/components/auth-fields";
import { BrandMark, brandTitle, hasBrandMark, NohmiBrandMark } from "@/components/brand-marks";
import { ChoiceCardGroup } from "@/components/choice-card-group";
import {
  EventCard,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardPrimaryAction,
  EventCardTitle,
  EventCardTitleMeta,
} from "@/components/event-card";
import {
  ActivityIcon,
  BankIcon,
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  CloudIcon,
  ColumnsIcon,
  CompassIcon,
  CopyIcon,
  CopyPlusIcon,
  EditIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  GridIcon,
  HouseIcon,
  type Icon,
  ImageIcon,
  KeyIcon,
  LayersIcon,
  ListChecksIcon,
  ListTodoIcon,
  LocationFixedIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  MapPinIcon,
  MonitorIcon,
  MoonIcon,
  PaintBrushIcon,
  PinIcon,
  PlugIcon,
  PlusIcon,
  PulseIcon,
  RefreshIcon,
  ScissorsIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  TargetIcon,
  TrashIcon,
  UserCircleIcon,
  UserIcon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from "@/components/icons";
import { LogoMark } from "@/components/logo-mark";
import { OccasionCard } from "@/components/occasion-card";
import { OfflineState } from "@/components/offline-state";
import { QuoteCard } from "@/components/quote-card";
import { TodayWorkspaceIcon, todayWeatherIcon } from "@/components/today-workspace-icon";
import {
  Alert as ShadcnAlert,
  AlertAction as ShadcnAlertAction,
  AlertDescription as ShadcnAlertDescription,
  AlertTitle as ShadcnAlertTitle,
} from "@/components/ui/alert";
import {
  Avatar as ShadcnAvatar,
  AvatarBadge as ShadcnAvatarBadge,
  AvatarFallback as ShadcnAvatarFallback,
  AvatarGroup as ShadcnAvatarGroup,
  AvatarImage as ShadcnAvatarImage,
} from "@/components/ui/avatar";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  Card as ShadcnCard,
  CardAction as ShadcnCardAction,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from "@/components/ui/card";
import { Checkbox as ShadcnCheckbox } from "@/components/ui/checkbox";
import {
  Collapsible as ShadcnCollapsible,
  CollapsibleContent as ShadcnCollapsibleContent,
  CollapsibleTrigger as ShadcnCollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field as ShadcnField,
  FieldContent as ShadcnFieldContent,
  FieldDescription as ShadcnFieldDescription,
  FieldGroup as ShadcnFieldGroup,
  FieldLabel as ShadcnFieldLabel,
  FieldLegend as ShadcnFieldLegend,
  FieldSet as ShadcnFieldSet,
} from "@/components/ui/field";
import { Input as ShadcnInput } from "@/components/ui/input";
import {
  Item as ShadcnItem,
  ItemActions as ShadcnItemActions,
  ItemContent as ShadcnItemContent,
  ItemDescription as ShadcnItemDescription,
  ItemGroup as ShadcnItemGroup,
  ItemMedia as ShadcnItemMedia,
  ItemTitle as ShadcnItemTitle,
} from "@/components/ui/item";
import {
  NativeSelectOption,
  NativeSelect as ShadcnNativeSelect,
} from "@/components/ui/native-select";
import {
  Pagination as ShadcnPagination,
  PaginationContent as ShadcnPaginationContent,
  PaginationItem as ShadcnPaginationItem,
  PaginationLink as ShadcnPaginationLink,
  PaginationNext as ShadcnPaginationNext,
  PaginationPrevious as ShadcnPaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover as ShadcnPopover,
  PopoverContent as ShadcnPopoverContent,
  PopoverDescription as ShadcnPopoverDescription,
  PopoverHeader as ShadcnPopoverHeader,
  PopoverTitle as ShadcnPopoverTitle,
  PopoverTrigger as ShadcnPopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea as ShadcnScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarContent as ShadcnSidebarContent,
  SidebarFooter as ShadcnSidebarFooter,
  SidebarGroup as ShadcnSidebarGroup,
  SidebarGroupContent as ShadcnSidebarGroupContent,
  SidebarGroupLabel as ShadcnSidebarGroupLabel,
  SidebarHeader as ShadcnSidebarHeader,
  SidebarMenu as ShadcnSidebarMenu,
  SidebarMenuBadge as ShadcnSidebarMenuBadge,
  SidebarMenuButton as ShadcnSidebarMenuButton,
  SidebarMenuItem as ShadcnSidebarMenuItem,
  SidebarProvider as ShadcnSidebarProvider,
} from "@/components/ui/sidebar";
import { Slider as ShadcnSlider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { Switch as ShadcnSwitch } from "@/components/ui/switch";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import {
  ToggleGroup as ShadcnToggleGroup,
  ToggleGroupItem as ShadcnToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionAuthorizationOutcome } from "@/features/connections/authorization-outcome";
import { api, errorMessage, isUnauthorized } from "./api.js";
import { scrollTimelineToMinute } from "./calendar-timeline.js";
import { InlineError, PageLoading } from "./components/async-state.js";
import { MobileWorkspaceDock } from "./components/mobile-workspace-dock.js";
import { WorkspaceAppBar } from "./components/workspace-app-bar.js";
import { WorkspaceIcon, workspaceIdForPath } from "./components/workspace-identity.js";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarContent,
} from "./components/workspace-secondary-app-bar.js";
import { ActivityPage, ActivityTopbarControls } from "./features/activity/page.js";
import { CalendarFloatingNav } from "./features/calendar/floating-nav.js";
import {
  type CalendarView,
  calendarPeriodDays,
  calendarQueryKeys,
  calendarViewFromSearch,
} from "./features/calendar/page.js";
import { CalendarStewardshipPage } from "./features/calendar/stewardship-page.js";
import {
  ConnectionHealthBadge,
  ConnectionHealthDescription,
  connectionHealth,
  visibleConnectorRefreshInterval,
} from "./features/connections/health.js";
import {
  FinanceSidebarNavigation,
  financeSectionFromPath,
} from "./features/finances/navigation.js";
import { FinancesPage } from "./features/finances/page.js";
import { FinanceSettings } from "./features/finances/settings.js";
import {
  MailPage as MailFeaturePage,
  MailSidebar as MailFeatureSidebar,
  MailTopbarSearch,
} from "./features/mail/mail.js";
import {
  ReminderRow,
  RemindersCreateButton,
  RemindersPage,
  RemindersTopbarControls,
} from "./features/reminders/page.js";
import { ReviewsPage } from "./features/reviews/page.js";
import {
  ConnectedAgentsSettings,
  useWorkspaceSettingsActions,
  WorkspaceAccessSettings,
  WorkspaceSettings,
  type WorkspaceSettingsActions,
} from "./features/settings/agent-access.js";
import { settingsNavigationItem } from "./features/settings/manifest.js";
import {
  TaskRow,
  TasksCreateButton,
  TasksPage,
  TasksSidebar,
  TasksTopbarControls,
} from "./features/tasks/page.js";
import { TaskDialog } from "./features/tasks/task-dialog.js";
import { textingSettingsNavigationItem } from "./features/texting/manifest.js";
import { TextingSettings } from "./features/texting/page.js";
import { formatMaterialDateTime, formatOrdinalDate } from "./lib/date-format.js";
import { invalidateMaterial } from "./lib/material-queries.js";
import { formatRelativeTime } from "./lib/time-format.js";
import { cn } from "./lib/utils.js";
import {
  navigationOwnerForLocation,
  rendersApplicationShell,
  type WorkspaceDefinition,
  workspaceDefinitions,
  workspaceForLocation,
} from "./navigation/manifest.js";
import type { MobileWorkspacePage } from "./navigation/mobile-workspace-dock.js";
import { timeToMinute } from "./time.js";

type Editor =
  | { kind: "calendar" }
  | { draft?: EventDraft; event?: CalendarEvent; kind: "event"; mode?: "details" | "edit" }
  | { kind: "reminder"; reminder?: Reminder }
  | { kind: "task"; task?: Task }
  | null;

type CalendarEventMove = { day: LocalDate; event: CalendarEvent; minute: number };
type CalendarDropPreview = {
  dayKey: string;
  duration: number;
  grabOffsetX: number;
  grabOffsetY: number;
  minute: number;
  pointerX: number;
  pointerY: number;
  color: string;
  column: number;
  width: number;
};
type EventDraft = { endsAt: string; startsAt: string };
type CalendarRangeSelection = {
  active: boolean;
  anchorMinute: number;
  currentMinute: number;
  day: LocalDate;
  originClientY: number;
  pointerId: number | null;
};
type CalendarMap = Map<string, Calendar>;
type ContextSidebarMode = "finances" | "mail" | "settings" | "tasks" | null;

const calendarViews: Array<{ icon: Icon; label: string; value: CalendarView }> = [
  { icon: CalendarIcon, label: "Day", value: "day" },
  { icon: ColumnsIcon, label: "Week", value: "week" },
  { icon: GridIcon, label: "Month", value: "month" },
];

const RichEventNotes = lazy(() => import("./rich-event-notes.js"));
const SetupPage = lazy(() =>
  import("./features/setup/page.js").then((module) => ({ default: module.SetupPage })),
);

const calendarHourHeight = 48;
const calendarMinutesPerDay = 24 * 60;
const calendarTimelineHeight = 24 * calendarHourHeight;
const calendarTimeMarks = Array.from({ length: 48 }, (_, index) => index * 30);
const calendarDragType = "application/x-personal-os-calendar-event";
const calendarDragOffsetType = "application/x-personal-os-calendar-grab-offset-y";
const calendarDragOffsets = new Map<string, number>();
const calendarDragMetrics = new Map<
  string,
  { color: string; grabOffsetX: number; grabOffsetY: number; width: number }
>();

type NavigationItemDefinition = {
  badge?: number | string;
  icon: Icon;
  items?: NavigationItemDefinition[];
  label: string;
  path: string;
};

type WorkspaceTransitionDirection = "down" | "none" | "up";

const workspaceShortcuts: WorkspaceDefinition[] = workspaceDefinitions;

const accountNavigationItems: NavigationItemDefinition[] = [
  { icon: SparklesIcon, label: "Setup", path: "/setup" },
  settingsNavigationItem,
];

function workspaceForPath(pathname: string): WorkspaceDefinition | undefined {
  return workspaceForLocation(pathname);
}

function normalizeShellPathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function workspaceDirection(
  fromPath: string | null | undefined,
  toPath: string,
): WorkspaceTransitionDirection {
  const fromIndex = workspaceShortcuts.findIndex((workspace) => workspace.path === fromPath);
  const toIndex = workspaceShortcuts.findIndex((workspace) => workspace.path === toPath);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return "none";
  return toIndex > fromIndex ? "down" : "up";
}

export function selectTodayTasks(
  tasks: Task[],
  current: Date,
  timeZone: string,
): { overdue: Task[]; today: Task[] } {
  const today = localDateAt(current, timeZone);
  const overdue: Task[] = [];
  const relevantToday: Task[] = [];
  for (const task of tasks) {
    if (task.lifecycle !== "open" || task.deletedAt !== null) continue;
    if (task.dueAt !== null && new Date(task.dueAt).getTime() < current.getTime()) {
      overdue.push(task);
      continue;
    }
    const dueToday =
      task.dueAt !== null && sameLocalDate(localDateAt(new Date(task.dueAt), timeZone), today);
    const scheduledToday =
      task.scheduledAt !== null &&
      sameLocalDate(localDateAt(new Date(task.scheduledAt), timeZone), today);
    if (dueToday || scheduledToday) relevantToday.push(task);
  }
  return { overdue, today: relevantToday };
}
export function App() {
  const me = useQuery({ queryFn: api.getMe, queryKey: ["me"] });
  if (me.isPending) {
    return (
      <main className="center-screen">
        <Spinner label="Opening nohmi" />
      </main>
    );
  }
  if (me.isError && isUnauthorized(me.error)) return <AuthScreen />;
  if (me.isError) return <FatalState error={me.error} />;
  return (
    <TooltipProvider>
      <AuthenticatedExperience user={me.data} />
    </TooltipProvider>
  );
}

function AuthenticatedExperience({ user }: { user: User }) {
  useDocumentTheme(user.theme);
  const location = useLocation();
  const verificationToken = new URLSearchParams(location.search).get("verifyEmail");
  if (verificationToken) return <EmailVerificationScreen token={verificationToken} />;
  // A standalone flow owns the whole viewport and must resolve before the
  // redirect that sends unfinished accounts into it, or the redirect chases
  // its own destination and never renders.
  if (!rendersApplicationShell(navigationOwnerForLocation(location.pathname))) {
    return (
      <Suspense
        fallback={
          <main className="center-screen">
            <Spinner label="Opening setup" />
          </main>
        }
      >
        <SetupPage user={user} />
      </Suspense>
    );
  }
  if (user.setup.status === "not_started" || user.setup.status === "in_progress") {
    return <Navigate replace to="/setup" />;
  }
  return (
    <ShadcnSidebarProvider className="contents">
      <AuthenticatedApp user={user} />
    </ShadcnSidebarProvider>
  );
}

type DeviceWeatherLocation = {
  coordinates: WeatherCoordinates | null;
  status: "pending" | "unavailable" | "ready";
};

function useDeviceWeatherLocation(enabled: boolean): DeviceWeatherLocation {
  const [location, setLocation] = useState<DeviceWeatherLocation>({
    coordinates: null,
    status: "pending",
  });
  useEffect(() => {
    if (!enabled) return;
    setLocation({ coordinates: null, status: "pending" });
    if (!("geolocation" in navigator)) {
      setLocation({ coordinates: null, status: "unavailable" });
      return;
    }
    let active = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return;
        setLocation({
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          status: "ready",
        });
      },
      () => {
        if (active) setLocation({ coordinates: null, status: "unavailable" });
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 },
    );
    return () => {
      active = false;
    };
  }, [enabled]);
  return location;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function AuthScreen() {
  useDocumentTheme("system");
  const params = new URLSearchParams(window.location.search);
  const verificationToken = params.get("verifyEmail");
  const passwordResetToken = params.get("resetPassword");
  if (verificationToken) return <EmailVerificationScreen token={verificationToken} />;
  if (passwordResetToken) return <PasswordResetScreen token={passwordResetToken} />;

  return <CredentialsScreen />;
}

function CredentialsScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "recovery" | "register">("login");
  const [inviteBlurred, setInviteBlurred] = useState(false);
  const [credentials, setCredentials] = useState({
    confirmPassword: "",
    displayName: "",
    email: "",
    inviteCode: "",
    password: "",
  });
  const invitationValidation = useMutation({
    mutationFn: (inviteCode: string) => api.validateInvitation({ inviteCode }),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "login") {
        return api.login({ email: credentials.email, password: credentials.password });
      }
      if (mode === "recovery") {
        await api.requestPasswordReset({ email: credentials.email });
        return null;
      }
      return api.register({
        displayName: credentials.displayName,
        email: credentials.email,
        inviteCode: credentials.inviteCode,
        password: credentials.password,
        planningTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onSuccess: (user) => {
      if (user) queryClient.setQueryData(["me"], user);
    },
  });
  const emailValid = isValidEmailAddress(credentials.email);
  const passwordValid = isValidPassword(credentials.password);
  const passwordsMatch =
    credentials.confirmPassword.length > 0 && credentials.password === credentials.confirmPassword;
  const invitationResultIsCurrent =
    invitationValidation.variables === credentials.inviteCode &&
    credentials.inviteCode.length === 8;
  const invitationValid =
    invitationResultIsCurrent &&
    invitationValidation.isSuccess &&
    invitationValidation.data === true;
  const invitationError = !inviteBlurred
    ? undefined
    : credentials.inviteCode.length !== 8
      ? "Enter all eight characters from your invitation."
      : invitationResultIsCurrent && invitationValidation.isError
        ? errorMessage(invitationValidation.error)
        : invitationResultIsCurrent &&
            invitationValidation.isSuccess &&
            invitationValidation.data === false
          ? "This invitation is invalid or expired."
          : undefined;
  const invitationStatus =
    invitationResultIsCurrent && invitationValidation.isPending
      ? "checking"
      : invitationValid
        ? "valid"
        : "idle";
  const canSubmit =
    mode === "login"
      ? emailValid && credentials.password.length > 0
      : mode === "recovery"
        ? emailValid
        : emailValid &&
          credentials.displayName.trim().length > 0 &&
          invitationValid &&
          passwordValid &&
          passwordsMatch;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate();
  };
  const selectMode = (nextMode: "login" | "recovery" | "register") => {
    mutation.reset();
    invitationValidation.reset();
    setInviteBlurred(false);
    setCredentials((current) => ({
      ...current,
      confirmPassword: "",
      inviteCode: "",
      password: "",
    }));
    setMode(nextMode);
  };
  return (
    <main className="auth-shell">
      <div className="auth-crest">
        <NohmiBrandMark auth />
      </div>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form__heading">
            <h2>
              {mode === "login"
                ? "Login"
                : mode === "recovery"
                  ? "Reset your password"
                  : "Redeem Invite Code"}
            </h2>
            {mode !== "login" ? (
              <p>
                {mode === "recovery"
                  ? "We’ll send a reset link if this address has an account."
                  : "Welcome to the closed alpha. Thanks for trying nohmi—it’s early, experimental, and a little buggy."}
              </p>
            ) : null}
          </div>
          {mode === "register" && (
            <>
              <InviteCodeField
                error={invitationError}
                onBlur={() => {
                  setInviteBlurred(true);
                  if (credentials.inviteCode.length === 8) {
                    invitationValidation.mutate(credentials.inviteCode);
                  } else {
                    invitationValidation.reset();
                  }
                }}
                onChange={(inviteCode) => {
                  invitationValidation.reset();
                  setInviteBlurred(false);
                  setCredentials((current) => ({ ...current, inviteCode }));
                }}
                status={invitationStatus}
                value={credentials.inviteCode}
              />
              <TextField
                autoComplete="name"
                label="Name"
                name="displayName"
                onChange={(event) =>
                  setCredentials((current) => ({ ...current, displayName: event.target.value }))
                }
                placeholder="Sam Rivera"
                required
                value={credentials.displayName}
              />
            </>
          )}
          <EmailField
            autoComplete="email"
            name="email"
            onChange={(event) =>
              setCredentials((current) => ({ ...current, email: event.target.value }))
            }
            required
            value={credentials.email}
          />
          {mode !== "recovery" ? (
            <PasswordFields
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              confirmValue={mode === "register" ? credentials.confirmPassword : undefined}
              error={
                mode === "register" && credentials.confirmPassword.length > 0 && !passwordsMatch
                  ? "Passwords must match."
                  : undefined
              }
              labelAction={
                mode === "login" ? (
                  <button
                    className="text-button"
                    onClick={() => selectMode("recovery")}
                    type="button"
                  >
                    Forgot?
                  </button>
                ) : undefined
              }
              onConfirmValueChange={(confirmPassword) =>
                setCredentials((current) => ({ ...current, confirmPassword }))
              }
              onValueChange={(password) => setCredentials((current) => ({ ...current, password }))}
              showRequirements={mode === "register"}
              value={credentials.password}
            />
          ) : null}
          {mutation.isError && (
            <p className="form-error" role="alert">
              {errorMessage(mutation.error)}
            </p>
          )}
          {mutation.isSuccess && mode === "recovery" ? (
            <p className="form-success" role="status">
              If an account exists for that email, a password-reset link is on its way.
            </p>
          ) : null}
          <ShadcnButton
            className="button--wide"
            disabled={mutation.isPending || !canSubmit}
            type="submit"
          >
            {mutation.isPending ? (
              <Spinner label="Signing in" />
            ) : mode === "login" ? (
              "Log in"
            ) : mode === "recovery" ? (
              "Send reset link"
            ) : (
              "Create account"
            )}
          </ShadcnButton>
          {mode === "login" ? (
            <button
              aria-label="Have an invite? Create an account"
              className="text-button auth-invite-link"
              type="button"
              onClick={() => selectMode("register")}
            >
              <span>Have an invite?</span>
              <MailIcon aria-hidden="true" />
              <span>Create an account</span>
            </button>
          ) : (
            <button className="text-button" type="button" onClick={() => selectMode("login")}>
              {mode === "register" ? "Already have an account? Sign in" : "Back to sign in"}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function EmailVerificationScreen({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const verification = useMutation({
    mutationFn: () => api.confirmEmailVerification({ token }),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
  });
  return (
    <AuthActionShell title="Confirm your email">
      <p>Confirm the email address for this nohmi account.</p>
      {verification.isError ? (
        <p className="form-error">{errorMessage(verification.error)}</p>
      ) : null}
      {verification.isSuccess ? (
        <p className="form-success" role="status">
          Your email is confirmed. You can close this page or continue using nohmi.
        </p>
      ) : (
        <Button
          disabled={verification.isPending}
          onClick={() => verification.mutate()}
          tone="accent"
        >
          {verification.isPending ? <Spinner label="Confirming email" /> : "Confirm email"}
        </Button>
      )}
    </AuthActionShell>
  );
}

function PasswordResetScreen({ token }: { token: string }) {
  const [complete, setComplete] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => api.resetPassword({ password, token }),
    onSuccess: () => setComplete(true),
  });
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  return (
    <AuthActionShell title="Choose a new password">
      {complete ? (
        <p className="form-success" role="status">
          Your password has been reset. Return to the app to sign in.
        </p>
      ) : (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate();
          }}
        >
          <PasswordFields
            autoComplete="new-password"
            confirmValue={confirmPassword}
            error={
              confirmPassword.length > 0 && !passwordsMatch ? "Passwords must match." : undefined
            }
            label="New password"
            onConfirmValueChange={setConfirmPassword}
            onValueChange={setPassword}
            showRequirements
            value={password}
          />
          {reset.isError ? <p className="form-error">{errorMessage(reset.error)}</p> : null}
          <Button
            disabled={reset.isPending || !isValidPassword(password) || !passwordsMatch}
            tone="accent"
            type="submit"
          >
            {reset.isPending ? <Spinner label="Resetting password" /> : "Reset password"}
          </Button>
        </form>
      )}
    </AuthActionShell>
  );
}

function AuthActionShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <main className="auth-shell">
      <div className="auth-crest">
        <NohmiBrandMark auth />
      </div>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div className="auth-form__heading">
            <h2>{title}</h2>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function AuthenticatedApp({ user }: { user: User }) {
  const [editor, setEditor] = useState<Editor>(null);
  const [calendarTodaySnap, setCalendarTodaySnap] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pinned, setPinned] = useState(false);
  const location = useLocation();
  const shellPathname = normalizeShellPathname(location.pathname);
  const isMobileWorkspaceDock = useMediaQuery("(max-width: 900px)");
  const activeWorkspace = workspaceForPath(location.pathname);
  const isCalendarWorkspace = activeWorkspace?.id === "calendar";
  const isSpatialCalendar = shellPathname === "/calendar";
  const navigationOwner = navigationOwnerForLocation(location.pathname);
  const workspacePath = activeWorkspace?.path ?? null;
  const [routeTransition, setRouteTransition] = useState<{
    direction: WorkspaceTransitionDirection;
    path: string | null;
  }>({ direction: "none", path: workspacePath });
  if (routeTransition.path !== workspacePath) {
    setRouteTransition({
      direction: workspaceDirection(routeTransition.path, workspacePath ?? ""),
      path: workspacePath,
    });
  }
  const routeDirection = routeTransition.direction;
  const isTodayWorkspace = activeWorkspace?.path === "/today";
  const deviceWeatherLocation = useDeviceWeatherLocation(isTodayWorkspace);
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const weather = useQuery({
    enabled:
      deviceWeatherLocation.coordinates !== null ||
      (deviceWeatherLocation.status !== "pending" && user.homeLocation !== null),
    queryFn: () => api.getWeather(deviceWeatherLocation.coordinates ?? undefined),
    queryKey: ["weather", deviceWeatherLocation.coordinates, user.homeLocation],
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  const todayBrief = useQuery({
    enabled: isTodayWorkspace,
    queryFn: api.getDailyBrief,
    queryKey: ["daily-brief", user.planningTimezone],
    refetchInterval: 60_000,
  });
  // The narrow dock owns navigation below 900px, so the desktop sidebar has no
  // drawer to dismiss. Destinations still receive this hook so the dock's sheet
  // and the sidebar share one navigation contract.
  const closeMobileMenu = () => undefined;
  // The manifest owner, never a route name, selects the sidebar.
  // A standalone flow never reaches the shell, so an owner here is either a
  // workspace or the account utility. Today has no contextual navigation.
  const sidebarMode: ContextSidebarMode =
    navigationOwner.kind !== "workspace"
      ? "settings"
      : navigationOwner.workspace === "today" || navigationOwner.workspace === "calendar"
        ? null
        : navigationOwner.workspace;
  const workspaceSettingsActions = useWorkspaceSettingsActions(sidebarMode === "settings");
  const activeSettingsSection = settingsSectionFromSearch(location.search);
  const pageTitle = workspaceTitleForLocation(shellPathname, location.search);
  const activeFinanceSection = financeSectionFromPath(location.pathname);
  const currentFinanceMonth = new Date().toISOString().slice(0, 7);
  const financeOverview = useQuery({
    queryFn: api.getFinanceOverview,
    queryKey: ["finance-overview", currentFinanceMonth],
  });

  useEffect(() => {
    const connect = () => setOnline(true);
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect);
    window.addEventListener("offline", disconnect);
    return () => {
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", disconnect);
    };
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        setEditor({ kind: "reminder" });
      }
      if (key === "k") event.preventDefault();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const togglePin = async () => {
    const next = !pinned;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(next);
    setPinned(next);
  };

  const mobileDockLogout = () => {
    void api
      .logout()
      .catch((error) => toast.error(errorMessage(error)))
      .finally(() => {
        window.location.assign("/");
      });
  };
  const mobileDockPasswordReset = () => {
    void api
      .requestPasswordReset({ email: user.email })
      .then(() => toast.success(`Password reset link sent to ${user.email}.`))
      .catch((error) => toast.error(errorMessage(error)));
  };

  return (
    <>
      <div
        className={`app-shell${isCalendarWorkspace ? " app-shell--calendar" : ""}${isTodayWorkspace && !isMobileWorkspaceDock ? " app-shell--full-width" : ""}`}
      >
        <PinterestWallpaperScheduler />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {!isMobileWorkspaceDock && !isCalendarWorkspace && !isTodayWorkspace ? (
          <aside
            aria-label={
              navigationOwner.kind !== "workspace"
                ? "Account utility navigation"
                : sidebarMode
                  ? `${sidebarMode.charAt(0).toUpperCase()}${sidebarMode.slice(1)} Sidebar`
                  : "Today Sidebar"
            }
            className={`sidebar${sidebarMode ? " sidebar--context" : ""}`}
            data-state="expanded"
            id="app-sidebar"
          >
            <ShadcnSidebarHeader className="sidebar__header">
              <WorkspaceSwitcher
                compact
                onNavigate={closeMobileMenu}
                pathname={location.pathname}
                user={user}
                weather={weather.data}
              />
            </ShadcnSidebarHeader>
            <ShadcnSidebarContent
              className={`sidebar__content${sidebarMode ? " sidebar__content--context" : " sidebar__content--app"}`}
              key={sidebarMode ?? "application-navigation"}
            >
              {sidebarMode === "settings" ? (
                <SettingsSidebarNavigation
                  canManageInvitations={user.canManageInvitations === true}
                  onNavigate={closeMobileMenu}
                  section={activeSettingsSection}
                  workspaceActions={workspaceSettingsActions}
                />
              ) : sidebarMode === "finances" ? (
                <FinanceSidebarNavigation
                  onNavigate={closeMobileMenu}
                  reviewCount={financeOverview.data?.reviewCount ?? 0}
                  section={activeFinanceSection}
                />
              ) : sidebarMode === "tasks" ? (
                <TasksSidebar onNavigate={closeMobileMenu} />
              ) : sidebarMode === "mail" ? (
                <MailFeatureSidebar onNavigate={closeMobileMenu} />
              ) : null}
            </ShadcnSidebarContent>
            {sidebarMode !== "settings" ? (
              <ShadcnSidebarFooter className="sidebar__footer">
                <AccountMenu onNavigate={closeMobileMenu} user={user} />
              </ShadcnSidebarFooter>
            ) : null}
          </aside>
        ) : null}
        {isMobileWorkspaceDock && !isCalendarWorkspace ? (
          <MobileWorkspaceDock
            accountName={workspaceOwnerName(user)}
            accountSections={settingsSectionPages(
              user.canManageInvitations === true,
              workspaceSettingsActions,
            )}
            onLogout={mobileDockLogout}
            onRequestPasswordReset={mobileDockPasswordReset}
            pathname={shellPathname}
            {...(sidebarMode === "tasks"
              ? {
                  renderWorkspaceNavigation: (onNavigate: () => void) => (
                    <TasksSidebar onNavigate={onNavigate} />
                  ),
                }
              : {})}
            planningTimezone={user.planningTimezone}
            workspaceDefinitions={workspaceDefinitions}
            weather={weather.data}
          />
        ) : null}
        <div className="workspace">
          {!online && (
            <div className="offline-banner">
              <WifiOffIcon className="size-[15px]" /> Offline — changes are paused until you
              reconnect.
            </div>
          )}
          <WorkspaceAppBarForRoute
            accountMenu={
              isTodayWorkspace && !isMobileWorkspaceDock ? (
                <AccountMenu onNavigate={closeMobileMenu} placement="topbar" user={user} />
              ) : null
            }
            activeSettingsSection={activeSettingsSection}
            workspaceSwitcher={
              isCalendarWorkspace || (isTodayWorkspace && !isMobileWorkspaceDock) ? (
                <WorkspaceSwitcher
                  onNavigate={closeMobileMenu}
                  pathname={location.pathname}
                  user={user}
                  weather={weather.data}
                />
              ) : null
            }
            onCalendarToday={() => setCalendarTodaySnap((current) => current + 1)}
            pageTitle={pageTitle}
            pathname={shellPathname}
            pinned={pinned}
            setEditor={setEditor}
            todayBrief={todayBrief.data}
            togglePin={togglePin}
            user={user}
            weather={weather.data}
          />

          <main
            className={`content${isSpatialCalendar ? " content--calendar" : sidebarMode === "mail" ? " content--mail" : ""}`}
            id="main-content"
          >
            <div className="workspace-stage">
              <div
                className="workspace-route"
                data-direction={routeDirection}
                key={activeWorkspace?.path ?? location.pathname}
              >
                {pageTitle && navigationOwner.kind !== "account-utility" ? (
                  <h1 className="sr-only">{pageTitle}</h1>
                ) : null}
                <WorkspaceRoutes
                  calendarTodaySnap={calendarTodaySnap}
                  calendars={calendars.data ?? []}
                  deviceWeatherLocation={deviceWeatherLocation}
                  setEditor={setEditor}
                  todayBrief={todayBrief}
                  user={user}
                  weather={weather}
                />
              </div>
            </div>
          </main>
        </div>
        {editor?.kind === "reminder" && (
          <ReminderDialog close={() => setEditor(null)} reminder={editor.reminder} user={user} />
        )}
        {editor?.kind === "task" && (
          <TaskDialog close={() => setEditor(null)} task={editor.task} user={user} />
        )}
        {editor?.kind === "event" && editor.event && editor.mode !== "edit" && (
          <EventInspector
            calendars={calendars.data ?? []}
            close={() => setEditor(null)}
            edit={() =>
              setEditor({ event: editor.event as CalendarEvent, kind: "event", mode: "edit" })
            }
            event={editor.event}
            user={user}
          />
        )}
        {editor?.kind === "event" && (!editor.event || editor.mode === "edit") && (
          <EventDialog
            calendars={calendars.data ?? []}
            close={() => setEditor(null)}
            event={editor.event}
            user={user}
            {...(editor.draft ? { draft: editor.draft } : {})}
          />
        )}
        {editor?.kind === "calendar" && (
          <CalendarDialog close={() => setEditor(null)} user={user} />
        )}
      </div>
      {typeof window.matchMedia === "function" ? (
        <Toaster position="bottom-right" theme={user.theme} />
      ) : null}
    </>
  );
}

function WorkspaceRoutes({
  calendarTodaySnap,
  calendars,
  deviceWeatherLocation,
  setEditor,
  todayBrief,
  user,
  weather,
}: {
  calendarTodaySnap: number;
  calendars: Calendar[];
  deviceWeatherLocation: DeviceWeatherLocation;
  setEditor: (editor: Editor) => void;
  todayBrief: Pick<UseQueryResult<DailyBrief>, "data" | "error" | "isError" | "isPending">;
  user: User;
  weather: {
    data: WeatherSnapshot | undefined;
    isError: boolean;
    isPending: boolean;
  };
}) {
  return (
    <Routes>
      <Route
        path="/today"
        element={
          <TodayPage
            brief={todayBrief}
            calendars={calendars}
            deviceWeatherLocation={deviceWeatherLocation}
            setEditor={setEditor}
            user={user}
            weather={weather}
          />
        }
      />
      <Route
        path="/calendar"
        element={<CalendarPage setEditor={setEditor} todaySnap={calendarTodaySnap} user={user} />}
      />
      <Route path="/calendar/review" element={<CalendarStewardshipPage />} />
      <Route
        path="/reminders"
        element={
          <RemindersPage
            onEdit={(reminder) => setEditor({ kind: "reminder", reminder })}
            timeZone={user.planningTimezone}
          />
        }
      />
      <Route
        path="/tasks"
        element={
          <TasksPage
            onEdit={(task) => setEditor({ kind: "task", task })}
            timeZone={user.planningTimezone}
          />
        }
      />
      <Route path="/mail" element={<MailFeaturePage user={user} />} />
      <Route
        path="/automations"
        element={<Navigate replace to="/settings?section=workspace-access" />}
      />
      <Route path="/activity" element={<LegacySettingsRedirect section="activity" />} />
      <Route path="/reviews" element={<LegacySettingsRedirect section="reviews" />} />
      <Route path="/goals" element={<LegacySettingsRedirect section="goals" />} />
      <Route path="/motives" element={<LegacySettingsRedirect section="motives" />} />
      <Route
        path="/finances/profile"
        element={<Navigate replace to="/settings?section=finances#guidance" />}
      />
      <Route path="/finances/*" element={<FinancesPage />} />
      <Route path="/settings" element={<SettingsPage setEditor={setEditor} user={user} />} />
      <Route path="*" element={<Navigate replace to="/today" />} />
    </Routes>
  );
}

function LegacySettingsRedirect({ section }: { section: SettingsSectionId }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set("section", section);
  return <Navigate replace to={`/settings?${search.toString()}`} />;
}

function SidebarNavigationItem({
  badge,
  icon: Icon,
  isActive: explicitIsActive,
  label,
  onNavigate,
  path,
}: NavigationItemDefinition & { isActive?: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const isActive = explicitIsActive ?? location.pathname === path;
  const workspaceId = workspaceIdForPath(path);
  return (
    <ShadcnSidebarMenuItem>
      <ShadcnSidebarMenuButton className={badge ? "pr-24" : undefined} asChild isActive={isActive}>
        <NavLink onClick={onNavigate} to={path}>
          {workspaceId ? (
            <WorkspaceIcon size="sm" workspace={workspaceId} />
          ) : (
            <NavigationIcon active={isActive} fallback={Icon} label={label} />
          )}
          <span>{label}</span>
        </NavLink>
      </ShadcnSidebarMenuButton>
      {badge ? (
        <ShadcnSidebarMenuBadge aria-label={`${label}: ${badge}`} role="status">
          <ShadcnBadge variant="destructive">{badge}</ShadcnBadge>
        </ShadcnSidebarMenuBadge>
      ) : null}
    </ShadcnSidebarMenuItem>
  );
}

const navigationIcons = {
  Account: UserCircleIcon,
  "Connected agents": PlugIcon,
  Appearance: PaintBrushIcon,
  Calendar: CalendarIcon,
  Calendars: CalendarIcon,
  Connections: CloudIcon,
  Finances: BankIcon,
  Goals: TargetIcon,
  Invitations: UsersIcon,
  Mail: MailIcon,
  Motives: CompassIcon,
  Reminders: CheckSquareIcon,
  Sessions: LockIcon,
  Settings: SettingsIcon,
  Tasks: ListChecksIcon,
  Today: HouseIcon,
  Wallpaper: ImageIcon,
  "Workspace access": ShieldCheckIcon,
  Activity: PulseIcon,
  Reviews: ShieldCheckIcon,
} as const;

function NavigationIcon({
  active,
  fallback: OutlineIcon,
  label,
  className,
}: {
  active: boolean;
  className?: string;
  fallback: Icon;
  label: string;
}) {
  const WeightedIcon = navigationIcons[label as keyof typeof navigationIcons];
  if (WeightedIcon) {
    return (
      <WeightedIcon
        aria-hidden="true"
        className={className}
        data-navigation-icon-weight={active ? "fill" : "regular"}
        weight={active ? "Filled" : "Outline"}
      />
    );
  }
  return <OutlineIcon aria-hidden="true" className={className} />;
}

function WorkspaceAppBarForRoute({
  accountMenu,
  activeSettingsSection,
  onCalendarToday,
  pageTitle,
  pathname,
  pinned,
  setEditor,
  todayBrief,
  togglePin,
  user,
  weather,
  workspaceSwitcher,
}: {
  accountMenu: ReactNode;
  activeSettingsSection: SettingsSectionId;
  onCalendarToday: () => void;
  pageTitle: string | null;
  pathname: string;
  pinned: boolean;
  setEditor: (editor: Editor) => void;
  todayBrief: DailyBrief | undefined;
  togglePin: () => void;
  user: User;
  weather: WeatherSnapshot | undefined;
  workspaceSwitcher: ReactNode;
}) {
  const workspace = workspaceForLocation(pathname)?.id ?? "account";
  const isSpatialCalendar = pathname === "/calendar";
  const identity = isSpatialCalendar ? (
    <CalendarAppBarIdentity user={user} workspaceSwitcher={workspaceSwitcher} />
  ) : pathname === "/today" ? (
    <div className="calendar-app-bar__identity-cluster">
      <div className="calendar-workspace-switcher">{workspaceSwitcher}</div>
      {todayBrief ? (
        <TodayNavigationTitle
          generatedAt={todayBrief.generatedAt}
          timeZone={user.planningTimezone}
        />
      ) : (
        <span className="workspace-app-bar__title">Today</span>
      )}
    </div>
  ) : (
    <span className="workspace-app-bar__title">
      {/* Account routes always supply a page title, so the workspace registry
            covers the remaining identities. */}
      {pageTitle ?? workspaceDefinitions.find((item) => item.id === workspace)?.label}
    </span>
  );
  const context = isSpatialCalendar ? (
    <CalendarAppBarControls onToday={onCalendarToday} user={user} />
  ) : workspace === "mail" ? (
    <MailTopbarSearch />
  ) : pathname === "/today" ? (
    <TodayWeatherTopbar generatedAt={todayBrief?.generatedAt} user={user} weather={weather} />
  ) : pathname === "/activity" ||
    (pathname === "/settings" && activeSettingsSection === "activity") ? (
    <ActivityTopbarControls />
  ) : pathname === "/reminders" ? (
    <RemindersTopbarControls />
  ) : pathname === "/tasks" ? (
    <TasksTopbarControls />
  ) : null;

  return (
    <WorkspaceAppBar
      actions={
        <>
          {"__TAURI_INTERNALS__" in window && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ShadcnButton
                  aria-label="Keep window on top"
                  aria-pressed={pinned}
                  onClick={togglePin}
                  size="icon"
                  variant="ghost"
                >
                  <PinIcon aria-hidden="true" weight={pinned ? "Filled" : "Outline"} />
                </ShadcnButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">Keep window on top</TooltipContent>
            </Tooltip>
          )}
          {pathname === "/reminders" ? (
            <RemindersCreateButton onCreate={() => setEditor({ kind: "reminder" })} />
          ) : workspace === "tasks" ? (
            <TasksCreateButton onCreate={() => setEditor({ kind: "task" })} />
          ) : workspace === "calendar" ? null : workspace === "mail" ? (
            <>
              <MailSyncButton />
              <MailComposeButton />
            </>
          ) : workspace === "finances" ? (
            <FinanceAddTransactionButton />
          ) : workspace === "account" ? null : (
            <CreateMenu setEditor={setEditor} />
          )}
          {accountMenu}
        </>
      }
      context={context}
      identity={identity}
      workspace={workspace}
    />
  );
}

function WorkspaceSwitcher({
  compact = false,
  onNavigate,
  pathname,
  user,
  weather: currentWeather,
}: {
  compact?: boolean;
  onNavigate: () => void;
  pathname: string;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  const workspace = workspaceForPath(pathname);
  const isSettings = pathname === "/settings";
  const section = isSettings ? "Settings" : (workspace?.label ?? "Home OS");
  const activeWorkspaceId = workspace ? workspaceIdForPath(workspace.path) : undefined;

  return (
    <ShadcnSidebarMenu>
      <ShadcnSidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ShadcnButton
              aria-label="Switch workspace"
              className="sidebar__workspace-trigger w-full justify-start"
              variant="secondary"
            >
              {isSettings ? (
                <SettingsIcon aria-hidden="true" />
              ) : activeWorkspaceId ? (
                <WorkspaceIcon size="sm" workspace={activeWorkspaceId} />
              ) : workspace?.id === "today" ? (
                <TodayWorkspaceIcon timeZone={user.planningTimezone} weather={currentWeather} />
              ) : (
                <LogoMark compact />
              )}
              <span>{section}</span>
              <ChevronDownIcon aria-hidden="true" className="ml-auto" data-icon="inline-end" />
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            aria-label="Switch workspace"
            className={compact ? "w-64" : "w-[--radix-popper-anchor-width]"}
          >
            <DropdownMenuGroup>
              <WorkspaceMenuItem
                item={workspaceShortcuts[0] as WorkspaceDefinition}
                onNavigate={onNavigate}
                pathname={pathname}
                timeZone={user.planningTimezone}
                weather={currentWeather}
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {workspaceShortcuts.slice(1).map((item) => (
                <WorkspaceMenuItem
                  item={item}
                  key={item.path}
                  onNavigate={onNavigate}
                  pathname={pathname}
                  timeZone={user.planningTimezone}
                  weather={currentWeather}
                />
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  aria-current={isSettings ? "page" : undefined}
                  aria-label="Settings"
                  onClick={onNavigate}
                  to="/settings"
                >
                  <SettingsIcon aria-hidden="true" />
                  <span>Settings</span>
                  {isSettings ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ShadcnSidebarMenuItem>
    </ShadcnSidebarMenu>
  );
}

function WorkspaceMenuItem({
  item,
  onNavigate,
  pathname,
  timeZone,
  weather,
}: {
  item: WorkspaceDefinition;
  onNavigate: () => void;
  pathname: string;
  timeZone: string;
  weather: WeatherSnapshot | undefined;
}) {
  const { icon: Icon, label, path } = item;
  const isActive = workspaceForPath(pathname)?.path === path;
  const workspaceId = workspaceIdForPath(path);
  return (
    <DropdownMenuItem asChild>
      <Link
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
        onClick={onNavigate}
        to={path}
      >
        {item.id === "today" ? (
          <TodayWorkspaceIcon timeZone={timeZone} weather={weather} />
        ) : workspaceId ? (
          <WorkspaceIcon size="sm" workspace={workspaceId} />
        ) : (
          <Icon aria-hidden="true" />
        )}
        <span>{label}</span>
        {isActive ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
      </Link>
    </DropdownMenuItem>
  );
}

function AccountMenu({
  onNavigate,
  placement = "sidebar",
  user,
}: {
  onNavigate: () => void;
  placement?: "sidebar" | "topbar";
  user: User;
}) {
  const queryClient = useQueryClient();
  const accountName = user.displayName.trim() || user.email;
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/");
    },
  });

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ShadcnButton aria-label="Account menu" size="icon" variant="ghost">
          {placement === "topbar" ? (
            <ShadcnAvatar size="sm">
              <ShadcnAvatarFallback>{initials(accountName)}</ShadcnAvatarFallback>
            </ShadcnAvatar>
          ) : (
            <SettingsIcon aria-hidden="true" />
          )}
        </ShadcnButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        side={placement === "topbar" ? "bottom" : "top"}
      >
        <DropdownMenuLabel>
          <span className="block truncate">{accountName}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {accountNavigationItems.map(({ icon: Icon, label, path }) => (
            <DropdownMenuItem asChild key={path}>
              <NavLink onClick={onNavigate} to={path}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={(event) => {
            event.preventDefault();
            logout.mutate();
          }}
          variant="destructive"
        >
          <LogOutIcon aria-hidden="true" />
          <span>{logout.isPending ? "Signing out…" : "Log out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (placement === "topbar") return menu;

  return (
    <ShadcnSidebarMenu>
      <ShadcnSidebarMenuItem>
        <div className="sidebar__account-trigger flex min-h-9 items-center gap-2 px-2">
          <ShadcnAvatar className="sidebar__account-avatar" size="sm">
            <ShadcnAvatarFallback>{initials(accountName)}</ShadcnAvatarFallback>
          </ShadcnAvatar>
          <span className="sidebar__account-name min-w-0 flex-1 truncate text-sm font-medium">
            {accountName}
          </span>
          {menu}
        </div>
      </ShadcnSidebarMenuItem>
    </ShadcnSidebarMenu>
  );
}

function CreateMenu({ setEditor }: { setEditor: (editor: Editor) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ShadcnButton aria-label="Add" size="sm">
          <PlusIcon aria-hidden="true" data-icon="inline-start" /> <span>Add</span>
        </ShadcnButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => setEditor({ kind: "task" })}>
            <ListChecksIcon aria-hidden="true" /> Task
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditor({ kind: "reminder" })}>
            <ListTodoIcon aria-hidden="true" /> Reminder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditor({ kind: "event" })}>
            <CalendarIcon aria-hidden="true" /> Event
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FinanceAddTransactionButton({ onSelect }: { onSelect?: () => void }) {
  return (
    <ShadcnButton
      aria-label="Add transaction"
      onClick={() => {
        onSelect?.();
        window.location.hash = "finance-add-transaction";
      }}
      size="sm"
    >
      <PlusIcon aria-hidden="true" data-icon="inline-start" /> <span>Add transaction</span>
    </ShadcnButton>
  );
}

type EmptyDayQuote = { author?: string; source?: string; text: string };

const openDayQuotes: EmptyDayQuote[] = [
  {
    author: "Marcus Aurelius",
    source: "Meditations, VII.67",
    text: "Very little is needed to make a happy life.",
  },
  {
    author: "Henry David Thoreau",
    source: "Letter to H.G.O. Blake, November 16, 1857",
    text: "It is not enough to be industrious; so are the ants. What are you industrious about?",
  },
  {
    author: "Seneca",
    source: "On the Shortness of Life",
    text: "It is not that we have a short time to live, but that we waste much of it.",
  },
  {
    author: "Ecclesiastes 3:1",
    source: "KJV",
    text: "To every thing there is a season, and a time to every purpose under the heaven.",
  },
  {
    author: "Lao Tzu",
    source: "Tao Te Ching, chapter 37",
    text: "The Tao does nothing, and yet nothing is left undone.",
  },
  {
    author: "Ovid",
    text: "Take rest; a field that has rested gives a bountiful crop.",
  },
  {
    author: "Annie Dillard",
    source: "The Writing Life",
    text: "How we spend our days is, of course, how we spend our lives.",
  },
  {
    author: "Wendell Berry",
    source: "The Real Work",
    text: "The impeded stream is the one that sings.",
  },
  {
    author: "Kurt Vonnegut",
    source: "A Man Without a Country",
    text: "If this isn't nice, I don't know what is.",
  },
  {
    author: "Anne Lamott",
    text: "Almost everything will work again if you unplug it for a few minutes, including you.",
  },
  { text: "Nothing on the calendar. That's not a mistake." },
  { text: "A day with no shape yet." },
  { text: "Some days are supposed to look like this." },
  { text: "Unclaimed hours." },
];

const finishedDayQuotes: EmptyDayQuote[] = [
  { text: "That's everything. Go be a person." },
  { text: "Done. Don't go looking for more." },
  { text: "You closed the loop. Leave it closed." },
  { text: "Nothing left. This is what finished feels like." },
  { text: "All handled. Resist the urge to add something." },
  { text: "Empty by your own doing." },
  { text: "The list is done being your problem." },
  { text: "Rest isn't the reward for finishing. It's just what's next." },
];

function emptyDayQuote(day: LocalDate, allCommitmentsDone: boolean): EmptyDayQuote {
  const quotes = allCommitmentsDone ? finishedDayQuotes : openDayQuotes;
  const index = (day.year * 372 + day.month * 31 + day.day) % quotes.length;
  return quotes[index] as EmptyDayQuote;
}

function TodayPage({
  brief,
  calendars,
  deviceWeatherLocation,
  setEditor,
  user,
  weather,
}: {
  brief: Pick<UseQueryResult<DailyBrief>, "data" | "error" | "isError" | "isPending">;
  calendars: Calendar[];
  deviceWeatherLocation: DeviceWeatherLocation;
  setEditor: (editor: Editor) => void;
  user: User;
  weather: {
    data: WeatherSnapshot | undefined;
    isError: boolean;
    isPending: boolean;
  };
}) {
  const completedReminders = useQuery({
    queryFn: () => api.listReminders({ completed: true, limit: 100 }),
    queryKey: ["reminders", "completed"],
  });
  if (brief.isError) return <InlineError error={brief.error} />;
  if (completedReminders.isError) return <InlineError error={completedReminders.error} />;
  if (brief.isPending || completedReminders.isPending || !brief.data) {
    return <PageLoading workspace="today" />;
  }
  const agenda = brief.data;
  const calendarColorsById = new Map(
    calendars.map((calendar) => [calendar.id, calendar.color] as const),
  );
  const currentTime = new Date(agenda.generatedAt);
  const today = localDateAt(currentTime, user.planningTimezone);
  const overdueReminders = agenda.overdue.filter((reminder) => reminder.completedAt === null);
  const todayReminders = agenda.today.filter((reminder) => reminder.completedAt === null);
  const anytimeReminders = agenda.anytime.filter((reminder) => reminder.completedAt === null);
  const doneToday = completedReminders.data.items.filter(
    (reminder) =>
      reminder.completedAt !== null &&
      sameLocalDate(localDateAt(new Date(reminder.completedAt), user.planningTimezone), today),
  );
  const openTasks = agenda.tasks.filter(
    (task) => task.lifecycle === "open" && task.deletedAt === null,
  );
  const { overdue: overdueTasks, today: todayTasks } = selectTodayTasks(
    openTasks,
    currentTime,
    user.planningTimezone,
  );
  const recommendedTasks = new Map(
    (agenda.recommendedTasks ?? []).map((recommendation) => [
      recommendation.task.id,
      recommendation,
    ]),
  );
  const doneTasksToday = agenda.completedTasks.filter(
    (task) =>
      task.completedAt !== null &&
      sameLocalDate(localDateAt(new Date(task.completedAt), user.planningTimezone), today),
  );
  const remainingCount =
    overdueReminders.length +
    todayReminders.length +
    anytimeReminders.length +
    overdueTasks.length +
    todayTasks.length;
  const overdueCommitmentCount = overdueReminders.length + overdueTasks.length;
  const commitmentCount =
    overdueCommitmentCount + todayReminders.length + anytimeReminders.length + todayTasks.length;
  const commitmentSummary =
    commitmentCount === 0
      ? "Nothing needs your attention"
      : `${commitmentCount} ${commitmentCount === 1 ? "thing" : "things"} left${overdueCommitmentCount > 0 ? `, ${overdueCommitmentCount} overdue` : ""}`;
  const remainingTimedEvents = Array.from(
    new Map(
      [...agenda.now, ...(agenda.next ? [agenda.next] : []), ...agenda.laterToday]
        .filter(
          (event) => !event.allDay && new Date(event.endsAt).getTime() > currentTime.getTime(),
        )
        .map((event) => [event.id, event] as const),
    ).values(),
  ).sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  const scheduledTasksToday = openTasks.filter((task) => {
    if (!task.scheduledAt) return false;
    const endsAt = scheduledTaskEndsAt(task);
    return (
      sameLocalDate(localDateAt(new Date(task.scheduledAt), user.planningTimezone), today) &&
      endsAt.getTime() > currentTime.getTime()
    );
  });
  const timelineItems: TodayTimelineItem[] = [
    ...remainingTimedEvents.map((event) => ({
      allDay: false as const,
      endsAt: event.endsAt,
      id: `event:${event.id}`,
      material: { event, kind: "event" as const },
      startsAt: event.startsAt,
    })),
    ...scheduledTasksToday.map((task) => ({
      allDay: false as const,
      endsAt: scheduledTaskEndsAt(task).toISOString(),
      id: `task:${task.id}`,
      material: { kind: "task" as const, task },
      startsAt: task.scheduledAt as string,
    })),
  ].sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  const ongoingEventCount = timelineItems.filter(
    (item) =>
      new Date(item.startsAt).getTime() <= currentTime.getTime() &&
      new Date(item.endsAt).getTime() > currentTime.getTime(),
  ).length;
  const eventsLeftToday = timelineItems.length - ongoingEventCount;
  const eventSummary =
    timelineItems.length === 0
      ? "Nothing scheduled today"
      : `${timelineItems.length} total ${timelineItems.length === 1 ? "event" : "events"}, ${eventsLeftToday} left today${ongoingEventCount > 0 ? `, ${ongoingEventCount} ongoing` : ""}`;
  const openDayQuote = emptyDayQuote(today, remainingCount === 0);
  return (
    <div className="today-layout" data-page="today">
      <section className="day-column">
        <section aria-label="Today's calendar" className="today-schedule">
          <div className="section-heading today-section-heading">
            <div className="today-section-heading__copy">
              <h2>Your timeline</h2>
              <p className="today-section-heading__description">{eventSummary}</p>
            </div>
          </div>
          <TodayConditions
            deviceWeatherLocation={deviceWeatherLocation}
            savedLocation={user.homeLocation}
            weather={weather}
          />
          {agenda.allDay.length > 0 ? (
            <section aria-label="All-day occasions" className="today-all-day-strip">
              <ShadcnItemGroup className="today-all-day-strip__events">
                {agenda.allDay.map((event) => (
                  <TodayAllDayEventCard
                    calendarColor={calendarColorsById.get(event.calendarId)}
                    event={event}
                    key={event.id}
                    onEdit={() => setEditor({ event, kind: "event" })}
                    timeZone={user.planningTimezone}
                  />
                ))}
              </ShadcnItemGroup>
            </section>
          ) : null}
          {timelineItems.length > 0 ? (
            <TodayTimeline
              calendarColorsById={calendarColorsById}
              currentTime={currentTime}
              items={timelineItems}
              onEditTask={(task) => setEditor({ kind: "task", task })}
              timeZone={user.planningTimezone}
            />
          ) : (
            <QuoteCard
              {...(openDayQuote.author ? { author: openDayQuote.author } : {})}
              {...(openDayQuote.source ? { source: openDayQuote.source } : {})}
              className="today-empty-quote"
              label="An open calendar"
              text={openDayQuote.text}
            />
          )}
        </section>
      </section>
      <aside aria-labelledby="today-queue-title" className="today-queue">
        <div className="section-heading today-section-heading">
          <div className="today-section-heading__copy">
            <h2 id="today-queue-title">To take care of</h2>
            <p className="today-section-heading__description">{commitmentSummary}</p>
          </div>
          <ShadcnBadge variant="secondary">{commitmentCount}</ShadcnBadge>
        </div>
        <TodayCommitmentList
          anytimeReminders={anytimeReminders}
          overdueReminders={overdueReminders}
          overdueTasks={overdueTasks}
          recommendedTasks={recommendedTasks}
          setEditor={setEditor}
          timeZone={user.planningTimezone}
          todayReminders={todayReminders}
          todayTasks={todayTasks}
        />
        {doneToday.length > 0 || doneTasksToday.length > 0 ? (
          <ShadcnCollapsible className="today-history">
            <ShadcnCollapsibleTrigger className="today-history__trigger" type="button">
              <CircleCheckIcon aria-hidden="true" />
              <span>Done today</span>
              <ShadcnBadge variant="secondary">
                {doneToday.length + doneTasksToday.length}
              </ShadcnBadge>
              <ChevronDownIcon aria-hidden="true" />
            </ShadcnCollapsibleTrigger>
            <ShadcnCollapsibleContent className="today-history__content">
              {doneToday.length > 0 ? (
                <ReminderGroup
                  label="Completed reminders"
                  reminders={doneToday}
                  setEditor={setEditor}
                  timeZone={user.planningTimezone}
                />
              ) : null}
              {doneTasksToday.length > 0 ? (
                <TaskGroup
                  label="Completed tasks"
                  setEditor={setEditor}
                  tasks={doneTasksToday}
                  timeZone={user.planningTimezone}
                />
              ) : null}
            </ShadcnCollapsibleContent>
          </ShadcnCollapsible>
        ) : null}
      </aside>
    </div>
  );
}

type TodayCommitmentFilter = "all" | "overdue" | "tasks" | "reminders";
type TodayCommitment =
  | { kind: "task"; overdue: boolean; task: Task }
  | { kind: "reminder"; overdue: boolean; reminder: Reminder };

const todayCommitmentsPerPage = 6;

function TodayCommitmentList({
  anytimeReminders,
  overdueReminders,
  overdueTasks,
  recommendedTasks,
  setEditor,
  timeZone,
  todayReminders,
  todayTasks,
}: {
  anytimeReminders: Reminder[];
  overdueReminders: Reminder[];
  overdueTasks: Task[];
  recommendedTasks: Map<string, DailyBrief["recommendedTasks"][number]>;
  setEditor: (editor: Editor) => void;
  timeZone: string;
  todayReminders: Reminder[];
  todayTasks: Task[];
}) {
  const [filter, setFilter] = useState<TodayCommitmentFilter>("all");
  const [requestedPage, setRequestedPage] = useState(1);
  const commitments: TodayCommitment[] = [
    ...overdueTasks.map((task) => ({ kind: "task" as const, overdue: true, task })),
    ...overdueReminders.map((reminder) => ({
      kind: "reminder" as const,
      overdue: true,
      reminder,
    })),
    ...todayReminders.map((reminder) => ({
      kind: "reminder" as const,
      overdue: false,
      reminder,
    })),
    ...anytimeReminders.map((reminder) => ({
      kind: "reminder" as const,
      overdue: false,
      reminder,
    })),
    ...todayTasks.map((task) => ({ kind: "task" as const, overdue: false, task })),
  ];
  const filteredCommitments = commitments.filter((commitment) => {
    if (filter === "all") return true;
    if (filter === "overdue") return commitment.overdue;
    return filter === "tasks" ? commitment.kind === "task" : commitment.kind === "reminder";
  });
  const pageCount = Math.max(1, Math.ceil(filteredCommitments.length / todayCommitmentsPerPage));
  const page = Math.min(requestedPage, pageCount);
  const pageStart = (page - 1) * todayCommitmentsPerPage;
  const visibleCommitments = filteredCommitments.slice(
    pageStart,
    pageStart + todayCommitmentsPerPage,
  );
  const selectFilter = (value: string) => {
    if (!value) return;
    setFilter(value as TodayCommitmentFilter);
    setRequestedPage(1);
  };
  const selectPage = (nextPage: number) =>
    setRequestedPage(Math.min(Math.max(nextPage, 1), pageCount));

  return (
    <div className="today-commitments">
      <ShadcnToggleGroup
        aria-label="Commitment filters"
        className="today-commitments__filters"
        onValueChange={selectFilter}
        size="sm"
        type="single"
        value={filter}
        variant="outline"
      >
        <ShadcnToggleGroupItem value="all">All</ShadcnToggleGroupItem>
        <ShadcnToggleGroupItem value="overdue">Overdue</ShadcnToggleGroupItem>
        <ShadcnToggleGroupItem value="tasks">Tasks</ShadcnToggleGroupItem>
        <ShadcnToggleGroupItem value="reminders">Reminders</ShadcnToggleGroupItem>
      </ShadcnToggleGroup>
      {visibleCommitments.length > 0 ? (
        <ShadcnScrollArea aria-label="Commitments" className="today-commitments__scroll">
          <ShadcnItemGroup aria-label="Commitments" className="today-commitments__list">
            {visibleCommitments.map((commitment) => {
              if (commitment.kind === "task") {
                const recommendation = recommendedTasks.get(commitment.task.id);
                return (
                  <TaskRow
                    compact
                    className={cn(commitment.overdue && "today-commitment-row--overdue")}
                    key={`task:${commitment.task.id}`}
                    onEdit={() => setEditor({ kind: "task", task: commitment.task })}
                    {...(recommendation ? { recommendation } : {})}
                    task={commitment.task}
                    timeZone={timeZone}
                  />
                );
              }
              return (
                <ReminderRow
                  key={`reminder:${commitment.reminder.id}`}
                  onEdit={() => setEditor({ kind: "reminder", reminder: commitment.reminder })}
                  reminder={commitment.reminder}
                  timeZone={timeZone}
                />
              );
            })}
          </ShadcnItemGroup>
        </ShadcnScrollArea>
      ) : (
        <EmptyState
          icon={<CircleCheckIcon />}
          title={commitments.length === 0 ? "Nothing pulling at you" : "Nothing in this view"}
        >
          {commitments.length === 0
            ? "Add something when it deserves your attention."
            : "Try another filter."}
        </EmptyState>
      )}
      {filteredCommitments.length > 0 ? (
        <div className="today-commitments__pagination">
          <span>
            {pageStart + 1}–
            {Math.min(pageStart + todayCommitmentsPerPage, filteredCommitments.length)} of{" "}
            {filteredCommitments.length}
          </span>
          <ShadcnPagination>
            <ShadcnPaginationContent>
              <ShadcnPaginationItem>
                <ShadcnPaginationPrevious
                  aria-disabled={page === 1}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    selectPage(page - 1);
                  }}
                  tabIndex={page === 1 ? -1 : undefined}
                  text="Prev"
                />
              </ShadcnPaginationItem>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <ShadcnPaginationItem key={pageNumber}>
                  <ShadcnPaginationLink
                    aria-label={`Go to page ${pageNumber}`}
                    href="#"
                    isActive={pageNumber === page}
                    onClick={(event) => {
                      event.preventDefault();
                      selectPage(pageNumber);
                    }}
                  >
                    {pageNumber}
                  </ShadcnPaginationLink>
                </ShadcnPaginationItem>
              ))}
              <ShadcnPaginationItem>
                <ShadcnPaginationNext
                  aria-disabled={page === pageCount}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    selectPage(page + 1);
                  }}
                  tabIndex={page === pageCount ? -1 : undefined}
                />
              </ShadcnPaginationItem>
            </ShadcnPaginationContent>
          </ShadcnPagination>
        </div>
      ) : null}
    </div>
  );
}

function TodayConditions({
  deviceWeatherLocation,
  savedLocation,
  weather,
}: {
  deviceWeatherLocation: DeviceWeatherLocation;
  savedLocation: HomeLocation | null;
  weather: {
    data: WeatherSnapshot | undefined;
    isError: boolean;
    isPending: boolean;
  };
}) {
  if (weather.data) return null;
  const description = weather.isError
    ? "Conditions are temporarily unavailable."
    : deviceWeatherLocation.status === "pending"
      ? "Finding local conditions…"
      : savedLocation
        ? `Checking ${savedLocation.label}…`
        : "Allow device location or add a saved location in Account settings.";
  return (
    <ShadcnItem className="today-conditions" size="sm">
      <ShadcnItemMedia variant="icon">
        <CloudIcon aria-hidden="true" />
      </ShadcnItemMedia>
      <ShadcnItemContent>
        <ShadcnItemTitle>Current conditions</ShadcnItemTitle>
        <ShadcnItemDescription>{description}</ShadcnItemDescription>
      </ShadcnItemContent>
      {deviceWeatherLocation.status === "pending" ||
      (savedLocation !== null && weather.isPending) ? (
        <ShadcnItemActions>
          <ShadcnBadge variant="secondary">Updating</ShadcnBadge>
        </ShadcnItemActions>
      ) : null}
    </ShadcnItem>
  );
}

function TodayWeatherTopbar({
  generatedAt,
  user,
  weather,
}: {
  generatedAt: string | undefined;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  if (!weather) return null;
  const WeatherIcon = todayWeatherIcon(weather, user.planningTimezone);
  const temperature = `${Math.round(weather.temperatureF)}°F`;
  const alertDescription =
    weather.alerts.length > 0 ? weather.alerts.map((alert) => alert.label).join(" · ") : null;
  return (
    <fieldset aria-label="Today conditions" className="workspace-app-bar__weather">
      <TodayWeatherPopover
        content={
          <WeatherConditionsPopoverContent
            alertDescription={alertDescription}
            generatedAt={generatedAt}
            planningTimezone={user.planningTimezone}
            weather={weather}
            WeatherIcon={WeatherIcon}
          />
        }
        contentClassName="weather-popover"
        description={`Updated ${formatTime(weather.observedAt, user.planningTimezone)}`}
        showHeader={false}
        tooltip={`${weather.condition}, ${temperature}`}
        title={weather.condition}
      >
        <ShadcnButton
          aria-label={`${weather.condition}, ${temperature}`}
          className="workspace-app-bar__weather-trigger"
          variant="secondary"
        >
          <WeatherIcon aria-hidden="true" />
          <span>{temperature}</span>
        </ShadcnButton>
      </TodayWeatherPopover>
      <TodayWeatherPopover
        content={<WeatherLocationPopoverContent weather={weather} />}
        contentClassName="weather-location-popover"
        description={weather.location.source === "device" ? "Using this device" : "Home location"}
        showHeader={false}
        tooltip={`Weather location: ${weather.location.shortLabel}`}
        title={weather.location.label}
      >
        <ShadcnButton
          aria-label={`Weather location: ${weather.location.shortLabel}`}
          className="workspace-app-bar__weather-location"
          variant="ghost"
        >
          <MapPinIcon aria-hidden="true" />
          <span>{weather.location.shortLabel}</span>
        </ShadcnButton>
      </TodayWeatherPopover>
    </fieldset>
  );
}

function WeatherConditionsPopoverContent({
  alertDescription,
  generatedAt,
  planningTimezone,
  weather,
  WeatherIcon,
}: {
  alertDescription: string | null;
  generatedAt: string | undefined;
  planningTimezone: string;
  weather: WeatherSnapshot;
  WeatherIcon: Icon;
}) {
  const roundedTemperature = Math.round(weather.temperatureF);
  return (
    <>
      <div
        className={`weather-popover__sky weather-popover__sky--${weatherSkyPeriod(
          weather.observedAt,
          planningTimezone,
        )}`}
      >
        <div className="weather-popover__sky-heading">
          <span>
            <WeatherIcon aria-hidden="true" />
            {weather.condition}
          </span>
          <span>{formatTime(weather.observedAt, planningTimezone)}</span>
        </div>
        <strong className="weather-popover__temperature">{roundedTemperature}°</strong>
        <dl className="weather-popover__stats">
          <div>
            <dt>Updated</dt>
            <dd>
              {formatWeatherFreshness(
                weather.observedAt,
                generatedAt ? new Date(generatedAt).getTime() : Date.now(),
              )}
            </dd>
          </div>
          <div>
            <dt>Air quality</dt>
            <dd>{airQualityDescription(weather.usAqi)}</dd>
          </div>
        </dl>
      </div>
      <div className="weather-popover__details">
        {alertDescription ? <p className="weather-popover__alert">{alertDescription}</p> : null}
        <p>{weather.location.shortLabel}</p>
      </div>
    </>
  );
}

export function formatWeatherFreshness(observedAt: string, now = Date.now()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(observedAt).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}hr ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function airQualityDescription(usAqi: number | null): string {
  if (usAqi === null) return "Unavailable";
  if (usAqi <= 50) return "Good";
  if (usAqi <= 100) return "Moderate";
  if (usAqi <= 150) return "Sensitive groups";
  if (usAqi <= 200) return "Unhealthy";
  if (usAqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

function WeatherLocationPopoverContent({ weather }: { weather: WeatherSnapshot }) {
  const { coordinates, label, mapUrl, shortLabel, source } = weather.location;
  const sourceLabel = source === "device" ? "Using this device" : "Home location";
  return (
    <>
      <div className="weather-location-popover__header">
        <div className="weather-location-popover__heading">
          <span>
            <MapPinIcon aria-hidden="true" />
            {sourceLabel}
          </span>
          <span>{shortLabel}</span>
        </div>
        <strong>{label}</strong>
        <span className="weather-location-popover__coordinates">
          {formatWeatherCoordinates(coordinates)}
        </span>
      </div>
      <div className="weather-location-popover__map">
        <iframe loading="lazy" src={weatherMapEmbedUrl(coordinates)} title={`Map of ${label}`} />
        <a
          aria-label={`Open ${label} in OpenStreetMap`}
          href={mapUrl}
          rel="noreferrer"
          target="_blank"
        >
          <span>
            <ExternalLinkIcon aria-hidden="true" />
            Open map
          </span>
        </a>
      </div>
    </>
  );
}

function TodayNavigationTitle({
  generatedAt,
  timeZone,
}: {
  generatedAt: string;
  timeZone: string;
}) {
  const currentTime = new Date(generatedAt);
  return (
    <h1 className="workspace-app-bar__title">
      <time dateTime={localDateToIso(localDateAt(currentTime, timeZone))}>
        {formatOrdinalDate(currentTime, timeZone)}
      </time>
    </h1>
  );
}

function workspaceTitleForLocation(pathname: string, search: string): string | null {
  const searchParams = new URLSearchParams(search);
  if (pathname === "/calendar/review") return "Calendar review";
  if (pathname === "/calendar") return "Calendar";
  if (pathname === "/reminders") {
    return searchParams.get("view") === "completed" ? "Completed reminders" : "Reminders";
  }
  if (pathname === "/tasks") return "Tasks";
  if (pathname === "/mail") return "Mail";
  if (pathname === "/goals") return "Goals";
  if (pathname === "/motives") return "Motives";
  if (pathname === "/finances") return "Finances";
  if (pathname === "/finances/accounts") return "Accounts";
  if (pathname === "/finances/budgets") return "Budgets";
  if (pathname === "/finances/cashflow") return "Cash flow";
  if (pathname === "/finances/health") return "Ledger health";
  if (pathname === "/finances/imports") return "Import history";
  if (pathname === "/finances/review") return "Review queue";
  if (pathname === "/finances/subscriptions") return "Subscriptions";
  if (pathname === "/finances/transactions") return "Transactions";
  if (pathname === "/activity") return "Activity";
  if (pathname === "/reviews") return "Reviews";
  if (pathname === "/settings") return settingsSectionLabel(settingsSectionFromSearch(search));
  return null;
}

function TodayWeatherPopover({
  children,
  content,
  contentClassName,
  description,
  showHeader = true,
  title,
  tooltip,
}: {
  children: ReactNode;
  content?: ReactNode;
  contentClassName?: string;
  description: ReactNode;
  showHeader?: boolean;
  title: string;
  tooltip: string;
}) {
  return (
    <ShadcnPopover>
      <Tooltip>
        <ShadcnPopoverTrigger asChild>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
        </ShadcnPopoverTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
      <ShadcnPopoverContent align="start" className={contentClassName} side="bottom">
        {showHeader ? (
          <ShadcnPopoverHeader>
            <ShadcnPopoverTitle>{title}</ShadcnPopoverTitle>
            <ShadcnPopoverDescription>{description}</ShadcnPopoverDescription>
          </ShadcnPopoverHeader>
        ) : null}
        {content}
      </ShadcnPopoverContent>
    </ShadcnPopover>
  );
}

function CalendarPage({
  setEditor,
  todaySnap,
  user,
}: {
  setEditor: (editor: Editor) => void;
  todaySnap: number;
  user: User;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<CalendarDropPreview | null>(null);
  const [inspectedEvent, setInspectedEvent] = useState<CalendarEvent | null>(null);
  const [floatingDraft, setFloatingDraft] = useState<EventDraft | null>(null);
  const initializedFollow = useRef(false);
  const requestedView = searchParams.get("view");
  const defaultView: CalendarView =
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 560px)").matches
      ? "day"
      : "week";
  const view = calendarViewFromSearch(requestedView, defaultView);
  const includeWeekends = searchParams.get("weekends") !== "0";
  const requestedAnchor = searchParams.get("date");
  const requestedEventId = searchParams.get("event");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(currentTime, user.planningTimezone);
  const updateCalendarState = (updates: Record<string, string>) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        next.set(key, value);
      }
      return next;
    });
  const days = useMemo(
    () => calendarPeriodDays(view, anchor, includeWeekends),
    [anchor, includeWeekends, view],
  );
  const range = useMemo(
    () =>
      localDateRange(
        days[0] as LocalDate,
        addLocalDays(days[days.length - 1] as LocalDate, 1),
        user.planningTimezone,
      ),
    [days, user.planningTimezone],
  );
  const events = useQuery({
    queryFn: () => api.listEvents(range),
    queryKey: calendarQueryKeys.events(view, range.from, range.to),
  });
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: calendarQueryKeys.calendars });
  const connectorAccounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const reconnectingAccounts = (connectorAccounts.data ?? []).filter(
    (account) => account.calendarEnabled && connectionHealth(account).state === "reconnect",
  );
  const reconnectingAccountKey = reconnectingAccounts.map((account) => account.id).join("|");
  const reconnectingAccountLabels = reconnectingAccounts.map((account) => account.label).join(", ");
  const calendarsById = useMemo(
    () => new Map((calendars.data ?? []).map((calendar) => [calendar.id, calendar])),
    [calendars.data],
  );
  const moveEvent = useMutation({
    mutationFn: async (input: CalendarEventMove) => {
      const times = movedEventTimes(input.event, input.day, input.minute, user.planningTimezone);
      return api.updateEvent(input.event.id, times);
    },
    onError: (error, _input, context) => {
      if (context) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Event couldn’t be moved", { description: errorMessage(error) });
    },
    onMutate: async (input: CalendarEventMove) => {
      await queryClient.cancelQueries({ queryKey: ["events"] });
      const snapshots = queryClient.getQueriesData<CalendarEvent[]>({ queryKey: ["events"] });
      const times = movedEventTimes(input.event, input.day, input.minute, user.planningTimezone);
      queryClient.setQueriesData<CalendarEvent[]>({ queryKey: ["events"] }, (records) =>
        records?.map((record) => (record.id === input.event.id ? { ...record, ...times } : record)),
      );
      return { snapshots };
    },
    onSettled: () => invalidateMaterial(queryClient),
  });
  const today = localDateAt(currentTime, user.planningTimezone);
  const followToday = sameLocalDate(anchor, today) && searchParams.get("follow") !== "0";
  const disableFollowToday = () => updateCalendarState({ follow: "0" });
  const eventsByDay = useMemo(() => {
    const records = events.data ?? [];
    return new Map(
      days.map((day) => {
        const dayRange = localDateRange(day, addLocalDays(day, 1), user.planningTimezone);
        const startsAt = new Date(dayRange.from).getTime();
        const endsAt = new Date(dayRange.to).getTime();
        return [
          localDateKey(day),
          records.filter(
            (event) =>
              new Date(event.startsAt).getTime() < endsAt &&
              new Date(event.endsAt).getTime() > startsAt,
          ),
        ];
      }),
    );
  }, [days, events.data, user.planningTimezone]);

  useEffect(() => {
    if (!requestedEventId || !events.data) return;
    const requestedEvent = events.data.find((event) => event.id === requestedEventId);
    if (requestedEvent) setInspectedEvent(requestedEvent);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("event");
        return next;
      },
      { replace: true },
    );
  }, [events.data, requestedEventId, setSearchParams]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const toastId = "calendar-connection-recovery";
    if (!reconnectingAccountKey) {
      toast.dismiss(toastId);
      return;
    }
    toast.warning(`Reconnect ${reconnectingAccounts.length === 1 ? "an account" : "accounts"}`, {
      action: {
        label: "Review connections",
        onClick: () => navigate("/settings?section=connections"),
      },
      description: `${reconnectingAccountLabels} needs authorization before new information can sync.`,
      id: toastId,
    });
  }, [navigate, reconnectingAccountKey, reconnectingAccountLabels, reconnectingAccounts.length]);

  useEffect(() => {
    if (initializedFollow.current) return;
    initializedFollow.current = true;
    if (!sameLocalDate(anchor, today)) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("follow", "1");
        return next;
      },
      { replace: true },
    );
  }, [anchor, setSearchParams, today]);

  const showDay = (day: LocalDate) => {
    updateCalendarState({ date: localDateToIso(day), view: "day" });
  };
  const jumpToDate = (day: LocalDate) => {
    updateCalendarState({ date: localDateToIso(day), follow: "0" });
  };
  const setCalendarEditor = (nextEditor: Editor) => {
    if (nextEditor?.kind === "event" && nextEditor.event && nextEditor.mode !== "edit") {
      setInspectedEvent(nextEditor.event);
      return;
    }
    setEditor(nextEditor);
  };
  const dropEvent = (event: CalendarEvent, day: LocalDate, minute: number) => {
    if (calendarsById.get(event.calendarId)?.isWritable) {
      moveEvent.mutate({ day, event, minute });
    }
    setDraggedEventId(null);
    setDragPreview(null);
    calendarDragOffsets.delete(event.id);
  };
  const clearDrag = () => {
    if (draggedEventId) {
      calendarDragOffsets.delete(draggedEventId);
      calendarDragMetrics.delete(draggedEventId);
    }
    setDraggedEventId(null);
    setDragPreview(null);
  };

  return (
    <div className="calendar-page">
      {events.isPending ? (
        <PageLoading workspace="calendar" />
      ) : events.isError ? (
        <InlineError error={events.error} />
      ) : view === "day" ? (
        <DayCalendarView
          currentTime={currentTime}
          day={days[0] as LocalDate}
          events={eventsByDay.get(localDateKey(days[0] as LocalDate)) as CalendarEvent[]}
          calendarsById={calendarsById}
          clearDrag={clearDrag}
          dragPreview={dragPreview}
          draggedEventId={draggedEventId}
          moveEvent={dropEvent}
          onCreateRange={setFloatingDraft}
          setEditor={setCalendarEditor}
          setDraggedEventId={setDraggedEventId}
          setDragPreview={setDragPreview}
          followToday={followToday}
          key={localDateKey(days[0] as LocalDate)}
          onExitFollow={disableFollowToday}
          timeZone={user.planningTimezone}
          today={today}
          todaySnap={todaySnap}
        />
      ) : view === "week" ? (
        <WeekCalendarView
          currentTime={currentTime}
          days={days}
          eventsByDay={eventsByDay}
          calendarsById={calendarsById}
          clearDrag={clearDrag}
          dragPreview={dragPreview}
          draggedEventId={draggedEventId}
          moveEvent={dropEvent}
          onCreateRange={setFloatingDraft}
          setEditor={setCalendarEditor}
          setDraggedEventId={setDraggedEventId}
          setDragPreview={setDragPreview}
          selectedDate={anchor}
          showDay={showDay}
          followToday={followToday}
          key={localDateKey(days[0] as LocalDate)}
          onExitFollow={disableFollowToday}
          timeZone={user.planningTimezone}
          today={today}
          todaySnap={todaySnap}
        />
      ) : (
        <MonthCalendarView
          anchor={anchor}
          days={days}
          eventsByDay={eventsByDay}
          calendarsById={calendarsById}
          clearDrag={clearDrag}
          draggedEventId={draggedEventId}
          moveEvent={dropEvent}
          setEditor={setCalendarEditor}
          setDraggedEventId={setDraggedEventId}
          showDay={showDay}
          key={localDateKey(anchor)}
          timeZone={user.planningTimezone}
          today={today}
          todaySnap={todaySnap}
        />
      )}
      <CalendarFloatingNav
        anchor={anchor}
        calendars={calendars.data ?? []}
        events={events.data ?? []}
        {...(floatingDraft ? { draft: floatingDraft } : {})}
        eventDetails={
          inspectedEvent ? (
            <EventInspector
              calendars={calendars.data ?? []}
              close={() => setInspectedEvent(null)}
              edit={() => {
                setInspectedEvent(null);
                setEditor({ event: inspectedEvent, kind: "event", mode: "edit" });
              }}
              event={inspectedEvent}
              key={inspectedEvent.id}
              presentation="floating"
              user={user}
            />
          ) : undefined
        }
        onNavigate={jumpToDate}
        onDraftDismiss={() => setFloatingDraft(null)}
        timeZone={user.planningTimezone}
        user={user}
      />
    </div>
  );
}

function CalendarAppBarIdentity({
  user,
  workspaceSwitcher,
}: {
  user: User;
  workspaceSwitcher: ReactNode;
}) {
  const [searchParams] = useSearchParams();
  const compactMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 560px)") : undefined;
  const defaultView: CalendarView = compactMedia?.matches ? "day" : "week";
  const view = calendarViewFromSearch(searchParams.get("view"), defaultView);
  const includeWeekends = searchParams.get("weekends") !== "0";
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const days = useMemo(
    () => calendarPeriodDays(view, anchor, includeWeekends),
    [anchor, includeWeekends, view],
  );
  const start = days[0] as LocalDate;
  const end = days[days.length - 1] as LocalDate;
  const title =
    view === "day"
      ? formatLocalDate(start, { day: "numeric", month: "long", weekday: "long", year: "numeric" })
      : view === "week"
        ? calendarOrientationWeekTitle(start, end)
        : formatLocalDate(anchor, { month: "long", year: "numeric" });
  const compactTitle =
    view === "day"
      ? formatLocalDate(start, { day: "numeric", month: "short" })
      : view === "week"
        ? `${formatLocalDate(start, { month: "short" })} ${start.day}–${end.day}`
        : formatLocalDate(anchor, { month: "short", year: "numeric" });

  return (
    <div className="calendar-app-bar__identity-cluster">
      <div className="calendar-workspace-switcher">{workspaceSwitcher}</div>
      <div className="calendar-app-bar__orientation">
        <h2>
          <span className="calendar-app-bar__title-full">{title}</span>
          <span aria-hidden="true" className="calendar-app-bar__title-compact">
            {compactTitle}
          </span>
        </h2>
      </div>
    </div>
  );
}

function calendarOrientationWeekTitle(start: LocalDate, end: LocalDate) {
  if (start.year === end.year && start.month === end.month) {
    return `${formatLocalDate(start, { month: "long" })} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${formatLocalDate(start, { day: "numeric", month: "short" })}–${formatLocalDate(end, { day: "numeric", month: "short" })}, ${start.year}`;
  }
  return `${formatLocalDate(start, { day: "numeric", month: "short", year: "numeric" })}–${formatLocalDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

function CalendarAppBarControls({ onToday, user }: { onToday: () => void; user: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const compactMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 560px)") : undefined;
  const defaultView: CalendarView = compactMedia?.matches ? "day" : "week";
  const requestedView = searchParams.get("view");
  const view = calendarViewFromSearch(requestedView, defaultView);
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const updateCalendarState = (updates: Record<string, null | string>) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  const movePeriod = (direction: -1 | 1) => {
    const date =
      view === "day"
        ? addLocalDays(anchor, direction)
        : view === "week"
          ? addLocalDays(anchor, direction * 7)
          : addCalendarMonths(anchor, direction);
    updateCalendarState({ date: localDateToIso(date), follow: "0" });
  };
  return (
    <fieldset className="calendar-app-bar__controls">
      <legend className="sr-only">Calendar controls</legend>
      <div className="calendar-app-bar__control-set">
        <ShadcnToggleGroup
          aria-label="Calendar view: choose day, week, or month"
          className="calendar-app-bar__view-switch"
          data-view={view}
          onValueChange={(value) => {
            if (value === "day" || value === "week" || value === "month") {
              updateCalendarState({ view: value === defaultView ? null : value });
            }
          }}
          type="single"
          value={view}
          size="sm"
          variant="outline"
          spacing={0}
        >
          {calendarViews.map((option) => {
            const Icon = option.icon;
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <ShadcnToggleGroupItem
                    aria-label={option.label}
                    className="calendar-app-bar__view-option"
                    value={option.value}
                  >
                    <Icon aria-hidden="true" data-icon="inline-start" />
                    <span className="calendar-app-bar__view-label">{option.label}</span>
                  </ShadcnToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Show {option.label.toLowerCase()} view
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ShadcnToggleGroup>
        <ShadcnButton
          aria-label="Today"
          className="calendar-app-bar__today"
          onClick={() => {
            updateCalendarState({
              date: localDateToIso(localDateAt(new Date(), user.planningTimezone)),
              follow: "1",
            });
            onToday();
          }}
          size="sm"
          variant="outline"
        >
          <LocationFixedIcon aria-hidden="true" data-icon="inline-start" />
          <span>Today</span>
        </ShadcnButton>
        <div className="calendar-app-bar__period-navigation">
          <ShadcnButton
            aria-label={`Previous ${view}`}
            onClick={() => movePeriod(-1)}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </ShadcnButton>
          <ShadcnButton
            aria-label={`Next ${view}`}
            onClick={() => movePeriod(1)}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden="true" />
          </ShadcnButton>
        </div>
        <CalendarAccountsControl />
      </div>
    </fieldset>
  );
}

function addCalendarMonths(date: LocalDate, amount: number): LocalDate {
  const monthIndex = date.month - 1 + amount;
  const year = date.year + Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { day: Math.min(date.day, daysInMonth), month, year };
}

function CalendarAccountsControl() {
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: calendarQueryKeys.calendars });
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const enabledAccounts = (accounts.data ?? []).filter((account) => account.calendarEnabled);
  const records = calendars.data ?? [];
  const selectedCount = records.filter((calendar) => calendar.isSelected).length;
  const label = `${selectedCount} of ${records.length} calendars`;
  return (
    <ShadcnPopover>
      <ShadcnPopoverTrigger asChild>
        <ShadcnButton
          aria-label={label}
          className="calendar-accounts-trigger"
          size="sm"
          variant="ghost"
        >
          <ShadcnAvatarGroup className="calendar-accounts-trigger__avatars">
            {enabledAccounts.map((account) => (
              <ShadcnAvatar key={account.id} size="sm">
                {account.avatarUrl ? <ShadcnAvatarImage alt="" src={account.avatarUrl} /> : null}
                <ShadcnAvatarFallback>
                  {initials(account.label ?? account.email ?? account.provider)}
                </ShadcnAvatarFallback>
              </ShadcnAvatar>
            ))}
          </ShadcnAvatarGroup>
          <span>{label}</span>
        </ShadcnButton>
      </ShadcnPopoverTrigger>
      <ShadcnPopoverContent align="end" className="calendar-accounts-popover">
        <ShadcnPopoverHeader>
          <ShadcnPopoverTitle>Calendars</ShadcnPopoverTitle>
          <ShadcnPopoverDescription>{label}</ShadcnPopoverDescription>
        </ShadcnPopoverHeader>
        {records.length === 0 ? (
          <p className="calendar-accounts-popover__empty">No calendars are available.</p>
        ) : (
          <ShadcnFieldGroup className="calendar-accounts-popover__list">
            {groupCalendarsByAccount(enabledAccounts, records).flatMap((group) =>
              group.calendars.map((calendar) => (
                <CalendarVisibilitySwitch calendar={calendar} key={calendar.id} />
              )),
            )}
          </ShadcnFieldGroup>
        )}
        <ShadcnButton asChild className="w-full justify-start" size="sm" variant="ghost">
          <Link to="/calendar/review">Schedule health</Link>
        </ShadcnButton>
      </ShadcnPopoverContent>
    </ShadcnPopover>
  );
}

function CalendarVisibilitySwitch({ calendar }: { calendar: Calendar }) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Calendar, Error, boolean, { previous: Calendar[] }>({
    mutationFn: (selected) => api.setCalendarSelected(calendar.id, selected),
    onError: (error, _selected, context) => {
      if (context) queryClient.setQueryData(calendarQueryKeys.calendars, context.previous);
      toast.error(errorMessage(error));
    },
    onMutate: async (selected) => {
      await queryClient.cancelQueries({ queryKey: calendarQueryKeys.calendars });
      const previous = queryClient.getQueryData<Calendar[]>(calendarQueryKeys.calendars) ?? [];
      queryClient.setQueryData<Calendar[]>(calendarQueryKeys.calendars, (records) =>
        records?.map((record) =>
          record.id === calendar.id ? { ...record, isSelected: selected } : record,
        ),
      );
      return { previous };
    },
    onSettled: () => invalidateMaterial(queryClient),
  });
  return (
    <ShadcnField orientation="horizontal">
      <ShadcnFieldLabel htmlFor={`calendar-popover-${calendar.id}`}>
        <i
          aria-hidden="true"
          className="calendar-accounts-popover__color"
          style={{ background: calendar.color ?? "var(--muted)" }}
        />
        <span className="truncate">{calendar.name}</span>
      </ShadcnFieldLabel>
      <ShadcnSwitch
        checked={calendar.isSelected}
        disabled={mutation.isPending}
        id={`calendar-popover-${calendar.id}`}
        onCheckedChange={(selected) => mutation.mutate(selected)}
        size="sm"
      />
    </ShadcnField>
  );
}

function CalendarProviderEmblem({ provider }: { provider: string }) {
  if (hasBrandMark(provider)) return <BrandMark brand={provider} decorative />;
  return <CalendarIcon aria-hidden="true" />;
}

function ConnectedServiceMark({ provider }: { provider: string }) {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === "local") return null;
  const label =
    brandTitle(provider) ??
    provider.replace(
      /(^|[-_\s])(\p{L})/gu,
      (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
    );
  if (!hasBrandMark(provider)) {
    return <ShadcnBadge variant="secondary">{label}</ShadcnBadge>;
  }
  return (
    <span className={`connected-service-mark connected-service-mark--${normalizedProvider}`}>
      <BrandMark brand={provider} label={`${label} calendar`} />
    </span>
  );
}

function ConnectedAccountIdentity({
  avatarUrl,
  label,
  provider,
  size = "sm",
}: {
  avatarUrl: string | null | undefined;
  label: string;
  provider: string;
  size?: "default" | "sm";
}) {
  return (
    <span aria-hidden="true" className="connected-account-identity">
      <ShadcnAvatar size={size}>
        {avatarUrl ? <ShadcnAvatarImage alt="" src={avatarUrl} /> : null}
        <ShadcnAvatarFallback>{initials(label)}</ShadcnAvatarFallback>
        <ShadcnAvatarBadge className="provider-emblem">
          <CalendarProviderEmblem provider={provider} />
        </ShadcnAvatarBadge>
      </ShadcnAvatar>
    </span>
  );
}

type CalendarAccountGroup = {
  account: CalendarAccount | undefined;
  accountId: string;
  calendars: Calendar[];
  label: string;
  provider: string;
};

function groupCalendarsByAccount(
  accounts: CalendarAccount[],
  calendars: Calendar[],
): CalendarAccountGroup[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  return [...Map.groupBy(calendars, (calendar) => calendar.accountId)]
    .map(([accountId, accountCalendars]) => {
      const account = accountsById.get(accountId);
      const isLocal = accountCalendars[0]?.provider === "local";
      return {
        account,
        accountId,
        calendars: accountCalendars,
        provider: isLocal
          ? "local"
          : (account?.provider ?? (accountCalendars[0] as Calendar).provider),
        label:
          account?.label ?? account?.email ?? (isLocal ? "My calendars" : "Connected calendars"),
      };
    })
    .toSorted(
      (left, right) => Number(right.provider === "local") - Number(left.provider === "local"),
    );
}

function DayCalendarView({
  calendarsById,
  clearDrag,
  currentTime,
  day,
  dragPreview,
  draggedEventId,
  events,
  followToday,
  moveEvent,
  onCreateRange,
  onExitFollow,
  setEditor,
  setDraggedEventId,
  setDragPreview,
  timeZone,
  today,
  todaySnap,
}: {
  calendarsById: CalendarMap;
  clearDrag: () => void;
  currentTime: Date;
  day: LocalDate;
  dragPreview: CalendarDropPreview | null;
  draggedEventId: string | null;
  events: CalendarEvent[];
  followToday: boolean;
  moveEvent: (event: CalendarEvent, day: LocalDate, minute: number) => void;
  onCreateRange: (draft: EventDraft) => void;
  onExitFollow: () => void;
  setEditor: (editor: Editor) => void;
  setDraggedEventId: (id: string | null) => void;
  setDragPreview: (preview: CalendarDropPreview | null) => void;
  timeZone: string;
  today: LocalDate;
  todaySnap: number;
}) {
  const isToday = sameLocalDate(day, today);
  const allDayEvents = events.filter((event) => event.allDay);
  const timelineEvents = useMemo(
    () => positionTimelineEvents(events, day, timeZone),
    [day, events, timeZone],
  );
  const scrollContainer = useRef<HTMLDivElement>(null);
  const programmaticScrollPosition = useRef<{ left: number; top: number } | null>(null);
  const [contextMinute, setContextMinute] = useState(0);
  const rangeSelection = useCalendarRangeSelection(onCreateRange, timeZone);
  useEffect(() => {
    if (!isToday) scrollTimelineToMinute(scrollContainer.current, 8 * 60);
  }, [isToday]);
  useEffect(() => {
    if (!isToday || !followToday) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
    rememberProgrammaticCalendarScroll(programmaticScrollPosition, scrollContainer.current);
  }, [currentTime, followToday, isToday, timeZone]);
  useEffect(() => {
    if (!isToday || !followToday || todaySnap === 0) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
    rememberProgrammaticCalendarScroll(programmaticScrollPosition, scrollContainer.current);
  }, [currentTime, followToday, isToday, timeZone, todaySnap]);
  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!followToday) return;
    if (consumeProgrammaticCalendarScroll(programmaticScrollPosition, event.currentTarget)) return;
    const target = Math.max(
      0,
      minuteToTimelinePixels(localDateTimeAt(currentTime, timeZone).minute) -
        event.currentTarget.clientHeight / 2,
    );
    if (Math.abs(event.currentTarget.scrollTop - target) > 96) onExitFollow();
  };
  return (
    <section className={`calendar-day-view${isToday ? " is-today" : ""}`}>
      <WorkspaceSecondaryAppBar
        aria-label="Calendar day navigation"
        className="calendar-secondary-app-bar calendar-secondary-app-bar--day"
      >
        <WorkspaceSecondaryAppBarContent>
          <AllDayEvents calendarsById={calendarsById} events={allDayEvents} setEditor={setEditor} />
        </WorkspaceSecondaryAppBarContent>
      </WorkspaceSecondaryAppBar>
      <div className="calendar-timeline-scroll" onScroll={handleScroll} ref={scrollContainer}>
        <div className="calendar-time-grid calendar-time-grid--day">
          <TimeAxis />
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <section
                aria-label="24-hour schedule with 15-minute marks"
                className={`calendar-timeline${draggedEventId ? " is-drag-target" : ""}`}
                onContextMenu={(contextEvent) =>
                  setContextMinute(
                    timelineMinuteAtPointer(contextEvent, contextEvent.currentTarget),
                  )
                }
                onDragLeave={(dragEvent) => clearTimelineDropPreview(dragEvent, setDragPreview)}
                onDragOver={(dragEvent) =>
                  previewTimelineDrop(
                    dragEvent,
                    day,
                    events,
                    draggedEventId,
                    setDragPreview,
                    timeZone,
                  )
                }
                onDrop={(dragEvent) =>
                  dropTimelineEvent(dragEvent, day, events, moveEvent, setDraggedEventId)
                }
                onKeyDown={(event) => rangeSelection.keyDown(event, day)}
                onPointerCancel={rangeSelection.cancel}
                onPointerDown={(event) => rangeSelection.start(event, day)}
                onPointerMove={rangeSelection.move}
                onPointerUp={rangeSelection.finish}
                style={{ height: calendarTimelineHeight }}
              >
                <button className="sr-only" type="button">
                  Create an event range with the keyboard
                </button>
                {rangeSelection.selection && sameLocalDate(rangeSelection.selection.day, day) ? (
                  <CalendarCreateSelection selection={rangeSelection.selection} />
                ) : null}
                {dragPreview?.dayKey === localDateKey(day) ? (
                  <CalendarDropPreview preview={dragPreview} />
                ) : null}
                {isToday ? <TimelineNow currentTime={currentTime} timeZone={timeZone} /> : null}
                {timelineEvents.map((layout) => (
                  <TimelineEvent
                    blockColors={eventBlockColors(layout.event, calendarsById)}
                    calendar={calendarsById.get(layout.event.calendarId)}
                    isDragging={draggedEventId === layout.event.id}
                    key={layout.event.id}
                    layout={layout}
                    onEdit={() => setEditor({ event: layout.event, kind: "event" })}
                    onDragEnd={clearDrag}
                    setDraggedEventId={setDraggedEventId}
                    timeZone={timeZone}
                  />
                ))}
              </section>
            </ContextMenuTrigger>
            <CalendarBlankContextMenu
              day={day}
              minute={contextMinute}
              onCreateRange={onCreateRange}
              timeZone={timeZone}
            />
          </ContextMenu>
        </div>
      </div>
    </section>
  );
}

function WeekCalendarView({
  calendarsById,
  clearDrag,
  currentTime,
  days,
  dragPreview,
  draggedEventId,
  eventsByDay,
  followToday,
  moveEvent,
  onCreateRange,
  onExitFollow,
  setEditor,
  setDraggedEventId,
  setDragPreview,
  selectedDate,
  showDay,
  timeZone,
  today,
  todaySnap,
}: {
  calendarsById: CalendarMap;
  clearDrag: () => void;
  currentTime: Date;
  days: LocalDate[];
  dragPreview: CalendarDropPreview | null;
  draggedEventId: string | null;
  eventsByDay: Map<string, CalendarEvent[]>;
  followToday: boolean;
  moveEvent: (event: CalendarEvent, day: LocalDate, minute: number) => void;
  onCreateRange: (draft: EventDraft) => void;
  onExitFollow: () => void;
  setEditor: (editor: Editor) => void;
  setDraggedEventId: (id: string | null) => void;
  setDragPreview: (preview: CalendarDropPreview | null) => void;
  selectedDate: LocalDate;
  showDay: (day: LocalDate) => void;
  timeZone: string;
  today: LocalDate;
  todaySnap: number;
}) {
  const layoutsByDay = useMemo(
    () =>
      new Map(
        days.map((day) => [
          localDateKey(day),
          positionTimelineEvents(
            eventsByDay.get(localDateKey(day)) as CalendarEvent[],
            day,
            timeZone,
          ),
        ]),
      ),
    [days, eventsByDay, timeZone],
  );
  const weekEvents = useMemo(
    () =>
      Array.from(
        new Map(
          Array.from(eventsByDay.values())
            .flat()
            .map((event) => [event.id, event] as const),
        ).values(),
      ),
    [eventsByDay],
  );
  const scrollContainer = useRef<HTMLDivElement>(null);
  const programmaticScrollPosition = useRef<{ left: number; top: number } | null>(null);
  const includesToday = days.some((day) => sameLocalDate(day, today));
  const rangeSelection = useCalendarRangeSelection(onCreateRange, timeZone);
  useEffect(() => {
    if (!includesToday) scrollTimelineToMinute(scrollContainer.current, 8 * 60);
  }, [includesToday]);
  useEffect(() => {
    if (!includesToday || !followToday) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
    rememberProgrammaticCalendarScroll(programmaticScrollPosition, scrollContainer.current);
  }, [currentTime, followToday, includesToday, timeZone]);
  useEffect(() => {
    if (!includesToday || !followToday || todaySnap === 0) return;
    const container = scrollContainer.current;
    scrollTimelineToMinute(container, localDateTimeAt(new Date(), timeZone).minute);
    const todayButton = container?.querySelector<HTMLElement>('button[aria-current="date"]');
    if (!container || !todayButton) return;
    const containerBounds = container.getBoundingClientRect();
    const todayBounds = todayButton.getBoundingClientRect();
    container.scrollLeft = Math.max(
      0,
      container.scrollLeft +
        todayBounds.left -
        containerBounds.left -
        (container.clientWidth - todayBounds.width) / 2,
    );
    rememberProgrammaticCalendarScroll(programmaticScrollPosition, container);
  }, [followToday, includesToday, timeZone, todaySnap]);
  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!followToday) return;
    const container = event.currentTarget;
    if (consumeProgrammaticCalendarScroll(programmaticScrollPosition, container)) return;
    const verticalTarget = Math.max(
      0,
      minuteToTimelinePixels(localDateTimeAt(currentTime, timeZone).minute) -
        container.clientHeight / 2,
    );
    const todayButton = container.querySelector<HTMLElement>('button[aria-current="date"]');
    if (!todayButton) return;
    const containerBounds = container.getBoundingClientRect();
    const todayBounds = todayButton.getBoundingClientRect();
    const horizontalDistance = Math.abs(
      todayBounds.left + todayBounds.width / 2 - (containerBounds.left + container.clientWidth / 2),
    );
    if (Math.max(Math.abs(container.scrollTop - verticalTarget), horizontalDistance) > 96) {
      onExitFollow();
    }
  };
  return (
    <div className="week-calendar" onScroll={handleScroll} ref={scrollContainer}>
      <div
        className="week-calendar-grid"
        style={{
          gridTemplateColumns: `56px repeat(${days.length}, minmax(140px, 1fr))`,
          minWidth: 56 + days.length * 140,
        }}
      >
        <WorkspaceSecondaryAppBar
          aria-label="Calendar week navigation"
          className="calendar-secondary-app-bar calendar-secondary-app-bar--week"
        >
          <WorkspaceSecondaryAppBarContent
            className="calendar-secondary-app-bar__week-grid"
            style={{
              gridTemplateColumns: `56px repeat(${days.length}, minmax(140px, 1fr))`,
            }}
          >
            <div className="week-time-corner">All day</div>
            {days.map((day) => {
              const dayEvents = eventsByDay.get(localDateKey(day)) as CalendarEvent[];
              const allDayEvents = dayEvents.filter((event) => event.allDay);
              const isToday = sameLocalDate(day, today);
              return (
                <header
                  className={`week-day-header${isToday ? " is-today" : ""}`}
                  key={`header-${localDateKey(day)}`}
                >
                  <div>
                    <span>{formatLocalWeekday(day)}</span>
                    <button
                      aria-current={isToday ? "date" : undefined}
                      data-selected={sameLocalDate(day, selectedDate)}
                      aria-label={`View ${formatLocalDate(day, {
                        day: "numeric",
                        month: "long",
                        weekday: "long",
                        year: "numeric",
                      })}`}
                      onClick={() => showDay(day)}
                      type="button"
                    >
                      {day.day}
                    </button>
                  </div>
                  <AllDayEvents
                    calendarsById={calendarsById}
                    compact
                    events={allDayEvents}
                    setEditor={setEditor}
                  />
                </header>
              );
            })}
          </WorkspaceSecondaryAppBarContent>
        </WorkspaceSecondaryAppBar>
        <TimeAxis />
        {days.map((day, dayIndex) => {
          const layouts = layoutsByDay.get(localDateKey(day)) as TimelineEventLayout[];
          const isToday = sameLocalDate(day, today);
          return (
            <section
              aria-label={`${formatLocalWeekday(day)} timeline`}
              className={`calendar-timeline week-day-timeline${isToday ? " is-today" : ""}${draggedEventId ? " is-drag-target" : ""}`}
              key={`timeline-${localDateKey(day)}`}
              onDragLeave={(dragEvent) => clearTimelineDropPreview(dragEvent, setDragPreview)}
              onDragOver={(dragEvent) =>
                previewTimelineDrop(
                  dragEvent,
                  day,
                  weekEvents,
                  draggedEventId,
                  setDragPreview,
                  timeZone,
                )
              }
              onDrop={(dragEvent) =>
                dropTimelineEvent(dragEvent, day, weekEvents, moveEvent, setDraggedEventId)
              }
              onKeyDown={(event) => rangeSelection.keyDown(event, day)}
              onPointerCancel={rangeSelection.cancel}
              onPointerDown={(event) => rangeSelection.start(event, day)}
              onPointerMove={rangeSelection.move}
              onPointerUp={rangeSelection.finish}
              style={{ height: calendarTimelineHeight }}
            >
              <button className="sr-only" type="button">
                Create an event range on {formatLocalWeekday(day)} with the keyboard
              </button>
              {rangeSelection.selection && sameLocalDate(rangeSelection.selection.day, day) ? (
                <CalendarCreateSelection selection={rangeSelection.selection} />
              ) : null}
              {dragPreview?.dayKey === localDateKey(day) ? (
                <CalendarDropPreview preview={dragPreview} />
              ) : null}
              {dayIndex === 0 && includesToday ? (
                <TimelineNow
                  currentTime={currentTime}
                  spanColumns={days.length}
                  timeZone={timeZone}
                />
              ) : null}
              {layouts.map((layout) => (
                <TimelineEvent
                  blockColors={eventBlockColors(layout.event, calendarsById)}
                  calendar={calendarsById.get(layout.event.calendarId)}
                  compact
                  isDragging={draggedEventId === layout.event.id}
                  key={layout.event.id}
                  layout={layout}
                  onEdit={() => setEditor({ event: layout.event, kind: "event" })}
                  onDragEnd={clearDrag}
                  setDraggedEventId={setDraggedEventId}
                  timeZone={timeZone}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

type TimelinePositionable = {
  allDay: boolean;
  endsAt: string;
  id: string;
  startsAt: string;
};

type TimelineEventLayout<T extends TimelinePositionable = CalendarEvent> = {
  column: number;
  columns: number;
  endMinute: number;
  event: T;
  startMinute: number;
};

function TimeAxis() {
  return (
    <ol
      aria-hidden="true"
      className="calendar-time-axis"
      style={{ height: calendarTimelineHeight }}
    >
      {calendarTimeMarks.map((minute) => (
        <li
          data-major={minute % 60 === 0}
          key={minute}
          style={{ top: minuteToTimelinePixels(minute) }}
        >
          {formatMinuteOfDay(minute)}
        </li>
      ))}
    </ol>
  );
}

function rememberProgrammaticCalendarScroll(
  position: { current: { left: number; top: number } | null },
  container: HTMLElement | null,
) {
  if (!container) return;
  position.current = { left: container.scrollLeft, top: container.scrollTop };
}

function consumeProgrammaticCalendarScroll(
  position: { current: { left: number; top: number } | null },
  container: HTMLElement,
) {
  const expected = position.current;
  if (!expected) return false;
  const matches =
    Math.abs(container.scrollLeft - expected.left) <= 1 &&
    Math.abs(container.scrollTop - expected.top) <= 1;
  if (matches) position.current = null;
  return matches;
}

function TimelineNow({
  currentTime,
  spanColumns,
  timeZone,
}: {
  currentTime: Date;
  spanColumns?: number;
  timeZone: string;
}) {
  return (
    <div
      aria-label={`Current time ${formatTime(currentTime.toISOString(), timeZone)}`}
      className="calendar-now-line"
      role="timer"
      style={{
        right: spanColumns ? "auto" : undefined,
        top: minuteToTimelinePixels(localDateTimeAt(currentTime, timeZone).minute),
        width: spanColumns
          ? `calc(56px + ${spanColumns * 100}% + ${Math.max(0, spanColumns - 1)}px)`
          : undefined,
      }}
    >
      <span>{formatTime(currentTime.toISOString(), timeZone)}</span>
      <i />
    </div>
  );
}

function CalendarDropPreview({ preview }: { preview: CalendarDropPreview }) {
  const dateLabel = formatLocalDate(parseLocalDate(preview.dayKey), {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
  const timeLabel = formatMinuteOfDay(preview.minute);
  return (
    <>
      <div
        aria-label={`Move to ${dateLabel} at ${timeLabel}`}
        aria-live="polite"
        className="calendar-drop-preview"
        role="status"
        style={{
          ...calendarEventColorStyle(preview.color),
          height: Math.max(minuteToTimelinePixels(preview.duration), 18),
          left: 3 + preview.column * 12,
          top: minuteToTimelinePixels(preview.minute),
          width: `calc(100% - ${6 + preview.column * 12}px)`,
        }}
      />
      {typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden="true"
              className="calendar-drag-overlay"
              style={{
                ...calendarEventColorStyle(preview.color),
                height: Math.max(minuteToTimelinePixels(preview.duration), 36),
                left: preview.pointerX - preview.grabOffsetX,
                top: preview.pointerY - preview.grabOffsetY,
                width: preview.width,
              }}
            >
              <span>{dateLabel}</span>
              <strong>{timeLabel}</strong>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function calendarCreateRange(selection: CalendarRangeSelection) {
  const startMinute = Math.min(selection.anchorMinute, selection.currentMinute);
  const endMinute = Math.max(selection.anchorMinute, selection.currentMinute);
  return {
    endMinute:
      endMinute === startMinute ? Math.min(calendarMinutesPerDay, startMinute + 15) : endMinute,
    startMinute,
  };
}

function CalendarCreateSelection({ selection }: { selection: CalendarRangeSelection }) {
  const { endMinute, startMinute } = calendarCreateRange(selection);
  return (
    <div
      aria-label={`New event from ${formatMinuteOfDay(startMinute)} to ${formatMinuteOfDay(endMinute)}`}
      aria-live="polite"
      className="calendar-create-selection"
      role="status"
      style={{
        height: Math.max(minuteToTimelinePixels(endMinute - startMinute), 12),
        top: minuteToTimelinePixels(startMinute),
      }}
    >
      <strong>{formatMinuteOfDay(startMinute)}</strong>
      <span>– {formatMinuteOfDay(endMinute)}</span>
    </div>
  );
}

function useCalendarRangeSelection(onCreateRange: (draft: EventDraft) => void, timeZone: string) {
  const [selection, setSelection] = useState<CalendarRangeSelection | null>(null);
  const selectionRef = useRef<CalendarRangeSelection | null>(null);
  const updateSelection = (next: CalendarRangeSelection | null) => {
    selectionRef.current = next;
    setSelection(next);
  };
  const start = (event: ReactPointerEvent<HTMLElement>, day: LocalDate) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as Element).closest(".calendar-timeline-event")) return;
    const minute = createRangeMinuteAtPointer(event, event.currentTarget);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateSelection({
      active: false,
      anchorMinute: minute,
      currentMinute: minute,
      day,
      originClientY: event.clientY,
      pointerId: event.pointerId,
    });
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = selectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const active = current.active || Math.abs(event.clientY - current.originClientY) >= 4;
    if (!active) return;
    event.preventDefault();
    updateSelection({
      ...current,
      active,
      currentMinute: createRangeMinuteAtPointer(event, event.currentTarget),
    });
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const current = selectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.active) {
      const { endMinute, startMinute } = calendarCreateRange(current);
      onCreateRange({
        endsAt: localDateTimeToUtc(current.day, endMinute, timeZone).toISOString(),
        startsAt: localDateTimeToUtc(current.day, startMinute, timeZone).toISOString(),
      });
    }
    updateSelection(null);
  };
  const commit = (current: CalendarRangeSelection) => {
    const { endMinute, startMinute } = calendarCreateRange(current);
    onCreateRange({
      endsAt: localDateTimeToUtc(current.day, endMinute, timeZone).toISOString(),
      startsAt: localDateTimeToUtc(current.day, startMinute, timeZone).toISOString(),
    });
    updateSelection(null);
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLElement>, day: LocalDate) => {
    const current = selectionRef.current;
    if (event.key === "Escape" && current) {
      event.preventDefault();
      updateSelection(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (current?.pointerId === null) {
        commit(current);
      } else if (!current) {
        updateSelection({
          active: true,
          anchorMinute: 9 * 60,
          currentMinute: 10 * 60,
          day,
          originClientY: 0,
          pointerId: null,
        });
      }
      return;
    }
    if (current?.pointerId !== null || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
      return;
    }
    event.preventDefault();
    updateSelection({
      ...current,
      currentMinute: Math.min(
        calendarMinutesPerDay,
        Math.max(0, current.currentMinute + (event.key === "ArrowDown" ? 15 : -15)),
      ),
    });
  };
  return {
    cancel: () => updateSelection(null),
    finish,
    keyDown,
    move,
    selection: selection?.active ? selection : null,
    start,
  };
}

function calendarEventColorStyle(color: string | null | undefined): CSSProperties {
  return { "--calendar-color": color ?? "#777ce3" } as CSSProperties;
}

type EventBlockColor = { color: string; id: string; mode: "busy" | "details" };

function eventBlockColors(event: CalendarEvent, calendarsById: CalendarMap): EventBlockColor[] {
  return event.blocks.flatMap((block) => {
    const calendar = calendarsById.get(block.calendarId);
    return calendar
      ? [{ color: calendar.color ?? "#777ce3", id: block.eventId, mode: block.mode }]
      : [];
  });
}

function TimelineEvent({
  blockColors,
  calendar,
  compact = false,
  layout,
  onEdit,
  onDragEnd,
  setDraggedEventId,
  isDragging = false,
  timeZone,
}: {
  blockColors: EventBlockColor[];
  calendar: Calendar | undefined;
  compact?: boolean;
  layout: TimelineEventLayout;
  onEdit: () => void;
  onDragEnd: () => void;
  setDraggedEventId: (id: string | null) => void;
  isDragging?: boolean;
  timeZone: string;
}) {
  const { column, endMinute, event, startMinute } = layout;
  const writable = calendar?.isWritable ?? false;
  const [moveBlocked, setMoveBlocked] = useState(false);
  const blockedHoldTriggered = useRef(false);
  const blockedHoldTimer = useRef<number | null>(null);
  const blockedFeedbackTimer = useRef<number | null>(null);
  const blockedMessage = calendar
    ? `${calendar.name} is read-only, so this event can’t be moved.`
    : "This event is read-only and can’t be moved.";
  const clearBlockedHoldTimer = () => {
    if (blockedHoldTimer.current === null) return;
    window.clearTimeout(blockedHoldTimer.current);
    blockedHoldTimer.current = null;
  };
  useEffect(
    () => () => {
      if (blockedHoldTimer.current !== null) window.clearTimeout(blockedHoldTimer.current);
      if (blockedFeedbackTimer.current !== null) window.clearTimeout(blockedFeedbackTimer.current);
    },
    [],
  );
  const startBlockedHold = () => {
    if (writable) return;
    clearBlockedHoldTimer();
    blockedHoldTimer.current = window.setTimeout(() => {
      blockedHoldTriggered.current = true;
      setMoveBlocked(true);
      blockedHoldTimer.current = null;
      if (blockedFeedbackTimer.current !== null) {
        window.clearTimeout(blockedFeedbackTimer.current);
      }
      blockedFeedbackTimer.current = window.setTimeout(() => {
        setMoveBlocked(false);
        blockedFeedbackTimer.current = null;
      }, 2_400);
    }, 350);
  };
  return (
    <CalendarEventContextMenu
      blockedMessage={blockedMessage}
      blockedOpen={moveBlocked}
      calendar={calendar}
      event={event}
      timeZone={timeZone}
    >
      <button
        aria-label={`${formatTime(event.startsAt, timeZone)} ${event.title}`}
        className={`calendar-timeline-event${compact ? " calendar-timeline-event--compact" : ""}${blockColors.length > 0 ? " has-blocks" : ""}${writable ? " is-draggable" : " is-readonly"}${isDragging ? " is-dragging" : ""}${moveBlocked ? " is-move-blocked" : ""}`}
        draggable={writable}
        onDragEnd={onDragEnd}
        onDragStart={(dragEvent) => startCalendarDrag(dragEvent, event, setDraggedEventId)}
        onClick={(clickEvent) => {
          if (blockedHoldTriggered.current) {
            blockedHoldTriggered.current = false;
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            return;
          }
          onEdit();
        }}
        onPointerCancel={clearBlockedHoldTimer}
        onPointerDown={() => {
          blockedHoldTriggered.current = false;
          startBlockedHold();
        }}
        onPointerLeave={() => {
          clearBlockedHoldTimer();
          blockedHoldTriggered.current = false;
        }}
        onPointerUp={clearBlockedHoldTimer}
        style={{
          ...calendarEventColorStyle(calendar?.color),
          height: Math.max(minuteToTimelinePixels(endMinute - startMinute), 18),
          left: 3 + column * 12,
          top: minuteToTimelinePixels(startMinute),
          width: `calc(100% - ${6 + column * 12}px)`,
          zIndex: 2 + column,
        }}
        title={writable ? "Drag to reschedule · Open for precise editing" : "Read-only calendar"}
        type="button"
      >
        {blockColors.length > 0 ? (
          <span aria-hidden="true" className="calendar-timeline-event__block-rails">
            {blockColors.map(({ color, id, mode }) => (
              <i
                className={mode === "details" ? "is-details-included" : "is-shown-as-busy"}
                key={id}
                style={{ "--block-color": color } as CSSProperties}
              />
            ))}
          </span>
        ) : null}
        <strong>
          {event.title}
          {event.blocks.length > 0 ? (
            <LockIcon aria-label="Blocks another calendar" className="linked-block-icon" />
          ) : null}
        </strong>
        <span>{formatTimelineTimeRange(event, timeZone)}</span>
        {event.location ? <small>{event.location}</small> : null}
      </button>
    </CalendarEventContextMenu>
  );
}

function CalendarBlankContextMenu({
  day,
  minute,
  onCreateRange,
  timeZone,
}: {
  day: LocalDate;
  minute: number;
  onCreateRange: (draft: EventDraft) => void;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const canPaste = typeof navigator.clipboard?.readText === "function";
  const startsAt = localDateTimeToUtc(day, minute, timeZone).toISOString();
  const endsAt = localDateTimeToUtc(
    day,
    Math.min(minute + 60, calendarMinutesPerDay - 1),
    timeZone,
  ).toISOString();
  const paste = useMutation({
    mutationFn: async () => {
      const event = parseClipboardCalendarEvent(await navigator.clipboard.readText());
      if (!event) throw new Error("Copy an event from nohmi before pasting it here.");
      const times = movedEventTimes(event, day, minute, timeZone);
      return api.createEvent({
        allDay: event.allDay,
        calendarId: event.calendarId,
        endsAt: times.endsAt,
        location: event.location,
        notes: event.notes,
        startsAt: times.startsAt,
        timezone: timeZone,
        title: event.title,
      });
    },
    onSuccess: () => invalidateMaterial(queryClient),
  });
  return (
    <ContextMenuContent>
      <ContextMenuLabel>{formatHour(Math.floor(minute / 60))}</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onCreateRange({ endsAt, startsAt })}>
        <CalendarPlusIcon aria-hidden="true" /> New event here
      </ContextMenuItem>
      <ContextMenuItem disabled={!canPaste || paste.isPending} onSelect={() => paste.mutate()}>
        <PlusIcon aria-hidden="true" /> Paste event
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function parseClipboardCalendarEvent(value: string): CalendarEvent | undefined {
  try {
    const event = JSON.parse(value) as Partial<CalendarEvent>;
    return typeof event.calendarId === "string" &&
      typeof event.endsAt === "string" &&
      typeof event.startsAt === "string" &&
      typeof event.title === "string" &&
      typeof event.allDay === "boolean"
      ? (event as CalendarEvent)
      : undefined;
  } catch {
    return undefined;
  }
}

function CalendarEventContextMenu({
  blockedMessage,
  blockedOpen = false,
  calendar,
  children,
  event,
  timeZone,
}: {
  blockedMessage?: string;
  blockedOpen?: boolean;
  calendar: Calendar | undefined;
  children: ReactNode;
  event: CalendarEvent;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const canCopy = typeof navigator.clipboard?.writeText === "function";
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const writable = calendar?.isWritable ?? false;
  const destinations = (calendars.data ?? []).filter(
    (candidate) => candidate.id !== event.calendarId && candidate.isWritable,
  );
  const remove = useMutation({
    mutationFn: () => api.deleteEvent(event.id),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const duplicate = useMutation({
    mutationFn: () =>
      api.createEvent({
        allDay: event.allDay,
        calendarId: event.calendarId,
        endsAt: event.endsAt,
        location: event.location,
        notes: event.notes,
        startsAt: event.startsAt,
        timezone: timeZone,
        title: `${event.title} copy`,
      }),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const block = useMutation({
    mutationFn: (calendarId: string) =>
      api.createEventBlock(event.id, { calendarId, mode: "busy" }),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const copy = async () => navigator.clipboard?.writeText(JSON.stringify(event));
  const cut = async () => {
    await copy();
    remove.mutate();
  };
  const trigger = <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>;
  return (
    <ContextMenu>
      {blockedMessage ? (
        <Tooltip open={blockedOpen}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent className="calendar-move-blocked-tooltip" side="top">
            {blockedMessage}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <ContextMenuContent>
        <ContextMenuLabel>{event.title}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canCopy} onSelect={copy}>
          <CopyIcon aria-hidden="true" /> Copy event
        </ContextMenuItem>
        <ContextMenuItem disabled={!canCopy || !writable || remove.isPending} onSelect={cut}>
          <ScissorsIcon aria-hidden="true" /> Cut event
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!writable || duplicate.isPending}
          onSelect={() => duplicate.mutate()}
        >
          <CopyPlusIcon aria-hidden="true" /> Duplicate event
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={destinations.length === 0 || block.isPending}>
            <LockIcon aria-hidden="true" /> Block on calendar
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {destinations.map((destination) => (
              <ContextMenuItem key={destination.id} onSelect={() => block.mutate(destination.id)}>
                {destination.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!writable || remove.isPending}
          onSelect={() => remove.mutate()}
          variant="destructive"
        >
          <TrashIcon aria-hidden="true" /> Delete event
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AllDayEvents({
  calendarsById,
  compact = false,
  events,
  setEditor,
}: {
  calendarsById: CalendarMap;
  compact?: boolean;
  events: CalendarEvent[];
  setEditor: (editor: Editor) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className={`calendar-all-day${compact ? " calendar-all-day--compact" : ""}`}>
      {compact ? null : <span>All day</span>}
      <div>
        {events.map((event) => (
          <button
            aria-label={`All day ${event.title}`}
            key={event.id}
            onClick={() => setEditor({ event, kind: "event" })}
            style={calendarEventColorStyle(calendarsById.get(event.calendarId)?.color)}
            type="button"
          >
            {event.title}
            {event.blocks.length > 0 ? (
              <LockIcon aria-label="Blocks another calendar" className="linked-block-icon" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthCalendarView({
  anchor,
  calendarsById,
  clearDrag,
  days,
  draggedEventId,
  eventsByDay,
  moveEvent,
  setEditor,
  setDraggedEventId,
  showDay,
  timeZone,
  today,
  todaySnap,
}: {
  anchor: LocalDate;
  calendarsById: CalendarMap;
  clearDrag: () => void;
  days: LocalDate[];
  draggedEventId: string | null;
  eventsByDay: Map<string, CalendarEvent[]>;
  moveEvent: (event: CalendarEvent, day: LocalDate, minute: number) => void;
  setEditor: (editor: Editor) => void;
  setDraggedEventId: (id: string | null) => void;
  showDay: (day: LocalDate) => void;
  timeZone: string;
  today: LocalDate;
  todaySnap: number;
}) {
  const scrollContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (todaySnap === 0) return;
    const container = scrollContainer.current;
    const todayButton = container?.querySelector<HTMLElement>('button[aria-current="date"]');
    if (!container || !todayButton) return;
    const containerBounds = container.getBoundingClientRect();
    const todayBounds = todayButton.getBoundingClientRect();
    container.scrollLeft = Math.max(
      0,
      container.scrollLeft +
        todayBounds.left -
        containerBounds.left -
        (container.clientWidth - todayBounds.width) / 2,
    );
    container.scrollTop = Math.max(
      0,
      container.scrollTop +
        todayBounds.top -
        containerBounds.top -
        (container.clientHeight - todayBounds.height) / 2,
    );
  }, [todaySnap]);
  return (
    <div className="month-calendar" ref={scrollContainer}>
      <WorkspaceSecondaryAppBar
        aria-label="Calendar month navigation"
        className="calendar-secondary-app-bar calendar-secondary-app-bar--month"
      >
        <WorkspaceSecondaryAppBarContent className="month-weekdays" aria-hidden="true">
          {calendarWeekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </WorkspaceSecondaryAppBarContent>
      </WorkspaceSecondaryAppBar>
      <div className="month-grid">
        {days.map((day) => {
          const dayEvents = eventsByDay.get(localDateKey(day)) as CalendarEvent[];
          const isToday = sameLocalDate(day, today);
          const outsideMonth = day.month !== anchor.month;
          return (
            <section
              aria-label={`${formatLocalDate(day, { day: "numeric", month: "long" })} calendar day`}
              className={`month-day${isToday ? " is-today" : ""}${outsideMonth ? " is-outside" : ""}${draggedEventId ? " is-drag-target" : ""}`}
              key={localDateKey(day)}
              onDragOver={(dragEvent) => allowCalendarDrop(dragEvent, draggedEventId)}
              onDrop={(dragEvent) => {
                dragEvent.preventDefault();
                const dragged = findDraggedEvent(dragEvent, eventsByDay, draggedEventId);
                if (dragged) {
                  moveEvent(
                    dragged,
                    day,
                    Math.floor(localDateTimeAt(dragged.startsAt, timeZone).minute),
                  );
                }
                setDraggedEventId(null);
              }}
            >
              <header>
                <button
                  aria-current={isToday ? "date" : undefined}
                  data-selected={sameLocalDate(day, anchor)}
                  aria-label={`View ${formatLocalDate(day, {
                    day: "numeric",
                    month: "long",
                    weekday: "long",
                    year: "numeric",
                  })}`}
                  onClick={() => showDay(day)}
                  type="button"
                >
                  {day.day}
                </button>
              </header>
              <div className="month-day__events">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    aria-label={`${event.allDay ? "All day" : formatTime(event.startsAt, timeZone)} ${event.title}`}
                    className={`month-event${calendarsById.get(event.calendarId)?.isWritable ? " is-draggable" : ""}${draggedEventId === event.id ? " is-dragging" : ""}`}
                    draggable={calendarsById.get(event.calendarId)?.isWritable ?? false}
                    key={event.id}
                    onDragEnd={clearDrag}
                    onDragStart={(dragEvent) =>
                      startCalendarDrag(dragEvent, event, setDraggedEventId)
                    }
                    onClick={() => setEditor({ event, kind: "event" })}
                    style={calendarEventColorStyle(calendarsById.get(event.calendarId)?.color)}
                    type="button"
                  >
                    <span className="month-event__time">
                      {event.allDay ? "All day" : formatTime(event.startsAt, timeZone)}
                    </span>
                    <span>{event.title}</span>
                    {event.blocks.length > 0 ? (
                      <LockIcon
                        aria-label="Blocks another calendar"
                        className="linked-block-icon"
                      />
                    ) : null}
                  </button>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="month-day__more">+{dayEvents.length - 3} more</span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function GoalsPage() {
  const queryClient = useQueryClient();
  const goals = useQuery({ queryFn: api.listGoals, queryKey: ["goals"] });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["goals"] });
  const create = useMutation({
    mutationFn: () =>
      api.createGoal({
        description: description.trim() || null,
        progress: 0,
        targetDate: targetDate || null,
        title: title.trim(),
      }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setTargetDate("");
      return refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateGoal>[1] }) =>
      api.updateGoal(id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: refresh,
  });
  if (goals.isPending) return <PageLoading />;
  if (goals.isError) return <InlineError error={goals.error} />;
  return (
    <div className="wide-page flex flex-col gap-6 pb-8">
      <h1 className="sr-only">Goals</h1>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Active outcomes</ShadcnCardTitle>
            <ShadcnCardDescription>
              Keep the list short enough to make tradeoffs clear.
            </ShadcnCardDescription>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            {goals.data.length === 0 ? (
              <EmptyState icon={<TargetIcon />} title="Set a direction">
                Create one outcome you want your daily decisions to support.
              </EmptyState>
            ) : (
              <ShadcnItemGroup>
                {goals.data.map((goal) => (
                  <GoalItem
                    goal={goal}
                    key={goal.id}
                    onDelete={() => remove.mutate(goal.id)}
                    onUpdate={(input) => update.mutate({ id: goal.id, input })}
                    pending={update.isPending || remove.isPending}
                  />
                ))}
              </ShadcnItemGroup>
            )}
          </ShadcnCardContent>
        </ShadcnCard>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>New goal</ShadcnCardTitle>
            <ShadcnCardDescription>
              Describe the outcome, not a long task list.
            </ShadcnCardDescription>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            <ShadcnFieldGroup>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="goal-title">Outcome</ShadcnFieldLabel>
                <ShadcnInput
                  id="goal-title"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ship a calmer weekly rhythm"
                  value={title}
                />
              </ShadcnField>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="goal-description">
                  What does success look like?
                </ShadcnFieldLabel>
                <ShadcnTextarea
                  id="goal-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional context for you and authorized agents"
                  value={description}
                />
              </ShadcnField>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="goal-target-date">Target date</ShadcnFieldLabel>
                <ShadcnInput
                  id="goal-target-date"
                  onChange={(event) => setTargetDate(event.target.value)}
                  type="date"
                  value={targetDate}
                />
              </ShadcnField>
              <ShadcnButton
                disabled={create.isPending || !title.trim()}
                onClick={() => create.mutate()}
              >
                <TargetIcon data-icon="inline-start" />
                Create goal
              </ShadcnButton>
            </ShadcnFieldGroup>
            {create.isError ? <InlineError error={create.error} /> : null}
          </ShadcnCardContent>
        </ShadcnCard>
      </section>
    </div>
  );
}

function GoalItem({
  goal,
  onDelete,
  onUpdate,
  pending,
}: {
  goal: Goal;
  onDelete: () => void;
  onUpdate: (input: Parameters<typeof api.updateGoal>[1]) => void;
  pending: boolean;
}) {
  return (
    <ShadcnItem variant="outline">
      <ShadcnItemContent>
        <ShadcnItemTitle>{goal.title}</ShadcnItemTitle>
        <ShadcnItemDescription>
          {goal.description ?? "No supporting context yet."}
          {goal.targetDate ? ` · Target ${goal.targetDate}` : ""}
        </ShadcnItemDescription>
        <div className="flex items-center gap-2">
          <ShadcnBadge variant={goal.status === "completed" ? "secondary" : "outline"}>
            {goal.status}
          </ShadcnBadge>
          <ShadcnButton
            disabled={pending}
            onClick={() =>
              onUpdate({
                progress: Math.min(100, goal.progress + 10),
                ...(goal.progress >= 90 ? { status: "completed" } : {}),
              })
            }
            size="sm"
            variant="outline"
          >
            {goal.progress}%
          </ShadcnButton>
        </div>
      </ShadcnItemContent>
      <ShadcnItemActions>
        <ShadcnButton
          disabled={pending}
          onClick={() => onUpdate({ status: goal.status === "paused" ? "active" : "paused" })}
          size="sm"
          variant="outline"
        >
          {goal.status === "paused" ? "Resume" : "Pause"}
        </ShadcnButton>
        <ShadcnButton
          aria-label={`Remove ${goal.title}`}
          disabled={pending}
          onClick={onDelete}
          size="icon-sm"
          variant="ghost"
        >
          <TrashIcon />
        </ShadcnButton>
      </ShadcnItemActions>
    </ShadcnItem>
  );
}

function MotivesPage() {
  const queryClient = useQueryClient();
  const motives = useQuery({ queryFn: api.listMotives, queryKey: ["motives"] });
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["motives"] });
  const create = useMutation({
    mutationFn: () => api.createMotive({ detail: detail.trim() || null, title: title.trim() }),
    onSuccess: () => {
      setTitle("");
      setDetail("");
      return refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateMotive>[1] }) =>
      api.updateMotive(id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMotive(id),
    onSuccess: refresh,
  });
  if (motives.isPending) return <PageLoading />;
  if (motives.isError) return <InlineError error={motives.error} />;
  return (
    <div className="wide-page flex flex-col gap-6 pb-8">
      <h1 className="sr-only">Motives</h1>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Decision context</ShadcnCardTitle>
            <ShadcnCardDescription>
              Keep only the principles you want surfaced during planning.
            </ShadcnCardDescription>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            {motives.data.length === 0 ? (
              <EmptyState icon={<CompassIcon />} title="Name what matters">
                Add a value or reason that should inform your priorities.
              </EmptyState>
            ) : (
              <ShadcnItemGroup>
                {motives.data.map((motive) => (
                  <ShadcnItem key={motive.id} variant="outline">
                    <ShadcnItemContent>
                      <ShadcnItemTitle>{motive.title}</ShadcnItemTitle>
                      <ShadcnItemDescription>
                        {motive.detail ?? "No additional context."}
                      </ShadcnItemDescription>
                    </ShadcnItemContent>
                    <ShadcnItemActions>
                      <ShadcnBadge variant={motive.isActive ? "secondary" : "outline"}>
                        {motive.isActive ? "active" : "paused"}
                      </ShadcnBadge>
                      <ShadcnButton
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ id: motive.id, input: { isActive: !motive.isActive } })
                        }
                        size="sm"
                        variant="outline"
                      >
                        {motive.isActive ? "Pause" : "Resume"}
                      </ShadcnButton>
                      <ShadcnButton
                        aria-label={`Remove ${motive.title}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(motive.id)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <TrashIcon />
                      </ShadcnButton>
                    </ShadcnItemActions>
                  </ShadcnItem>
                ))}
              </ShadcnItemGroup>
            )}
          </ShadcnCardContent>
        </ShadcnCard>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>New motive</ShadcnCardTitle>
            <ShadcnCardDescription>
              Use a value, identity, or reason—not a task.
            </ShadcnCardDescription>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            <ShadcnFieldGroup>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="motive-title">Motive</ShadcnFieldLabel>
                <ShadcnInput
                  id="motive-title"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Protect focused time"
                  value={title}
                />
              </ShadcnField>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="motive-detail">Context</ShadcnFieldLabel>
                <ShadcnTextarea
                  id="motive-detail"
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder="Optional explanation for future decisions"
                  value={detail}
                />
              </ShadcnField>
              <ShadcnButton
                disabled={create.isPending || !title.trim()}
                onClick={() => create.mutate()}
              >
                <CompassIcon data-icon="inline-start" />
                Create motive
              </ShadcnButton>
            </ShadcnFieldGroup>
            {create.isError ? <InlineError error={create.error} /> : null}
          </ShadcnCardContent>
        </ShadcnCard>
      </section>
    </div>
  );
}

function MailSyncButton({
  onSelect,
  variant = "outline",
}: {
  onSelect?: () => void;
  variant?: "ghost" | "outline";
}) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryFn: api.listConnectors, queryKey: ["connectors"] });
  const enabledAccounts = useMemo(
    () => accounts.data?.filter((account) => account.mailEnabled) ?? [],
    [accounts.data],
  );
  const sync = useMutation({
    mutationFn: () => Promise.all(enabledAccounts.map((account) => api.syncConnector(account.id))),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-threads"] }),
      ]),
  });

  return (
    <>
      {sync.isError ? (
        <span className="text-destructive text-sm" role="alert">
          {errorMessage(sync.error)}
        </span>
      ) : null}
      <ShadcnButton
        aria-label="Sync all mail accounts"
        disabled={accounts.isPending || enabledAccounts.length === 0 || sync.isPending}
        onClick={() => {
          onSelect?.();
          sync.mutate();
        }}
        size="sm"
        variant={variant}
      >
        <RefreshIcon aria-hidden="true" className={sync.isPending ? "spin" : ""} />
        <span>{sync.isPending ? "Syncing…" : "Sync"}</span>
      </ShadcnButton>
    </>
  );
}

function MailComposeButton({ onSelect }: { onSelect?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const composing = searchParams.get("compose") === "1";

  return (
    <ShadcnButton
      aria-label="Compose mail"
      aria-pressed={composing}
      onClick={() => {
        onSelect?.();
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          if (composing) next.delete("compose");
          else next.set("compose", "1");
          return next;
        });
      }}
      size="sm"
    >
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      <span>Compose</span>
    </ShadcnButton>
  );
}

type SettingsSectionId =
  | "activity"
  | "agent-connections"
  | "appearance"
  | "calendar"
  | "connections"
  | "finances"
  | "goals"
  | "invitations"
  | "mail"
  | "motives"
  | "profile"
  | "reviews"
  | "sessions"
  | "tasks"
  | "texting"
  | "wallpaper"
  | "workspace-access";

const settingsNavigation: Array<{
  items: Array<{ icon: Icon; id: SettingsSectionId; label: string }>;
  label: string;
}> = [
  {
    label: "Account",
    items: [{ icon: UserIcon, id: "profile", label: "Account" }],
  },
  {
    label: "Personal",
    items: [
      { icon: TargetIcon, id: "goals", label: "Goals" },
      { icon: CompassIcon, id: "motives", label: "Motives" },
      { icon: ShieldCheckIcon, id: "reviews", label: "Reviews" },
    ],
  },
  {
    label: "Experience",
    items: [
      { icon: PaintBrushIcon, id: "appearance", label: "Appearance" },
      { icon: ImageIcon, id: "wallpaper", label: "Wallpaper" },
    ],
  },
  {
    label: "History & access",
    items: [
      { icon: ActivityIcon, id: "activity", label: "Activity" },
      { icon: LockIcon, id: "sessions", label: "Sessions" },
      { icon: UserIcon, id: "invitations", label: "Invitations" },
    ],
  },
  {
    label: "Sources",
    items: [{ icon: CloudIcon, id: "connections", label: "Connections" }],
  },
  {
    label: "Workspaces",
    items: [
      { icon: MailIcon, id: "mail", label: "Mail" },
      { icon: BankIcon, id: "finances", label: "Finances" },
      { icon: CalendarIcon, id: "calendar", label: "Calendar" },
      { icon: ListChecksIcon, id: "tasks", label: "Tasks" },
    ],
  },
  {
    label: "Agents",
    items: [
      { icon: PlugIcon, id: "agent-connections", label: "Connected agents" },
      { icon: ShieldCheckIcon, id: "workspace-access", label: "Workspace access" },
      { ...textingSettingsNavigationItem, id: "texting" },
    ],
  },
];

const settingsSectionIds = new Set<SettingsSectionId>(
  settingsNavigation.flatMap((group) => group.items.map((item) => item.id)),
);

function settingsSectionFromSearch(search: string): SettingsSectionId {
  const requestedSection = new URLSearchParams(search).get("section");
  return requestedSection === "account"
    ? "profile"
    : requestedSection === "calendars"
      ? "calendar"
      : requestedSection === "agents" || requestedSection === "automations"
        ? "workspace-access"
        : settingsSectionIds.has(requestedSection as SettingsSectionId)
          ? (requestedSection as SettingsSectionId)
          : "profile";
}

export function settingsSectionPath(section: SettingsSectionId): string {
  return `/settings?section=${section}`;
}

function settingsSectionLabel(section: SettingsSectionId): string {
  return (
    settingsNavigation.flatMap((group) => group.items).find((item) => item.id === section)?.label ??
    "Settings"
  );
}

/** One permission rule for every surface that lists account sections. */
function visibleSettingsNavigation(canManageInvitations: boolean) {
  return settingsNavigation
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (item.id !== "invitations" || canManageInvitations) &&
          (item.id !== "wallpaper" || isTauri()),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** The narrow-layout dock lists the same sections as the sidebar, flattened. */
function settingsSectionPages(
  canManageInvitations: boolean,
  workspaceActions: WorkspaceSettingsActions,
): MobileWorkspacePage[] {
  return visibleSettingsNavigation(canManageInvitations).flatMap((group) =>
    group.items.map(({ icon, id, label }) => {
      const badge = workspaceActionBadge(id, workspaceActions);
      return {
        ...(badge ? { badge } : {}),
        icon,
        label,
        path: settingsSectionPath(id),
      };
    }),
  );
}

function workspaceActionBadge(
  id: SettingsSectionId,
  workspaceActions: WorkspaceSettingsActions,
): string | undefined {
  if (id !== "mail" && id !== "finances" && id !== "calendar" && id !== "tasks") {
    return undefined;
  }
  return workspaceActions[id] ? "Action required" : undefined;
}

function SettingsSidebarNavigation({
  canManageInvitations,
  onNavigate,
  section,
  workspaceActions,
}: {
  canManageInvitations: boolean;
  onNavigate: () => void;
  section: SettingsSectionId;
  workspaceActions: WorkspaceSettingsActions;
}) {
  return (
    <>
      {visibleSettingsNavigation(canManageInvitations).map((group) => (
        <ShadcnSidebarGroup key={group.label}>
          <ShadcnSidebarGroupLabel>{group.label}</ShadcnSidebarGroupLabel>
          <ShadcnSidebarGroupContent>
            <nav aria-label={group.label}>
              <ShadcnSidebarMenu>
                {group.items.map(({ icon, id, label }) => {
                  const badge = workspaceActionBadge(id, workspaceActions);
                  return (
                    <SidebarNavigationItem
                      {...(badge ? { badge } : {})}
                      icon={icon}
                      isActive={section === id}
                      key={id}
                      label={label}
                      onNavigate={onNavigate}
                      path={settingsSectionPath(id)}
                    />
                  );
                })}
                {group.label === "Account" ? (
                  <ShadcnSidebarMenuItem>
                    <ShadcnSidebarMenuButton asChild>
                      <Link onClick={onNavigate} to="/setup">
                        <SparklesIcon aria-hidden="true" />
                        <span>Setup</span>
                      </Link>
                    </ShadcnSidebarMenuButton>
                  </ShadcnSidebarMenuItem>
                ) : null}
              </ShadcnSidebarMenu>
            </nav>
          </ShadcnSidebarGroupContent>
        </ShadcnSidebarGroup>
      ))}
    </>
  );
}

function SettingsPage({ setEditor, user }: { setEditor: (editor: Editor) => void; user: User }) {
  const location = useLocation();
  const requestedSection = new URLSearchParams(location.search).get("section");
  if (requestedSection === "agents" || requestedSection === "automations") {
    const next = new URLSearchParams(location.search);
    next.set("section", "workspace-access");
    return <Navigate replace to={`/settings?${next.toString()}`} />;
  }
  if (requestedSection === "calendars") {
    const next = new URLSearchParams(location.search);
    next.set("section", "calendar");
    return <Navigate replace to={`/settings?${next.toString()}`} />;
  }
  const section = settingsSectionFromSearch(location.search);
  if (section === "wallpaper" && !isTauri()) {
    return <Navigate replace to="/settings?section=appearance" />;
  }
  if (section === "invitations" && user.canManageInvitations !== true) {
    return <Navigate replace to="/settings?section=profile" />;
  }
  return (
    <div className="narrow-page settings-page">
      <section aria-live="polite" className="settings-panel" key={section}>
        {section === "mail" ? <WorkspaceSettings domain="mail" /> : null}
        {section === "finances" ? (
          <div className="flex flex-col gap-6">
            <WorkspaceSettings domain="finances" />
            <FinanceSettings />
          </div>
        ) : null}
        {section === "calendar" ? (
          <div className="flex flex-col gap-6">
            <WorkspaceSettings domain="calendar" />
            <CalendarsSettings setEditor={setEditor} />
          </div>
        ) : null}
        {section === "tasks" ? <WorkspaceSettings domain="tasks" /> : null}
        {section === "connections" ? <ConnectorsSettings /> : null}
        {section === "agent-connections" ? <ConnectedAgentsSettings /> : null}
        {section === "workspace-access" ? <WorkspaceAccessSettings /> : null}
        {section === "activity" ? <ActivityPage /> : null}
        {section === "appearance" ? <ThemeSettings user={user} /> : null}
        {section === "goals" ? <GoalsPage /> : null}
        {section === "motives" ? <MotivesPage /> : null}
        {section === "profile" ? <ProfileSettings user={user} /> : null}
        {section === "reviews" ? <ReviewsPage /> : null}
        {section === "invitations" ? <InvitationsSettings /> : null}
        {section === "sessions" ? <SessionsSettings /> : null}
        {section === "texting" ? <TextingSettings /> : null}
        {section === "wallpaper" ? <PinterestWallpaperSettingsPanel /> : null}
      </section>
    </div>
  );
}

function CalendarsSettings({ setEditor }: { setEditor: (editor: Editor) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const accounts = useQuery({ queryFn: api.listConnectors, queryKey: ["connectors"] });
  const selected = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.setCalendarSelected(id, value),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const remove = useMutation({
    mutationFn: api.deleteCalendar,
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const calendarGroups = groupCalendarsByAccount(accounts.data ?? [], query.data ?? []);
  return (
    <SettingsSection
      action={
        <ShadcnButton onClick={() => setEditor({ kind: "calendar" })}>
          <PlusIcon data-icon="inline-start" className="size-[15px]" /> Local calendar
        </ShadcnButton>
      }
      description="Choose what appears in your unified view."
      title="Calendar sources"
    >
      {calendarGroups.length ? (
        <ShadcnItemGroup className="calendar-settings__groups">
          {calendarGroups.map((group) => (
            <section className="calendar-settings__group" key={group.accountId}>
              <ShadcnItem className="calendar-settings__account" size="sm">
                <ShadcnItemMedia variant="default">
                  <ConnectedAccountIdentity
                    avatarUrl={group.account?.avatarUrl}
                    label={group.label}
                    provider={group.provider}
                    size="default"
                  />
                </ShadcnItemMedia>
                <ShadcnItemContent>
                  <ShadcnItemTitle>{group.label}</ShadcnItemTitle>
                  <ShadcnItemDescription>
                    {group.account?.email && group.account.email !== group.label
                      ? group.account.email
                      : `${group.calendars.length} calendar${group.calendars.length === 1 ? "" : "s"}`}
                  </ShadcnItemDescription>
                </ShadcnItemContent>
                <ShadcnItemActions>
                  <span className="calendar-settings__count">
                    {group.calendars.filter((calendar) => calendar.isSelected).length}/
                    {group.calendars.length}
                  </span>
                </ShadcnItemActions>
              </ShadcnItem>
              <ShadcnItemGroup className="calendar-settings__calendars">
                {group.calendars.map((calendar) => (
                  <ShadcnItem className="calendar-settings__calendar" key={calendar.id} size="sm">
                    <ShadcnItemMedia variant="default">
                      <ShadcnCheckbox
                        aria-label={
                          calendar.isSelected ? `Hide ${calendar.name}` : `Show ${calendar.name}`
                        }
                        checked={calendar.isSelected}
                        className="calendar-settings__checkbox data-checked:border-(--calendar-color) data-checked:bg-(--calendar-color)"
                        disabled={selected.isPending}
                        onCheckedChange={(checked) =>
                          selected.mutate({ id: calendar.id, value: checked === true })
                        }
                        style={
                          {
                            "--calendar-color": calendar.color ?? "var(--primary)",
                          } as CSSProperties
                        }
                      />
                    </ShadcnItemMedia>
                    <ShadcnItemContent>
                      <ShadcnItemTitle>
                        {calendar.name}
                        {!calendar.isWritable ? (
                          <ExternalLinkIcon
                            aria-label="Subscribed calendar"
                            className="calendar-settings__calendar-external"
                            role="img"
                          />
                        ) : null}
                      </ShadcnItemTitle>
                      <ShadcnItemDescription>
                        {calendar.provider === "local"
                          ? "nohmi calendar"
                          : calendar.provider === "icloud"
                            ? "iCloud Calendar"
                            : "Google Calendar"}{" "}
                        · {calendar.isWritable ? "Writable" : "Subscribed"}
                      </ShadcnItemDescription>
                    </ShadcnItemContent>
                    {calendar.provider === "local" ? (
                      <ShadcnItemActions>
                        <ShadcnButton
                          aria-label={`Delete ${calendar.name}`}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(calendar.id)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <TrashIcon />
                        </ShadcnButton>
                      </ShadcnItemActions>
                    ) : null}
                  </ShadcnItem>
                ))}
              </ShadcnItemGroup>
            </section>
          ))}
        </ShadcnItemGroup>
      ) : (
        <p className="settings-empty">No calendars are available.</p>
      )}
    </SettingsSection>
  );
}

function ConnectorsSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const xAccount = useQuery({
    queryFn: api.getXBookmarkAccount,
    queryKey: ["x-bookmarks", "account"],
  });
  const xFolders = useQuery({
    enabled: Boolean(xAccount.data),
    queryFn: api.listXBookmarkFolders,
    queryKey: ["x-bookmarks", "folders"],
  });
  const [showICloud, setShowICloud] = useState(false);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const [icloudReconnectAccount, setICloudReconnectAccount] = useState<CalendarAccount | null>(
    null,
  );
  const googleConnect = useMutation({
    mutationFn: async ({ accountId }: { accountId?: string }) => {
      const url = await api.getGoogleAuthorizationUrl({
        ...(accountId ? { accountId } : {}),
      });
      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return;
      }
      window.location.assign(url);
    },
  });
  const xConnect = useMutation({
    mutationFn: async () => {
      const url = await api.getXBookmarkAuthorizationUrl();
      if (isTauri()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
        return;
      }
      window.location.assign(url);
    },
  });
  const refreshXBookmarks = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["x-bookmarks", "account"] }),
      queryClient.invalidateQueries({ queryKey: ["x-bookmarks", "folders"] }),
    ]);
  const selectXFolder = useMutation({
    mutationFn: api.selectXBookmarkFolder,
    onSuccess: refreshXBookmarks,
  });
  const syncXBookmarks = useMutation({
    mutationFn: api.syncXBookmarks,
    onSuccess: refreshXBookmarks,
  });
  const disconnectXBookmarks = useMutation({
    mutationFn: api.deleteXBookmarkAccount,
    onSuccess: refreshXBookmarks,
  });
  const icloudConnect = useMutation({
    mutationFn: (form: FormData) =>
      api.connectICloud({
        appSpecificPassword: String(form.get("appSpecificPassword")),
        calendar: form.get("calendar") === "on",
        email: String(form.get("email")),
        mail: form.get("mail") === "on",
      }),
    onSuccess: () => {
      setShowICloud(false);
      setICloudReconnectAccount(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-threads"] }),
        invalidateMaterial(queryClient),
      ]);
    },
  });
  const sync = useMutation({
    mutationFn: api.syncConnector,
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        invalidateMaterial(queryClient),
      ]),
    onSuccess: () => toast.success("Connection synced."),
  });
  const disconnect = useMutation({
    mutationFn: api.deleteConnector,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        invalidateMaterial(queryClient),
      ]),
  });
  return (
    <SettingsSection
      action={
        <DropdownMenu onOpenChange={setConnectMenuOpen} open={connectMenuOpen}>
          <DropdownMenuTrigger asChild>
            <ShadcnButton>
              <PlusIcon aria-hidden="true" data-icon="inline-start" /> Connect
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Connect an account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={googleConnect.isPending}
                onSelect={() => googleConnect.mutate({})}
              >
                <CalendarProviderEmblem provider="google" />
                Google
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setICloudReconnectAccount(null);
                  setShowICloud(true);
                }}
              >
                <CalendarProviderEmblem provider="icloud" />
                iCloud
              </DropdownMenuItem>
              <DropdownMenuItem disabled={xConnect.isPending} onSelect={() => xConnect.mutate()}>
                <ExternalLinkIcon aria-hidden="true" />X bookmarks
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      description="One account can expose Calendar, Mail, or both. Providers remain authoritative."
      title="Connections"
    >
      <ConnectionAuthorizationOutcome
        onConnected={() => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ["connectors"] }),
            queryClient.invalidateQueries({ queryKey: ["x-bookmarks", "account"] }),
            queryClient.invalidateQueries({ queryKey: ["x-bookmarks", "folders"] }),
            queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
            queryClient.invalidateQueries({ queryKey: ["mail-threads"] }),
            invalidateMaterial(queryClient),
          ]);
        }}
        onRetry={(provider) => {
          if (provider === "google") googleConnect.mutate({});
          else if (provider === "x") xConnect.mutate();
          else setConnectMenuOpen(true);
        }}
      />
      {googleConnect.error && <SettingsError error={googleConnect.error} />}
      {xConnect.error && <SettingsError error={xConnect.error} />}
      {selectXFolder.error && <SettingsError error={selectXFolder.error} />}
      {syncXBookmarks.error && <SettingsError error={syncXBookmarks.error} />}
      {disconnectXBookmarks.error && <SettingsError error={disconnectXBookmarks.error} />}
      {icloudConnect.error && <SettingsError error={icloudConnect.error} />}
      {disconnect.error && <SettingsError error={disconnect.error} />}
      {showICloud ? (
        <form
          className="icloud-connect-panel"
          onSubmit={(event) => {
            event.preventDefault();
            icloudConnect.mutate(new FormData(event.currentTarget));
          }}
        >
          <ShadcnAlert>
            <CloudIcon />
            <ShadcnAlertTitle>Add iCloud</ShadcnAlertTitle>
            <ShadcnAlertDescription>
              Use an app-specific password—not your Apple Account password. It is encrypted and can
              be revoked from Apple at any time.
            </ShadcnAlertDescription>
          </ShadcnAlert>
          <ShadcnFieldGroup className="icloud-connect-panel__fields">
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="icloud-email">Apple Account email</ShadcnFieldLabel>
              <ShadcnInput
                autoComplete="email"
                id="icloud-email"
                name="email"
                placeholder="name@icloud.com"
                defaultValue={icloudReconnectAccount?.email ?? ""}
                required
                type="email"
              />
            </ShadcnField>
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="icloud-app-password">
                App-specific password
              </ShadcnFieldLabel>
              <ShadcnInput
                autoComplete="off"
                id="icloud-app-password"
                name="appSpecificPassword"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                required
                type="password"
              />
            </ShadcnField>
          </ShadcnFieldGroup>
          <ShadcnFieldSet>
            <ShadcnFieldLegend variant="label">Services to connect</ShadcnFieldLegend>
            <ShadcnFieldGroup className="icloud-service-options">
              <ShadcnField orientation="horizontal">
                <ShadcnCheckbox defaultChecked id="icloud-mail" name="mail" />
                <ShadcnFieldContent>
                  <ShadcnFieldLabel htmlFor="icloud-mail">Mail</ShadcnFieldLabel>
                  <ShadcnFieldDescription>
                    Read mailboxes and message content through IMAP.
                  </ShadcnFieldDescription>
                </ShadcnFieldContent>
              </ShadcnField>
              <ShadcnField orientation="horizontal">
                <ShadcnCheckbox defaultChecked id="icloud-calendar" name="calendar" />
                <ShadcnFieldContent>
                  <ShadcnFieldLabel htmlFor="icloud-calendar">Calendar</ShadcnFieldLabel>
                  <ShadcnFieldDescription>
                    Read and edit calendars through CalDAV.
                  </ShadcnFieldDescription>
                </ShadcnFieldContent>
              </ShadcnField>
            </ShadcnFieldGroup>
          </ShadcnFieldSet>
          <div className="icloud-connect-panel__footer">
            <a href="https://account.apple.com/account/manage" rel="noreferrer" target="_blank">
              Create an app-specific password <ExternalLinkIcon className="size-[13px]" />
            </a>
            <div>
              <ShadcnButton
                onClick={() => {
                  setShowICloud(false);
                  setICloudReconnectAccount(null);
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </ShadcnButton>
              <ShadcnButton disabled={icloudConnect.isPending} type="submit">
                {icloudConnect.isPending ? "Connecting iCloud" : "Add iCloud"}
              </ShadcnButton>
            </div>
          </div>
        </form>
      ) : null}
      {xAccount.data ? (
        <XBookmarksConnectorRow
          account={xAccount.data}
          disconnect={() => disconnectXBookmarks.mutate()}
          folders={xFolders.data ?? []}
          selectFolder={(folderId) => selectXFolder.mutate(folderId)}
          sync={() => syncXBookmarks.mutate()}
          syncing={selectXFolder.isPending || syncXBookmarks.isPending}
        />
      ) : null}
      {query.data?.length ? (
        <ShadcnItemGroup>
          {query.data.map((account) => (
            <ConnectorRow
              account={account}
              disconnect={() => disconnect.mutate(account.id)}
              {...(account.provider === "google" && !account.mailEnabled
                ? { enableMail: () => googleConnect.mutate({ accountId: account.id }) }
                : {})}
              key={account.id}
              {...(connectionHealth(account).state === "reconnect"
                ? {
                    reconnect: () => {
                      if (account.provider === "google") {
                        googleConnect.mutate({ accountId: account.id });
                      } else {
                        setICloudReconnectAccount(account);
                        setShowICloud(true);
                      }
                    },
                  }
                : {})}
              sync={() => sync.mutate(account.id)}
              syncing={sync.isPending && sync.variables === account.id}
            />
          ))}
        </ShadcnItemGroup>
      ) : (
        <p className="settings-empty">
          No external calendars connected. Your local calendar already works.
        </p>
      )}
    </SettingsSection>
  );
}

function XBookmarksConnectorRow({
  account,
  disconnect,
  folders,
  selectFolder,
  sync,
  syncing,
}: {
  account: XBookmarkAccount;
  disconnect: () => void;
  folders: Array<{ id: string; name: string; remoteFolderId: string }>;
  selectFolder: (folderId: string) => void;
  sync: () => void;
  syncing: boolean;
}) {
  return (
    <ShadcnItem variant="outline">
      <ShadcnItemMedia className="provider-icon" variant="icon">
        𝕏
      </ShadcnItemMedia>
      <ShadcnItemContent>
        <ShadcnItemTitle>{account.displayName ?? `@${account.username}`}</ShadcnItemTitle>
        <ShadcnItemDescription>
          {account.syncError
            ? "X bookmarks need attention. Try syncing again or reconnect X."
            : account.lastSyncedAt
              ? `Synced ${formatRelative(account.lastSyncedAt)}`
              : "Select the bookmark folder to sync"}
        </ShadcnItemDescription>
        <div className="capability-badges">
          <ShadcnBadge variant="secondary">Read-only bookmarks</ShadcnBadge>
          <select
            aria-label="X bookmark folder"
            disabled={syncing || !folders.length}
            onChange={(event) => selectFolder(event.target.value)}
            value={account.selectedFolderId ?? ""}
          >
            <option disabled value="">
              Choose a folder
            </option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.remoteFolderId}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
      </ShadcnItemContent>
      <ShadcnItemActions>
        <ShadcnBadge variant={account.syncStatus === "error" ? "destructive" : "secondary"}>
          {account.syncStatus === "error"
            ? "Needs attention"
            : account.syncStatus === "syncing"
              ? "Syncing"
              : "Ready"}
        </ShadcnBadge>
        <ShadcnButton
          aria-label={`Sync X bookmarks for ${account.username}`}
          disabled={syncing || !account.selectedFolderId}
          onClick={sync}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RefreshIcon className={syncing ? "spin" : ""} />
        </ShadcnButton>
        <ShadcnButton
          aria-label={`Disconnect X bookmarks for ${account.username}`}
          onClick={disconnect}
          size="icon"
          type="button"
          variant="ghost"
        >
          <TrashIcon />
        </ShadcnButton>
      </ShadcnItemActions>
    </ShadcnItem>
  );
}

async function applyPinterestWallpaper(settings: PinterestWallpaperSettings): Promise<string[]> {
  const pins = await api.listPinterestPins(12);
  if (pins.length < 4) {
    throw new Error("This board needs at least four image Pins to make a collage.");
  }
  if (!isTauri()) {
    throw new Error("Pinterest wallpaper is available in the nohmi desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke<string>("apply_pinterest_wallpaper", {
      backgroundColor: settings.backgroundColor,
      backgroundMode: settings.backgroundMode,
      boardLabel: pinterestBoardLabel(settings.boardUrl),
      cornerRadius: settings.cornerRadius,
      imageUrls: pins.map((pin) => pin.imageUrl),
      frameSpacing: settings.frameSpacing,
      layout: settings.layout,
      mosaicFit: settings.mosaicFit,
      paddingBottom: settings.paddingBottom,
      paddingEnd: settings.paddingEnd,
      paddingStart: settings.paddingStart,
      paddingTop: settings.paddingTop,
      rotationDegrees: settings.rotationDegrees,
      tileSize: settings.tileSize,
    });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "Could not apply the Pinterest wallpaper.");
  }
  await api.recordPinterestWallpaperApplied();
  return pins.map((pin) => pin.imageUrl);
}

function pinterestBoardLabel(boardUrl: string | null): string {
  if (!boardUrl) return "Pinterest";
  const slug = new URL(boardUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!slug) return "Pinterest";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

async function unavailablePinterestWallpaperSettings() {
  return {
    backgroundColor: "#ffffff",
    backgroundMode: "white" as const,
    boardUrl: null,
    cornerRadius: 0,
    enabled: false,
    frameSpacing: 16,
    lastAppliedAt: null,
    mosaicFit: "preserve" as const,
    paddingBottom: 16,
    paddingEnd: 16,
    paddingLinked: true,
    paddingStart: 16,
    paddingTop: 16,
    layout: "grid" as const,
    rotationDegrees: 0,
    tileSize: 64,
  };
}

type DesktopPreviewEnvironment = {
  hasNotch: boolean;
  platform: "linux" | "macos" | "windows" | "unknown";
  safeArea: { bottom: number; end: number; start: number; top: number };
  screen: { height: number; width: number };
};

async function getDesktopPreviewEnvironment(): Promise<DesktopPreviewEnvironment> {
  if (!isTauri()) {
    return {
      hasNotch: false,
      platform: "unknown",
      safeArea: { bottom: 0, end: 0, start: 0, top: 0 },
      screen: { height: 0, width: 0 },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopPreviewEnvironment>("desktop_preview_environment");
}

function PinterestWallpaperScheduler() {
  const settings = useQuery({
    enabled: isTauri(),
    queryFn: api.getPinterestWallpaperSettings ?? unavailablePinterestWallpaperSettings,
    queryKey: ["pinterest-wallpaper"],
    retry: false,
  });
  const applying = useRef(false);
  useEffect(() => {
    const value = settings.data;
    if (!isTauri() || !value?.boardUrl || !value.enabled) return;
    const refresh = async () => {
      if (applying.current) return;
      applying.current = true;
      try {
        await applyPinterestWallpaper(value);
      } catch {
        // The settings panel keeps actionable errors visible; scheduled refreshes stay quiet.
      } finally {
        applying.current = false;
      }
    };
    const alreadyAppliedToday = value.lastAppliedAt
      ? new Date(value.lastAppliedAt).toDateString() === new Date().toDateString()
      : false;
    if (!alreadyAppliedToday) void refresh();
    let timer: number;
    const scheduleNextRefresh = () => {
      const next = new Date();
      next.setHours(8, 0, 0, 0);
      if (next <= new Date()) next.setDate(next.getDate() + 1);
      timer = window.setTimeout(() => {
        void refresh().finally(scheduleNextRefresh);
      }, next.getTime() - Date.now());
    };
    scheduleNextRefresh();
    return () => window.clearTimeout(timer);
  }, [settings.data]);
  return null;
}

function PinterestWallpaperSettingsPanel() {
  return <PinterestWallpaperDesktopSettingsPanel />;
}

function PinterestWallpaperDesktopSettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryFn: api.getPinterestWallpaperSettings ?? unavailablePinterestWallpaperSettings,
    queryKey: ["pinterest-wallpaper"],
    retry: false,
  });
  const [boardUrl, setBoardUrl] = useState("");
  const [appliedImages, setAppliedImages] = useState<string[]>([]);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [cornerRadius, setCornerRadius] = useState(0);
  const [frameSpacing, setFrameSpacing] = useState(16);
  const [paddingBottom, setPaddingBottom] = useState(16);
  const [paddingEnd, setPaddingEnd] = useState(16);
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [paddingStart, setPaddingStart] = useState(16);
  const [paddingTop, setPaddingTop] = useState(16);
  const [rotationDegrees, setRotationDegrees] = useState(0);
  const [showDesktopOverlay, setShowDesktopOverlay] = useState(true);
  const [tileSize, setTileSize] = useState(64);
  useEffect(() => {
    setBoardUrl(settings.data?.boardUrl ?? "");
    setBackgroundColor(settings.data?.backgroundColor ?? "#ffffff");
    setCornerRadius(settings.data?.cornerRadius ?? 0);
    setFrameSpacing(settings.data?.frameSpacing ?? 16);
    setPaddingBottom(settings.data?.paddingBottom ?? 16);
    setPaddingEnd(settings.data?.paddingEnd ?? 16);
    setPaddingLinked(settings.data?.paddingLinked ?? true);
    setPaddingStart(settings.data?.paddingStart ?? 16);
    setPaddingTop(settings.data?.paddingTop ?? 16);
    setRotationDegrees(settings.data?.rotationDegrees ?? 0);
    setTileSize(settings.data?.tileSize ?? 64);
  }, [settings.data]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pinterest-wallpaper"] }),
      queryClient.invalidateQueries({ queryKey: ["pinterest-wallpaper-preview"] }),
    ]);
  };
  const update = useMutation({
    mutationFn: api.updatePinterestWallpaperSettings,
    onMutate: (input) => {
      const previous = queryClient.getQueryData<PinterestWallpaperSettings>([
        "pinterest-wallpaper",
      ]);
      if (previous) {
        const changed = Object.fromEntries(
          Object.entries(input).filter(([, inputValue]) => inputValue !== undefined),
        ) as Partial<PinterestWallpaperSettings>;
        queryClient.setQueryData<PinterestWallpaperSettings>(["pinterest-wallpaper"], {
          ...previous,
          ...changed,
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["pinterest-wallpaper"], context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pinterest-wallpaper"] });
    },
  });
  const updatePadding = (edge: "bottom" | "end" | "start" | "top", next: number) => {
    const values = paddingLinked
      ? { paddingBottom: next, paddingEnd: next, paddingStart: next, paddingTop: next }
      : {
          paddingBottom: edge === "bottom" ? next : paddingBottom,
          paddingEnd: edge === "end" ? next : paddingEnd,
          paddingStart: edge === "start" ? next : paddingStart,
          paddingTop: edge === "top" ? next : paddingTop,
        };
    setPaddingBottom(values.paddingBottom);
    setPaddingEnd(values.paddingEnd);
    setPaddingStart(values.paddingStart);
    setPaddingTop(values.paddingTop);
    update.mutate(values);
  };
  const apply = useMutation({
    mutationFn: () => {
      if (!settings.data) throw new Error("Wallpaper settings are still loading.");
      return applyPinterestWallpaper(settings.data);
    },
    onSuccess: async (images) => {
      setAppliedImages(images);
      await invalidate();
      toast.success("Wallpaper refreshed.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const value = settings.data;
  const dailyBackdropTimestamp = value?.lastAppliedAt
    ? new Date(value.lastAppliedAt).getTime()
    : Date.now();
  const preview = useQuery({
    enabled: Boolean(value?.boardUrl),
    queryFn: () => api.listPinterestPins(12),
    queryKey: ["pinterest-wallpaper-preview", value?.boardUrl],
    retry: false,
  });
  const desktopEnvironment = useQuery({
    enabled: true,
    queryFn: getDesktopPreviewEnvironment,
    queryKey: ["desktop-preview-environment"],
    retry: false,
  });
  return (
    <SettingsSection
      action={
        <ShadcnButton
          disabled={!value?.boardUrl || apply.isPending || update.isPending}
          onClick={() => apply.mutate()}
        >
          <RefreshIcon data-icon="inline-start" className="size-[15px]" />
          {apply.isPending ? "Refreshing" : "Refresh now"}
        </ShadcnButton>
      }
      description="Paste a public board URL and nohmi will compose a fresh tiled collage from its Pins each day."
      title="Pinterest wallpaper"
    >
      {settings.error ? <SettingsError error={settings.error} /> : null}
      {update.error ? <SettingsError error={update.error} /> : null}
      {preview.error ? <SettingsError error={preview.error} /> : null}
      <ShadcnFieldGroup className="pinterest-wallpaper__controls">
        <ShadcnField>
          <ShadcnFieldLabel htmlFor="pinterest-board-url">Public board URL</ShadcnFieldLabel>
          <ShadcnInput
            autoComplete="url"
            id="pinterest-board-url"
            onBlur={() => update.mutate({ boardUrl: boardUrl.trim() || null })}
            onChange={(event) => setBoardUrl(event.target.value)}
            placeholder="https://www.pinterest.com/name/board-name/"
            type="url"
            value={boardUrl}
          />
          <ShadcnFieldDescription>
            The board must be public. If Pinterest only exposes a few Pins, nohmi repeats them to
            complete the collage.
          </ShadcnFieldDescription>
        </ShadcnField>
        <ShadcnField orientation="horizontal">
          <ShadcnCheckbox
            checked={value?.enabled ?? false}
            disabled={!value?.boardUrl || update.isPending}
            id="pinterest-daily"
            onCheckedChange={(checked) => update.mutate({ enabled: checked === true })}
          />
          <ShadcnFieldContent>
            <ShadcnFieldLabel htmlFor="pinterest-daily">Refresh every day</ShadcnFieldLabel>
            <ShadcnFieldDescription>
              A new collage is applied at 8:00 AM while nohmi is running, and catches up when you
              next open it.
            </ShadcnFieldDescription>
          </ShadcnFieldContent>
        </ShadcnField>
        <ShadcnField>
          <ShadcnFieldLabel>Layout</ShadcnFieldLabel>
          <ShadcnToggleGroup
            aria-label="Wallpaper layout"
            onValueChange={(next) => {
              if (next === "grid" || next === "stack") update.mutate({ layout: next });
            }}
            size="sm"
            type="single"
            value={value?.layout ?? "grid"}
            variant="outline"
          >
            <ShadcnToggleGroupItem aria-label="Tiled grid" value="grid">
              <GridIcon data-icon="inline-start" className="size-[15px]" /> Grid
            </ShadcnToggleGroupItem>
            <ShadcnToggleGroupItem aria-label="Overlapping stack" value="stack">
              <LayersIcon data-icon="inline-start" className="size-[15px]" /> Stack
            </ShadcnToggleGroupItem>
          </ShadcnToggleGroup>
          <ShadcnFieldDescription>
            Grid keeps every image tidy. Stack layers them like pinned photos.
          </ShadcnFieldDescription>
        </ShadcnField>
      </ShadcnFieldGroup>
      <ShadcnFieldSet className="pinterest-wallpaper__fieldset">
        <ShadcnFieldLegend>Appearance</ShadcnFieldLegend>
        <ShadcnFieldDescription>
          Tune how the board’s images are cropped, spaced, and presented.
        </ShadcnFieldDescription>
        <ShadcnFieldGroup className="pinterest-wallpaper__controls">
          <ShadcnField>
            <ShadcnFieldLabel>Mosaic fit</ShadcnFieldLabel>
            <ShadcnToggleGroup
              aria-label="Mosaic fit"
              onValueChange={(next) => {
                if (next === "preserve" || next === "fill") update.mutate({ mosaicFit: next });
              }}
              size="sm"
              type="single"
              value={value?.mosaicFit ?? "preserve"}
              variant="outline"
            >
              <ShadcnToggleGroupItem aria-label="Preserve image shapes" value="preserve">
                Preserve images
              </ShadcnToggleGroupItem>
              <ShadcnToggleGroupItem aria-label="Fill the rectangular frame" value="fill">
                Fill frame
              </ShadcnToggleGroupItem>
            </ShadcnToggleGroup>
            <ShadcnFieldDescription>
              Preserve keeps every image uncropped and centers the clean mosaic. Fill makes an exact
              rectangle with equal edges by allowing a small, centered crop.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel>Backdrop</ShadcnFieldLabel>
            <ShadcnToggleGroup
              aria-label="Wallpaper backdrop"
              onValueChange={(next) => {
                if (
                  next === "white" ||
                  next === "custom" ||
                  next === "matched" ||
                  next === "random"
                ) {
                  update.mutate({ backgroundMode: next });
                }
              }}
              size="sm"
              type="single"
              value={value?.backgroundMode ?? "white"}
              variant="outline"
            >
              <ShadcnToggleGroupItem aria-label="White backdrop" value="white">
                White
              </ShadcnToggleGroupItem>
              <ShadcnToggleGroupItem aria-label="Custom backdrop" value="custom">
                Custom
              </ShadcnToggleGroupItem>
              <ShadcnToggleGroupItem aria-label="Color-matched backdrop" value="matched">
                Matched
              </ShadcnToggleGroupItem>
              <ShadcnToggleGroupItem aria-label="Daily random backdrop" value="random">
                Daily
              </ShadcnToggleGroupItem>
            </ShadcnToggleGroup>
            {value?.backgroundMode === "custom" ? (
              <ShadcnInput
                aria-label="Custom backdrop color"
                className="pinterest-wallpaper__color-input"
                onChange={(event) => setBackgroundColor(event.target.value)}
                onBlur={() => update.mutate({ backgroundColor })}
                type="color"
                value={backgroundColor}
              />
            ) : null}
            <ShadcnFieldDescription>
              Match samples the board’s colors; Daily picks a fresh complementary color each
              refresh.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="pinterest-tile-size">
              Image size · {tileSize}%
            </ShadcnFieldLabel>
            <ShadcnSlider
              id="pinterest-tile-size"
              max={96}
              min={32}
              onValueChange={(next) => setTileSize(next[0] ?? 64)}
              onValueCommit={(next) => update.mutate({ tileSize: next[0] ?? 64 })}
              step={4}
              value={[tileSize]}
            />
            <ShadcnFieldDescription>
              Small shows more Pins; large lets each one breathe.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="pinterest-rotation">
              Rotation · {rotationDegrees}°
            </ShadcnFieldLabel>
            <ShadcnSlider
              id="pinterest-rotation"
              max={16}
              min={0}
              onValueChange={(next) => setRotationDegrees(next[0] ?? 0)}
              onValueCommit={(next) => update.mutate({ rotationDegrees: next[0] ?? 0 })}
              step={1}
              value={[rotationDegrees]}
            />
            <ShadcnFieldDescription>
              Add a little tilt, especially nice with the stacked layout.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="pinterest-frame-spacing">
              Image gap · {frameSpacing}px
            </ShadcnFieldLabel>
            <ShadcnSlider
              id="pinterest-frame-spacing"
              max={72}
              min={0}
              onValueChange={(next) => setFrameSpacing(next[0] ?? 16)}
              onValueCommit={(next) => update.mutate({ frameSpacing: next[0] ?? 16 })}
              step={2}
              value={[frameSpacing]}
            />
            <ShadcnFieldDescription>
              The space between images. The backdrop color shows through here.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="pinterest-corner-radius">
              Image corners · {cornerRadius}px
            </ShadcnFieldLabel>
            <ShadcnSlider
              id="pinterest-corner-radius"
              max={80}
              min={0}
              onValueChange={(next) => setCornerRadius(next[0] ?? 0)}
              onValueCommit={(next) => update.mutate({ cornerRadius: next[0] ?? 0 })}
              step={2}
              value={[cornerRadius]}
            />
            <ShadcnFieldDescription>
              Round each image while keeping its full shape intact.
            </ShadcnFieldDescription>
          </ShadcnField>
        </ShadcnFieldGroup>
      </ShadcnFieldSet>
      <ShadcnFieldSet className="pinterest-wallpaper__fieldset">
        <ShadcnFieldLegend>Framing</ShadcnFieldLegend>
        <ShadcnFieldDescription>
          Control the canvas around the collage and its desktop preview guides.
        </ShadcnFieldDescription>
        <ShadcnFieldGroup className="pinterest-wallpaper__controls">
          <ShadcnField orientation="horizontal">
            <ShadcnCheckbox
              checked={paddingLinked}
              id="pinterest-padding-linked"
              onCheckedChange={(checked) => {
                const linked = checked === true;
                setPaddingLinked(linked);
                if (linked) {
                  setPaddingBottom(paddingTop);
                  setPaddingEnd(paddingTop);
                  setPaddingStart(paddingTop);
                  update.mutate({
                    paddingBottom: paddingTop,
                    paddingEnd: paddingTop,
                    paddingLinked: true,
                    paddingStart: paddingTop,
                  });
                } else {
                  update.mutate({ paddingLinked: false });
                }
              }}
            />
            <ShadcnFieldContent>
              <ShadcnFieldLabel htmlFor="pinterest-padding-linked">
                Link edge padding
              </ShadcnFieldLabel>
              <ShadcnFieldDescription>
                Move every edge together, or unlock them to push the collage toward one side.
              </ShadcnFieldDescription>
            </ShadcnFieldContent>
          </ShadcnField>
          {paddingLinked ? (
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="pinterest-padding-top">
                Edge padding · {paddingTop}px
              </ShadcnFieldLabel>
              <ShadcnSlider
                id="pinterest-padding-top"
                max={240}
                min={0}
                onValueChange={(next) => {
                  const nextPadding = next[0] ?? 16;
                  setPaddingTop(nextPadding);
                  setPaddingBottom(nextPadding);
                  setPaddingStart(nextPadding);
                  setPaddingEnd(nextPadding);
                }}
                onValueCommit={(next) => updatePadding("top", next[0] ?? 16)}
                step={4}
                value={[paddingTop]}
              />
              <ShadcnFieldDescription>
                All edges move together. Turn off linked padding to adjust each edge separately.
              </ShadcnFieldDescription>
            </ShadcnField>
          ) : (
            <div className="pinterest-wallpaper__padding-grid">
              {(
                [
                  ["top", "Top", paddingTop],
                  ["bottom", "Bottom", paddingBottom],
                  ["start", "Start", paddingStart],
                  ["end", "End", paddingEnd],
                ] as const
              ).map(([edge, label, padding]) => (
                <ShadcnField key={edge}>
                  <ShadcnFieldLabel htmlFor={`pinterest-padding-${edge}`}>
                    {label} · {padding}px
                  </ShadcnFieldLabel>
                  <ShadcnSlider
                    id={`pinterest-padding-${edge}`}
                    max={240}
                    min={0}
                    onValueChange={(next) => {
                      const value = next[0] ?? 16;
                      if (edge === "top") setPaddingTop(value);
                      if (edge === "bottom") setPaddingBottom(value);
                      if (edge === "start") setPaddingStart(value);
                      if (edge === "end") setPaddingEnd(value);
                      if (paddingLinked) {
                        setPaddingTop(value);
                        setPaddingBottom(value);
                        setPaddingStart(value);
                        setPaddingEnd(value);
                      }
                    }}
                    onValueCommit={(next) => updatePadding(edge, next[0] ?? 16)}
                    step={4}
                    value={[padding]}
                  />
                </ShadcnField>
              ))}
            </div>
          )}
          {desktopEnvironment.data ? (
            <ShadcnField orientation="horizontal">
              <ShadcnCheckbox
                checked={showDesktopOverlay}
                id="pinterest-desktop-overlay"
                onCheckedChange={(checked) => setShowDesktopOverlay(checked === true)}
              />
              <ShadcnFieldContent>
                <ShadcnFieldLabel htmlFor="pinterest-desktop-overlay">
                  Show desktop safe areas
                </ShadcnFieldLabel>
                <ShadcnFieldDescription>
                  {desktopEnvironment.data
                    ? `${desktopEnvironment.data.platform === "macos" ? "Mac" : desktopEnvironment.data.platform} menu and dock areas appear over the preview.`
                    : "The desktop app measures your system’s menu and taskbar area for this preview."}
                </ShadcnFieldDescription>
              </ShadcnFieldContent>
            </ShadcnField>
          ) : null}
        </ShadcnFieldGroup>
      </ShadcnFieldSet>
      {value?.boardUrl ? (
        <PinterestWallpaperPreview
          backgroundColor={backgroundColor}
          backgroundMode={value.backgroundMode}
          cornerRadius={cornerRadius}
          layout={value.layout}
          mosaicFit={value.mosaicFit}
          pins={
            preview.data ??
            appliedImages.map((imageUrl, index) => ({ id: String(index), imageUrl, title: null }))
          }
          frameSpacing={frameSpacing}
          paddingBottom={paddingBottom}
          paddingEnd={paddingEnd}
          paddingStart={paddingStart}
          paddingTop={paddingTop}
          rotationDegrees={rotationDegrees}
          {...(showDesktopOverlay && desktopEnvironment.data
            ? { desktopEnvironment: desktopEnvironment.data }
            : {})}
          dailyBackdropTimestamp={dailyBackdropTimestamp}
          previewError={preview.error ? errorMessage(preview.error) : null}
          tileSize={tileSize}
        />
      ) : null}
    </SettingsSection>
  );
}

function PinterestWallpaperPreview({
  backgroundColor,
  backgroundMode,
  cornerRadius,
  dailyBackdropTimestamp,
  frameSpacing,
  layout,
  mosaicFit,
  paddingBottom,
  paddingEnd,
  paddingStart,
  paddingTop,
  pins,
  previewError,
  rotationDegrees,
  desktopEnvironment,
  tileSize,
}: {
  backgroundColor: string;
  backgroundMode: PinterestWallpaperSettings["backgroundMode"];
  cornerRadius: number;
  dailyBackdropTimestamp: number;
  frameSpacing: number;
  layout: PinterestWallpaperSettings["layout"];
  mosaicFit: PinterestWallpaperSettings["mosaicFit"];
  paddingBottom: number;
  paddingEnd: number;
  paddingStart: number;
  paddingTop: number;
  pins: PinterestPin[];
  previewError: string | null;
  rotationDegrees: number;
  desktopEnvironment?: DesktopPreviewEnvironment;
  tileSize: number;
}) {
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const imagePins = pins.slice(0, layout === "stack" ? 6 : 12);
  const columns = Math.max(2, Math.min(5, Math.round(7 - tileSize / 18)));
  const gridColumns = imagePins.length
    ? Array.from({ length: columns }, (_, column) =>
        imagePins.filter((_pin, index) => index % columns === column),
      )
    : [];
  const stackPositions = [
    [3, 10],
    [39, 6],
    [17, 34],
    [51, 40],
    [0, 53],
    [33, 61],
  ];
  const cardSize = Math.round(32 + tileSize * 0.48);
  return (
    <section aria-label="Wallpaper preview" className="pinterest-wallpaper-preview">
      <div className="pinterest-wallpaper-preview__heading">
        <span>Live preview</span>
        <small>
          {imagePins.length ? `${imagePins.length} Pins shown` : "Previewing your layout"}
        </small>
      </div>
      <div
        className={`pinterest-wallpaper-preview__canvas pinterest-wallpaper-preview__canvas--${layout} pinterest-wallpaper-preview__canvas--${mosaicFit}`}
        style={
          {
            "--wallpaper-background": previewBackground(
              backgroundMode,
              backgroundColor,
              dailyBackdropTimestamp,
            ),
            "--wallpaper-gap": `${frameSpacing}px`,
            "--wallpaper-padding-bottom": `${paddingBottom}px`,
            "--wallpaper-padding-end": `${paddingEnd}px`,
            "--wallpaper-padding-start": `${paddingStart}px`,
            "--wallpaper-padding-top": `${paddingTop}px`,
            "--wallpaper-radius": `${cornerRadius}px`,
          } as React.CSSProperties
        }
      >
        {previewError ? (
          <PinterestWallpaperPlaceholder error={previewError} layout={layout} />
        ) : !imagePins.length ? (
          <PinterestWallpaperPlaceholder layout={layout} />
        ) : layout === "grid" ? (
          gridColumns.map((columnPins, columnIndex) => {
            const columnRatio = columnPins.reduce(
              (total, pin) => total + (imageRatios[pin.id] ?? 1),
              0,
            );
            return (
              <div
                className="pinterest-wallpaper-preview__column"
                key={columnPins.map((pin) => pin.id).join(":")}
                style={{ flexGrow: 1 / Math.max(columnRatio, 0.1) }}
              >
                {columnPins.map((pin, index) => {
                  const direction = (index + columnIndex) % 2 === 0 ? -1 : 1;
                  return (
                    <img
                      alt=""
                      className="pinterest-wallpaper-preview__tile"
                      key={pin.id}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        if (!image.naturalWidth || !image.naturalHeight) return;
                        const ratio = image.naturalHeight / image.naturalWidth;
                        setImageRatios((current) =>
                          current[pin.id] === ratio ? current : { ...current, [pin.id]: ratio },
                        );
                      }}
                      src={pin.imageUrl}
                      style={
                        {
                          "--wallpaper-rotation": `${direction * rotationDegrees * 0.15}deg`,
                        } as React.CSSProperties
                      }
                    />
                  );
                })}
              </div>
            );
          })
        ) : (
          imagePins.map((pin, index) => {
            const [left, top] = stackPositions[index % stackPositions.length] ?? [0, 0];
            const direction = index % 2 === 0 ? -1 : 1;
            const rotation =
              layout === "stack" ? direction * rotationDegrees : direction * rotationDegrees * 0.15;
            return (
              <img
                alt=""
                className="pinterest-wallpaper-preview__tile"
                key={pin.id}
                src={pin.imageUrl}
                style={
                  {
                    "--wallpaper-left": `${left}%`,
                    "--wallpaper-rotation": `${rotation}deg`,
                    "--wallpaper-size": `${cardSize}%`,
                    "--wallpaper-top": `${top}%`,
                  } as React.CSSProperties
                }
              />
            );
          })
        )}
        {desktopEnvironment ? <DesktopSafeAreaOverlay environment={desktopEnvironment} /> : null}
      </div>
    </section>
  );
}

function DesktopSafeAreaOverlay({ environment }: { environment: DesktopPreviewEnvironment }) {
  const { bottom, end, start, top } = environment.safeArea;
  const style = {
    "--desktop-safe-bottom": `${(bottom / Math.max(1, environment.screen.height)) * 100}%`,
    "--desktop-safe-end": `${(end / Math.max(1, environment.screen.width)) * 100}%`,
    "--desktop-safe-start": `${(start / Math.max(1, environment.screen.width)) * 100}%`,
    "--desktop-safe-top": `${(top / Math.max(1, environment.screen.height)) * 100}%`,
  } as React.CSSProperties;
  return (
    <div
      aria-label={`${environment.platform} desktop safe-area overlay`}
      className={`pinterest-wallpaper-preview__safe-area pinterest-wallpaper-preview__safe-area--${environment.platform}${environment.hasNotch ? " pinterest-wallpaper-preview__safe-area--notch" : ""}`}
      role="img"
      style={style}
    >
      <span className="pinterest-wallpaper-preview__safe-area-top" />
      <span className="pinterest-wallpaper-preview__safe-area-bottom" />
      <span className="pinterest-wallpaper-preview__safe-area-start" />
      <span className="pinterest-wallpaper-preview__safe-area-end" />
    </div>
  );
}

function PinterestWallpaperPlaceholder({
  error,
  layout,
}: {
  error?: string;
  layout: PinterestWallpaperSettings["layout"];
}) {
  const tiles = ["sun", "leaf", "mountain", "stars", "wave", "cloud", "flower", "moon"];
  return (
    <div
      aria-label={
        error
          ? "Pinterest image preview could not load"
          : "Illustrated wallpaper placeholder while Pinterest images load"
      }
      className={`pinterest-wallpaper-placeholder pinterest-wallpaper-placeholder--${layout}`}
      role="img"
    >
      {tiles.map((tile) => (
        <div className="pinterest-wallpaper-placeholder__tile" key={tile}>
          <ImageIcon aria-hidden="true" className="size-5" />
          <span>Image</span>
        </div>
      ))}
      <p aria-live="polite">
        {error ? "Pinterest images could not load." : "Loading Pinterest images…"}
      </p>
    </div>
  );
}

function previewBackground(
  mode: PinterestWallpaperSettings["backgroundMode"],
  customColor: string,
  timestamp: number,
): string {
  if (mode === "custom") return customColor;
  if (mode === "matched") return "#e4ddd8";
  if (mode === "random") return pinterestDailyBackdrop(timestamp);
  return "#ffffff";
}

function pinterestDailyBackdrop(timestamp: number): string {
  const palette = ["#DCE8F2", "#E9DFD0", "#DCE9DC", "#EEE0EA", "#F0E5D3", "#E1E2F1"];
  return palette[Math.floor(timestamp / 86_400_000) % palette.length] ?? "#ffffff";
}

function ConnectorRow({
  account,
  disconnect,
  enableMail,
  reconnect,
  sync,
  syncing,
}: {
  account: CalendarAccount;
  disconnect: () => void;
  enableMail?: () => void;
  reconnect?: () => void;
  sync: () => void;
  syncing: boolean;
}) {
  const health = connectionHealth(account);
  return (
    <ShadcnItem className="connector-row" size="sm">
      <ShadcnItemMedia variant="default">
        <ConnectedAccountIdentity
          avatarUrl={account.avatarUrl}
          label={account.label}
          provider={account.provider}
          size="default"
        />
      </ShadcnItemMedia>
      <ShadcnItemContent>
        <ShadcnItemTitle>{account.label}</ShadcnItemTitle>
        <ShadcnItemDescription>
          {account.email ?? "Connected account"} ·{" "}
          <ConnectionHealthDescription health={health} lastSyncedAt={account.lastSyncedAt} />
        </ShadcnItemDescription>
        <div className="capability-badges">
          <ConnectorCapabilityBadge enabled={account.calendarEnabled} label="Calendar" />
          <ConnectorCapabilityBadge
            enabled={account.mailEnabled}
            label="Mail"
            {...(enableMail
              ? { onEnable: enableMail, onEnableLabel: `Enable Mail for ${account.label}` }
              : {})}
          />
        </div>
      </ShadcnItemContent>
      <ShadcnItemActions>
        <ConnectionHealthBadge health={health} />
        {reconnect ? (
          <ShadcnButton onClick={reconnect} size="sm" type="button" variant="outline">
            Reconnect
          </ShadcnButton>
        ) : null}
        <ShadcnButton
          aria-label={`Sync ${account.label}`}
          disabled={syncing}
          onClick={sync}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RefreshIcon className={syncing ? "spin" : ""} />
        </ShadcnButton>
        <ShadcnButton
          aria-label={`Disconnect ${account.label}`}
          onClick={disconnect}
          size="icon"
          type="button"
          variant="ghost"
        >
          <TrashIcon />
        </ShadcnButton>
      </ShadcnItemActions>
    </ShadcnItem>
  );
}

function ConnectorCapabilityBadge({
  enabled,
  label,
  onEnable,
  onEnableLabel,
}: {
  enabled: boolean;
  label: string;
  onEnable?: () => void;
  onEnableLabel?: string;
}) {
  const badge = (
    <>
      {enabled ? (
        <CheckIcon aria-hidden="true" data-icon="inline-start" />
      ) : (
        <XIcon aria-hidden="true" data-icon="inline-start" />
      )}
      {label}
    </>
  );
  if (!enabled && onEnable && onEnableLabel) {
    return (
      <ShadcnBadge
        asChild
        className="capability-badge capability-badge--disabled"
        variant="secondary"
      >
        <button aria-label={onEnableLabel} onClick={onEnable} type="button">
          {badge}
        </button>
      </ShadcnBadge>
    );
  }
  return (
    <ShadcnBadge
      className={`capability-badge${enabled ? " capability-badge--enabled" : " capability-badge--disabled"}`}
      variant="secondary"
    >
      {badge}
    </ShadcnBadge>
  );
}

function ProfileSettings({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(user.homeLocation);
  const [homeLocationValid, setHomeLocationValid] = useState(true);
  const [planningTimezone, setPlanningTimezone] = useState(user.planningTimezone);
  const update = useMutation({
    mutationFn: (input: {
      displayName: string;
      email: string;
      planningTimezone: string;
      homeLocation: HomeLocation | null;
      workdayEndMinute: number;
      workdayStartMinute: number;
    }) => api.updateUser(input),
    onSuccess: (nextUser) => {
      queryClient.setQueryData(["me"], nextUser);
      toast.success("Profile saved.");
    },
  });
  const resendVerification = useMutation({
    mutationFn: api.resendEmailVerification,
    onSuccess: () => toast.success("Confirmation email sent."),
  });
  const passwordReset = useMutation({
    mutationFn: () => api.requestPasswordReset({ email: user.email }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => toast.success(`Password reset link sent to ${user.email}.`),
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/");
    },
  });
  const timeZones = Array.from(
    new Set([
      planningTimezone,
      user.planningTimezone,
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "UTC",
    ]),
  );
  const [firstName, lastName] = splitProfileName(user.displayName);
  return (
    <SettingsSection
      description="Your identity and local time are used to personalize the workspace and schedule material correctly."
      title="Account"
    >
      <div className="flex flex-col gap-6">
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            update.mutate({
              displayName: [form.get("firstName"), form.get("lastName")]
                .map((value) => String(value).trim())
                .filter(Boolean)
                .join(" "),
              email: String(form.get("email")),
              planningTimezone,
              homeLocation,
              workdayEndMinute: timeToMinute(String(form.get("workdayEnd"))),
              workdayStartMinute: timeToMinute(String(form.get("workdayStart"))),
            });
          }}
        >
          {!user.emailVerified ? (
            <ShadcnAlert role="status" variant="warning">
              <MailIcon />
              <ShadcnAlertTitle>Email confirmation needed</ShadcnAlertTitle>
              <ShadcnAlertDescription>
                Confirm this address to keep account recovery available and unlock connected
                accounts.
              </ShadcnAlertDescription>
              <ShadcnAlertAction>
                <ShadcnButton
                  disabled={resendVerification.isPending}
                  onClick={() => resendVerification.mutate()}
                  type="button"
                  variant="outline"
                >
                  {resendVerification.isPending ? "Sending…" : "Resend confirmation"}
                </ShadcnButton>
              </ShadcnAlertAction>
            </ShadcnAlert>
          ) : null}
          <ShadcnFieldGroup className="form-grid">
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="profile-first-name">First name</ShadcnFieldLabel>
              <ShadcnInput
                autoComplete="given-name"
                defaultValue={firstName}
                id="profile-first-name"
                name="firstName"
                required
              />
            </ShadcnField>
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="profile-last-name">Last name</ShadcnFieldLabel>
              <ShadcnInput
                autoComplete="family-name"
                defaultValue={lastName}
                id="profile-last-name"
                name="lastName"
              />
            </ShadcnField>
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="profile-email">Email</ShadcnFieldLabel>
              <ShadcnInput
                autoComplete="email"
                defaultValue={user.email}
                id="profile-email"
                name="email"
                required
                type="email"
              />
            </ShadcnField>
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="profile-workday-start">
                Planning day starts
              </ShadcnFieldLabel>
              <ShadcnInput
                defaultValue={minuteToTime(user.workdayStartMinute)}
                id="profile-workday-start"
                name="workdayStart"
                required
                type="time"
              />
            </ShadcnField>
            <ShadcnField>
              <ShadcnFieldLabel htmlFor="profile-workday-end">Planning day ends</ShadcnFieldLabel>
              <ShadcnInput
                defaultValue={minuteToTime(user.workdayEndMinute)}
                id="profile-workday-end"
                name="workdayEnd"
                required
                type="time"
              />
            </ShadcnField>
            <HomeLocationField
              key={user.updatedAt}
              savedLocation={user.homeLocation}
              onChange={(location) => {
                setHomeLocation(location);
                if (location?.timezone) setPlanningTimezone(location.timezone);
              }}
              onValidityChange={setHomeLocationValid}
            />
            <ShadcnField className="profile-form__full-row">
              <ShadcnFieldLabel htmlFor="profile-timezone">Planning time zone</ShadcnFieldLabel>
              <ShadcnNativeSelect
                id="profile-timezone"
                name="planningTimezone"
                onChange={(event) => setPlanningTimezone(event.target.value)}
                value={planningTimezone}
              >
                {timeZones.map((timeZone) => (
                  <NativeSelectOption key={timeZone} value={timeZone}>
                    {timeZone.replace("_", " ")}
                  </NativeSelectOption>
                ))}
              </ShadcnNativeSelect>
              <ShadcnFieldDescription>
                Home Location supplies this default. Choose a different zone when your planning day
                should stay anchored elsewhere.
              </ShadcnFieldDescription>
            </ShadcnField>
          </ShadcnFieldGroup>
          {update.isError ? <SettingsError error={update.error} /> : null}
          {resendVerification.isError ? <SettingsError error={resendVerification.error} /> : null}
          <ShadcnButton disabled={update.isPending || !homeLocationValid} type="submit">
            {update.isPending ? "Saving profile…" : "Save profile"}
          </ShadcnButton>
        </form>
        <ShadcnItemGroup aria-label="Account actions">
          <ShadcnItem size="sm">
            <ShadcnItemMedia variant="icon">
              <KeyIcon aria-hidden="true" />
            </ShadcnItemMedia>
            <ShadcnItemContent>
              <ShadcnItemTitle>Change password</ShadcnItemTitle>
              <ShadcnItemDescription>
                We’ll email you a secure link to choose a new password.
              </ShadcnItemDescription>
            </ShadcnItemContent>
            <ShadcnItemActions>
              <ShadcnButton
                disabled={passwordReset.isPending}
                onClick={() => passwordReset.mutate()}
                size="sm"
                type="button"
                variant="secondary"
              >
                {passwordReset.isPending ? "Sending…" : "Send link"}
              </ShadcnButton>
            </ShadcnItemActions>
          </ShadcnItem>
          <ShadcnItem size="sm">
            <ShadcnItemMedia variant="icon">
              <LogOutIcon aria-hidden="true" />
            </ShadcnItemMedia>
            <ShadcnItemContent>
              <ShadcnItemTitle>Log out</ShadcnItemTitle>
              <ShadcnItemDescription>End this session on this device.</ShadcnItemDescription>
            </ShadcnItemContent>
            <ShadcnItemActions>
              <ShadcnButton
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
                size="sm"
                type="button"
                variant="destructive"
              >
                {logout.isPending ? "Logging out…" : "Log out"}
              </ShadcnButton>
            </ShadcnItemActions>
          </ShadcnItem>
        </ShadcnItemGroup>
      </div>
    </SettingsSection>
  );
}

function splitProfileName(displayName: string): [firstName: string, lastName: string] {
  const [firstName = "", ...lastName] = displayName.trim().split(/\s+/);
  return [firstName, lastName.join(" ")];
}

function HomeLocationField({
  onChange,
  onValidityChange,
  savedLocation,
}: {
  onChange: (location: WeatherLocationOption | null) => void;
  onValidityChange: (valid: boolean) => void;
  savedLocation: HomeLocation | null;
}) {
  const [selectedLocation, setSelectedLocation] = useState<WeatherLocationOption | null>(
    savedLocation?.coordinates
      ? { ...savedLocation, coordinates: savedLocation.coordinates }
      : null,
  );
  const [searchValue, setSearchValue] = useState(savedLocation?.label ?? "");
  const [open, setOpen] = useState(false);
  const deferredSearch = useDeferredValue(selectedLocation === null ? searchValue.trim() : "");
  const locations = useQuery({
    enabled: deferredSearch.length >= 2,
    queryFn: () => api.searchWeatherLocations(deferredSearch),
    queryKey: ["weather-location-search", deferredSearch],
    retry: false,
    staleTime: 5 * 60_000,
  });
  const items = useMemo(() => {
    const results = locations.data ?? [];
    if (
      selectedLocation === null ||
      results.some((item) => item.label === selectedLocation.label)
    ) {
      return results;
    }
    return [selectedLocation, ...results];
  }, [locations.data, selectedLocation]);
  const query = searchValue.trim();
  const fieldInvalid =
    query.length > 0 && selectedLocation === null && savedLocation?.label !== query;
  return (
    <ShadcnField data-invalid={fieldInvalid || undefined}>
      <ShadcnFieldLabel htmlFor="profile-home-location">Home Location</ShadcnFieldLabel>
      <Combobox
        autoHighlight
        filter={null}
        inputValue={searchValue}
        itemToStringLabel={(location: WeatherLocationOption) => location.label}
        items={items}
        onInputValueChange={(nextValue, { reason }) => {
          if (reason === "item-press") return;
          setSearchValue(nextValue);
          setOpen(nextValue.trim().length > 0);
          if (nextValue.trim().length === 0) {
            setSelectedLocation(null);
            onChange(null);
            onValidityChange(true);
            return;
          }
          if (savedLocation?.label === nextValue.trim()) {
            if (savedLocation.coordinates) {
              const restoredLocation = {
                ...savedLocation,
                coordinates: savedLocation.coordinates,
              };
              setSelectedLocation(restoredLocation);
              onChange(restoredLocation);
            }
            onValidityChange(true);
            return;
          }
          setSelectedLocation(null);
          onChange(null);
          onValidityChange(false);
        }}
        onOpenChange={setOpen}
        onValueChange={(nextValue, { reason }) => {
          setSelectedLocation(nextValue);
          if (reason === "item-press") {
            setSearchValue(nextValue?.label ?? "");
            setOpen(false);
          }
          if (nextValue === null && (reason === "clear-press" || reason === "input-clear")) {
            setSearchValue("");
            setOpen(false);
          }
          onChange(nextValue);
          onValidityChange(
            nextValue !== null || reason === "clear-press" || reason === "input-clear",
          );
        }}
        open={open}
        value={selectedLocation}
      >
        <ComboboxInput
          aria-describedby="profile-home-location-description"
          aria-invalid={fieldInvalid || undefined}
          autoComplete="off"
          id="profile-home-location"
          placeholder="Search by city, ZIP, or region"
          showClear
        />
        <ComboboxContent aria-busy={locations.isFetching || undefined}>
          {query.length < 2 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Type at least two characters.</p>
          ) : null}
          {locations.isFetching ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Searching places…</p>
          ) : null}
          {locations.isError ? (
            <p className="px-2 py-2 text-sm text-destructive" role="alert">
              {errorMessage(locations.error)}
            </p>
          ) : null}
          <ComboboxEmpty>
            {query.length >= 2 && !locations.isFetching && !locations.isError
              ? "No matching places."
              : null}
          </ComboboxEmpty>
          <ComboboxList>
            {(location: WeatherLocationOption) => (
              <ComboboxItem key={location.label} value={location}>
                {location.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <ShadcnFieldDescription id="profile-home-location-description">
        Used when this device cannot share its location.
      </ShadcnFieldDescription>
    </ShadcnField>
  );
}

function InvitationsSettings() {
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryFn: api.listInvitations, queryKey: ["invitations"] });
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (form: FormData) =>
      api.createInvitation({
        ...(String(form.get("email")).trim() ? { email: String(form.get("email")).trim() } : {}),
        expiresInDays: Number(form.get("expiresInDays")),
      }),
    onSuccess: (invitation) => {
      setLatestCode(invitation.code);
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
  const copyLatestCode = async () => {
    if (!latestCode || !navigator.clipboard) return;
    await navigator.clipboard.writeText(latestCode);
  };
  return (
    <SettingsSection
      description="Issue single-use invitation codes for the private beta. The code is shown only once, so copy it before you leave this page."
      title="Invitations"
    >
      {invitations.isError ? (
        <SettingsError error={invitations.error} />
      ) : (
        <>
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(new FormData(event.currentTarget));
            }}
          >
            <ShadcnFieldGroup className="form-grid">
              <EmailField id="invite-email" label="Friend’s email (optional)" name="email" />
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="invite-expiry">Expires after</ShadcnFieldLabel>
                <ShadcnNativeSelect defaultValue="14" id="invite-expiry" name="expiresInDays">
                  <NativeSelectOption value="7">7 days</NativeSelectOption>
                  <NativeSelectOption value="14">14 days</NativeSelectOption>
                  <NativeSelectOption value="30">30 days</NativeSelectOption>
                </ShadcnNativeSelect>
              </ShadcnField>
            </ShadcnFieldGroup>
            {create.isError ? <SettingsError error={create.error} /> : null}
            <ShadcnButton disabled={create.isPending} type="submit">
              {create.isPending ? "Creating invitation…" : "Create invitation"}
            </ShadcnButton>
          </form>
          {latestCode ? (
            <ShadcnAlert>
              <CircleCheckIcon />
              <ShadcnAlertTitle>Invitation ready</ShadcnAlertTitle>
              <ShadcnAlertDescription>
                Share this code privately: <code>{latestCode}</code>
              </ShadcnAlertDescription>
              <ShadcnAlertAction>
                <ShadcnButton onClick={() => void copyLatestCode()} type="button" variant="outline">
                  Copy code
                </ShadcnButton>
              </ShadcnAlertAction>
            </ShadcnAlert>
          ) : null}
          {invitations.isLoading ? <Spinner label="Loading invitations" /> : null}
          {invitations.data?.length ? (
            <div className="settings-list">
              {invitations.data.map((invitation) => (
                <InvitationRow invitation={invitation} key={invitation.id} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
  return (
    <ShadcnItem>
      <ShadcnItemContent>
        <ShadcnItemTitle>{invitation.email ?? "Unassigned invitation"}</ShadcnItemTitle>
        <ShadcnItemDescription>
          {invitation.redeemedAt
            ? `Redeemed ${formatRelative(invitation.redeemedAt)}`
            : expired
              ? "Expired"
              : `Expires ${formatRelative(invitation.expiresAt)}`}
        </ShadcnItemDescription>
      </ShadcnItemContent>
    </ShadcnItem>
  );
}

function SessionsSettings() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryFn: api.listSessions, queryKey: ["sessions"] });
  const revoke = useMutation({
    mutationFn: api.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  return (
    <SettingsSection
      description="Devices with an active sign-in to your nohmi account. Revoke access you no longer recognize."
      title="Sessions"
    >
      <ShadcnItemGroup>
        {sessions.data?.map((session) => (
          <SessionRow key={session.id} revoke={() => revoke.mutate(session.id)} session={session} />
        ))}
      </ShadcnItemGroup>
    </SettingsSection>
  );
}

const appearanceThemes: Array<{
  icon: Icon;
  label: string;
  value: Theme;
}> = [
  {
    icon: MonitorIcon,
    label: "System",
    value: "system",
  },
  {
    icon: SunIcon,
    label: "Light",
    value: "light",
  },
  {
    icon: MoonIcon,
    label: "Dark",
    value: "dark",
  },
];

function ThemeSettings({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const updateTheme = useMutation({
    mutationFn: (input: { theme: Theme }) => api.updateUser(input),
    onSuccess: (nextUser) => queryClient.setQueryData(["me"], nextUser),
  });
  return (
    <SettingsSection title="Appearance">
      <ShadcnFieldSet className="settings-choice-group">
        <ShadcnFieldLegend variant="label">Color mode</ShadcnFieldLegend>
        <ChoiceCardGroup
          aria-label="Color mode"
          className="appearance-picker"
          disabled={updateTheme.isPending}
          onValueChange={(theme) => updateTheme.mutate({ theme: theme as Theme })}
          options={appearanceThemes.map(({ icon: Icon, label, value }) => ({
            icon: <Icon className="size-[18px]" />,
            label,
            preview: <AppearancePreview mode={value} />,
            value,
          }))}
          value={user.theme}
        />
      </ShadcnFieldSet>
      {updateTheme.isError ? <SettingsError error={updateTheme.error} /> : null}
    </SettingsSection>
  );
}

function AppearancePreview({ mode }: { mode: Theme }) {
  const panes = mode === "system" ? ["light", "dark"] : [mode];
  return (
    <span aria-hidden="true" className="appearance-preview" data-mode={mode}>
      {panes.map((tone) => (
        <span className={`appearance-preview__pane appearance-preview__pane--${tone}`} key={tone}>
          <span className="appearance-preview__rail" />
          <span className="appearance-preview__content">
            <span />
            <span />
          </span>
        </span>
      ))}
    </span>
  );
}

function useDocumentTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media?.matches ? "dark" : "light") : theme;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
    };
    apply();
    if (
      theme !== "system" ||
      !media ||
      typeof media.addEventListener !== "function" ||
      typeof media.removeEventListener !== "function"
    ) {
      return;
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function SessionRow({ revoke, session }: { revoke: () => void; session: Session }) {
  return (
    <ShadcnItem variant="outline">
      <ShadcnItemMedia className="provider-icon" variant="icon">
        <UserIcon className="size-4" />
      </ShadcnItemMedia>
      <ShadcnItemContent>
        <ShadcnItemTitle>
          {session.userAgent?.split(" ").slice(0, 3).join(" ") ?? "Unknown device"}
        </ShadcnItemTitle>
        <ShadcnItemDescription>
          {session.ipAddress ?? "Local"} · Active {formatRelative(session.lastSeenAt)}
        </ShadcnItemDescription>
      </ShadcnItemContent>
      <ShadcnItemActions>
        <ShadcnButton
          aria-label="Revoke session"
          onClick={revoke}
          size="icon"
          type="button"
          variant="ghost"
        >
          <TrashIcon />
        </ShadcnButton>
      </ShadcnItemActions>
    </ShadcnItem>
  );
}

function SettingsSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <ShadcnCard className="settings-section">
      <ShadcnCardHeader>
        <ShadcnCardTitle>
          <h2>{title}</h2>
        </ShadcnCardTitle>
        {description ? <ShadcnCardDescription>{description}</ShadcnCardDescription> : null}
        {action ? <ShadcnCardAction>{action}</ShadcnCardAction> : null}
      </ShadcnCardHeader>
      <ShadcnCardContent className="settings-section__body">{children}</ShadcnCardContent>
    </ShadcnCard>
  );
}

function SettingsError({ error }: { error: unknown }) {
  return (
    <ShadcnAlert variant="destructive">
      <XIcon />
      <ShadcnAlertTitle>Something needs attention</ShadcnAlertTitle>
      <ShadcnAlertDescription>{errorMessage(error)}</ShadcnAlertDescription>
    </ShadcnAlert>
  );
}

function ReminderGroup({
  label,
  reminders,
  setEditor,
  timeZone,
}: {
  label: string;
  reminders: Reminder[];
  setEditor: (editor: Editor) => void;
  timeZone: string;
}) {
  return (
    <section className="reminder-group">
      <h3>
        {label}
        <span>{reminders.length}</span>
      </h3>
      <ShadcnItemGroup>
        {reminders.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            onEdit={() => setEditor({ kind: "reminder", reminder })}
            reminder={reminder}
            timeZone={timeZone}
          />
        ))}
      </ShadcnItemGroup>
    </section>
  );
}

function TaskGroup({
  label,
  overdue = false,
  recommendations,
  setEditor,
  tasks,
  timeZone,
}: {
  label: string;
  overdue?: boolean;
  recommendations?: Map<string, DailyBrief["recommendedTasks"][number]>;
  setEditor: (editor: Editor) => void;
  tasks: Task[];
  timeZone: string;
}) {
  return (
    <section className={cn("reminder-group", overdue && "reminder-group--overdue")}>
      <h3>
        {label}
        <span>{tasks.length}</span>
      </h3>
      <ShadcnItemGroup>
        {tasks.map((task) => {
          const recommendation = recommendations?.get(task.id);
          return (
            <TaskRow
              key={task.id}
              onEdit={() => setEditor({ kind: "task", task })}
              {...(recommendation ? { recommendation } : {})}
              task={task}
              timeZone={timeZone}
            />
          );
        })}
      </ShadcnItemGroup>
    </section>
  );
}

function TodayEventCard({
  calendarColor,
  currentTime,
  density,
  event,
  layoutStyle,
  timeZone,
}: {
  calendarColor: string | null | undefined;
  currentTime?: Date;
  density: TodayTimelineDensity;
  event: CalendarEvent;
  layoutStyle?: CSSProperties;
  timeZone: string;
}) {
  const navigate = useNavigate();
  const eventLabel = `${event.allDay ? "All day" : formatTime(event.startsAt, timeZone)} ${event.title}`;
  const minutesUntilStart =
    currentTime !== undefined && new Date(event.startsAt).getTime() > currentTime.getTime()
      ? Math.max(
          1,
          Math.ceil((new Date(event.startsAt).getTime() - currentTime.getTime()) / 60_000),
        )
      : null;
  const minutesRemaining =
    currentTime !== undefined &&
    new Date(event.startsAt).getTime() <= currentTime.getTime() &&
    new Date(event.endsAt).getTime() > currentTime.getTime()
      ? Math.max(1, Math.ceil((new Date(event.endsAt).getTime() - currentTime.getTime()) / 60_000))
      : null;
  const directionsUrl = event.location
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location)}`
    : null;
  const hasQuickActions = Boolean(directionsUrl || event.conferenceUrl || event.url);
  const viewInCalendar = () => {
    const params = new URLSearchParams({
      date: localDateToIso(localDateAt(new Date(event.startsAt), timeZone)),
      event: event.id,
      view: "week",
    });
    navigate(`/calendar?${params.toString()}`);
  };
  return (
    <DropdownMenu>
      <EventCard
        className="today-timeline__event"
        data-density={density}
        role="listitem"
        style={{ ...calendarEventColorStyle(calendarColor), ...layoutStyle }}
        tone="calendar"
      >
        <EventCardContent>
          <DropdownMenuTrigger asChild>
            <EventCardPrimaryAction aria-label={`${eventLabel}. Open quick actions`}>
              <EventCardBody>
                <EventCardTitle>
                  <span className="min-w-0 truncate">{event.title}</span>
                  {minutesUntilStart !== null || minutesRemaining !== null ? (
                    <EventCardTitleMeta>
                      {minutesUntilStart !== null
                        ? `in ${formatMinutes(minutesUntilStart)}`
                        : `${formatMinutes(minutesRemaining ?? 0)} left`}
                    </EventCardTitleMeta>
                  ) : null}
                  {event.blocks.length > 0 ? (
                    <LockIcon aria-label="Blocks another calendar" />
                  ) : null}
                </EventCardTitle>
                <EventCardDescription>
                  {formatTimelineTimeRange(event, timeZone)}
                </EventCardDescription>
                {event.location ? (
                  <EventCardDescription>{event.location}</EventCardDescription>
                ) : null}
              </EventCardBody>
            </EventCardPrimaryAction>
          </DropdownMenuTrigger>
        </EventCardContent>
      </EventCard>
      <DropdownMenuContent className="today-event-menu" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={viewInCalendar}>
            <CalendarIcon aria-hidden="true" /> View Event in Calendar
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {hasQuickActions ? <DropdownMenuSeparator /> : null}
        {hasQuickActions ? (
          <DropdownMenuGroup>
            {directionsUrl ? (
              <DropdownMenuItem asChild>
                <a href={directionsUrl} rel="noreferrer" target="_blank">
                  <MapPinIcon aria-hidden="true" /> Get Directions
                </a>
              </DropdownMenuItem>
            ) : null}
            {event.conferenceUrl ? (
              <DropdownMenuItem asChild>
                <a href={event.conferenceUrl} rel="noreferrer" target="_blank">
                  <ExternalLinkIcon aria-hidden="true" /> Join Meeting
                </a>
              </DropdownMenuItem>
            ) : null}
            {event.url && event.url !== event.conferenceUrl ? (
              <DropdownMenuItem asChild>
                <a href={event.url} rel="noreferrer" target="_blank">
                  <ExternalLinkIcon aria-hidden="true" /> View Link
                </a>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type TodayTimelineItem = TimelinePositionable & {
  material: { event: CalendarEvent; kind: "event" } | { kind: "task"; task: Task };
};

function scheduledTaskEndsAt(task: Task): Date {
  return new Date(
    new Date(task.scheduledAt as string).getTime() +
      Math.max(15, task.estimateMinutes ?? 30) * 60_000,
  );
}

function TodayTaskTimelineCard({
  currentTime,
  density,
  item,
  layoutStyle,
  onEdit,
  timeZone,
}: {
  currentTime: Date;
  density: TodayTimelineDensity;
  item: TodayTimelineItem;
  layoutStyle: CSSProperties;
  onEdit: () => void;
  timeZone: string;
}) {
  if (item.material.kind !== "task") return null;
  const { task } = item.material;
  const minutesUntilStart =
    new Date(item.startsAt).getTime() > currentTime.getTime()
      ? Math.max(1, Math.ceil((new Date(item.startsAt).getTime() - currentTime.getTime()) / 60_000))
      : null;
  const minutesRemaining =
    new Date(item.startsAt).getTime() <= currentTime.getTime() &&
    new Date(item.endsAt).getTime() > currentTime.getTime()
      ? Math.max(1, Math.ceil((new Date(item.endsAt).getTime() - currentTime.getTime()) / 60_000))
      : null;

  return (
    <EventCard
      className="today-timeline__event today-timeline__task"
      data-density={density}
      role="listitem"
      style={layoutStyle}
    >
      <EventCardContent>
        <EventCardPrimaryAction aria-label={`Open task ${task.title}`} onClick={onEdit}>
          <EventCardBody>
            <EventCardTitle>
              <ListChecksIcon aria-hidden="true" />
              <span className="min-w-0 truncate">{task.title}</span>
              {minutesUntilStart !== null || minutesRemaining !== null ? (
                <EventCardTitleMeta>
                  {minutesUntilStart !== null
                    ? `in ${formatMinutes(minutesUntilStart)}`
                    : `${formatMinutes(minutesRemaining ?? 0)} left`}
                </EventCardTitleMeta>
              ) : null}
            </EventCardTitle>
            <EventCardDescription>
              {formatTime(item.startsAt, timeZone)}–{formatTime(item.endsAt, timeZone)}
            </EventCardDescription>
          </EventCardBody>
        </EventCardPrimaryAction>
      </EventCardContent>
    </EventCard>
  );
}

const todayTimelinePixelsPerMinute = 1.5;
type TodayTimelineDensity = "compact" | "full" | "short";

export function todayTimelineStartMinute(currentMinute: number): number {
  return Math.floor(currentMinute / 15) * 15;
}

export function todayTimelineItemRange(startMinute: number, endMinute: number) {
  const start = Math.floor(startMinute / 15) * 15;
  const end = Math.max(start + 15, Math.ceil(endMinute / 15) * 15);
  return { end, start };
}

export function todayTimelineDensity(durationMinutes: number): TodayTimelineDensity {
  if (durationMinutes <= 15) return "compact";
  if (durationMinutes <= 30) return "short";
  return "full";
}

function TodayTimeline({
  calendarColorsById,
  currentTime,
  items,
  onEditTask,
  timeZone,
}: {
  calendarColorsById: Map<string, string | null>;
  currentTime: Date;
  items: TodayTimelineItem[];
  onEditTask: (task: Task) => void;
  timeZone: string;
}) {
  const day = localDateAt(currentTime, timeZone);
  const currentMinute = localDateTimeAt(currentTime, timeZone).minute;
  const startMinute = todayTimelineStartMinute(currentMinute);
  const layouts = positionTimelineEvents(items, day, timeZone);
  const endMinute = Math.max(
    startMinute,
    ...layouts.map((layout) => todayTimelineItemRange(layout.startMinute, layout.endMinute).end),
  );
  const height = Math.max(
    15 * todayTimelinePixelsPerMinute,
    (endMinute - startMinute) * todayTimelinePixelsPerMinute,
  );
  const firstHourMinute = Math.ceil(startMinute / 60) * 60;
  const hourTicks =
    firstHourMinute > endMinute
      ? []
      : Array.from(
          { length: Math.floor((endMinute - firstHourMinute) / 60) + 1 },
          (_, index) => firstHourMinute + index * 60,
        );
  const minorTicks = Array.from(
    { length: Math.floor((endMinute - startMinute) / 15) + 1 },
    (_, index) => startMinute + index * 15,
  ).filter((minute) => minute % 60 !== 0);
  const gridTicks = Array.from(
    { length: Math.floor((endMinute - startMinute) / 15) + 1 },
    (_, index) => startMinute + index * 15,
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: The timeline interleaves its decorative time axis with event list items.
    <div className="today-timeline" role="list" style={{ height }}>
      <div aria-hidden="true" className="today-timeline__axis">
        <span className="today-timeline__line" />
        {hourTicks.map((minute) => (
          <span
            className="today-timeline__tick"
            key={minute}
            style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
          >
            <span>{formatHour(Math.floor(minute / 60) % 24)}</span>
            <i />
          </span>
        ))}
        {minorTicks.map((minute) => (
          <i
            className="today-timeline__minor-tick"
            data-half-hour={minute % 60 === 30 ? "true" : "false"}
            data-slot="today-timeline-minor-tick"
            key={minute}
            style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
          />
        ))}
        {endMinute % 15 === 0 ? null : <i className="today-timeline__end-cap" />}
      </div>
      <div
        aria-label={`Current time ${formatTime(currentTime.toISOString(), timeZone)}`}
        className="calendar-now-line today-timeline__now"
        role="timer"
        style={{ top: (currentMinute - startMinute) * todayTimelinePixelsPerMinute }}
      >
        <span>{formatTime(currentTime.toISOString(), timeZone)}</span>
        <i />
      </div>
      <div className="today-timeline__track">
        <div aria-hidden="true" className="today-timeline__grid">
          {gridTicks.map((minute) => (
            <i
              data-half-hour={minute % 60 === 30 ? "true" : "false"}
              data-major={minute % 60 === 0 ? "true" : "false"}
              data-slot="today-timeline-grid-line"
              key={minute}
              style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
            />
          ))}
        </div>
        {layouts.map((layout) => {
          const snappedRange = todayTimelineItemRange(layout.startMinute, layout.endMinute);
          const visibleStartMinute = Math.max(startMinute, snappedRange.start);
          const visibleEndMinute = Math.max(visibleStartMinute + 15, snappedRange.end);
          const visibleDurationMinutes = visibleEndMinute - visibleStartMinute;
          const columnGap = 8;
          const layoutStyle = {
            height: visibleDurationMinutes * todayTimelinePixelsPerMinute,
            left: `calc(${(layout.column / layout.columns) * 100}% + ${layout.column === 0 ? 0 : columnGap / 2}px)`,
            top: (visibleStartMinute - startMinute) * todayTimelinePixelsPerMinute,
            width: `calc(${100 / layout.columns}% - ${layout.columns === 1 ? 0 : columnGap / 2}px)`,
          } satisfies CSSProperties;
          const { material } = layout.event;
          if (material.kind === "event") {
            return (
              <TodayEventCard
                calendarColor={calendarColorsById.get(material.event.calendarId)}
                currentTime={currentTime}
                density={todayTimelineDensity(visibleDurationMinutes)}
                event={material.event}
                key={layout.event.id}
                layoutStyle={layoutStyle}
                timeZone={timeZone}
              />
            );
          }
          return (
            <TodayTaskTimelineCard
              currentTime={currentTime}
              density={todayTimelineDensity(visibleDurationMinutes)}
              item={layout.event}
              key={layout.event.id}
              layoutStyle={layoutStyle}
              onEdit={() => onEditTask(material.task)}
              timeZone={timeZone}
            />
          );
        })}
      </div>
    </div>
  );
}

function TodayAllDayEventCard({
  calendarColor,
  event,
  onEdit,
  timeZone,
}: {
  calendarColor: string | null | undefined;
  event: CalendarEvent;
  onEdit: () => void;
  timeZone: string;
}) {
  const start = localDateAt(new Date(event.startsAt), timeZone);
  const inclusiveEnd = localDateAt(new Date(new Date(event.endsAt).getTime() - 1), timeZone);
  const startLabel = formatLocalDate(start, { day: "numeric", month: "short" });
  const endLabel = formatLocalDate(inclusiveEnd, { day: "numeric", month: "short" });
  return (
    <OccasionCard
      accentColor={calendarColor ?? "#777ce3"}
      aside={
        event.provider.toLowerCase() !== "local" ? (
          <ConnectedServiceMark provider={event.provider} />
        ) : undefined
      }
      endDateTime={localDateToIso(inclusiveEnd)}
      endLabel={endLabel}
      onOpen={onEdit}
      startDateTime={localDateToIso(start)}
      startLabel={startLabel}
      title={event.title}
    />
  );
}

function ReminderDialog({
  close,
  reminder,
  user,
}: {
  close: () => void;
  reminder: Reminder | undefined;
  user: User;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: {
      dueAt: string | null;
      notes: string | null;
      priority: "low" | "medium" | "high";
      timezone: string | null;
      title: string;
    }) => (reminder ? api.updateReminder(reminder.id, input) : api.createReminder(input)),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = String(form.get("dueAt"));
    mutation.mutate({
      dueAt: due ? dateTimeLocalToIso(due, user.planningTimezone) : null,
      notes: nullable(form.get("notes")),
      priority: String(form.get("priority")) as "low" | "medium" | "high",
      timezone: due ? user.planningTimezone : null,
      title: String(form.get("title")),
    });
  };
  return (
    <Modal
      close={close}
      eyebrow="Reminder"
      title={reminder ? "Refine reminder" : "Hold onto something"}
    >
      <form className="editor-form" onSubmit={submit}>
        <Field
          autoFocus
          defaultValue={reminder?.title}
          label="What needs attention?"
          name="title"
          required
        />
        <div className="form-grid">
          <Field
            defaultValue={toDateTimeLocal(reminder?.dueAt, user.planningTimezone)}
            label="Deadline"
            name="dueAt"
            type="datetime-local"
          />
          <label className="field">
            <span>Priority</span>
            <select defaultValue={reminder?.priority ?? "medium"} name="priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea defaultValue={reminder?.notes ?? ""} name="notes" rows={4} />
        </label>
        <FormActions
          close={close}
          error={mutation.error}
          pending={mutation.isPending}
          submitLabel={reminder ? "Save changes" : "Create reminder"}
        />
      </form>
    </Modal>
  );
}

function EventInspector({
  calendars,
  close,
  edit,
  event,
  presentation = "sheet",
  user,
}: {
  calendars: Calendar[];
  close: () => void;
  edit: () => void;
  event: CalendarEvent;
  presentation?: "floating" | "sheet";
  user: User;
}) {
  const queryClient = useQueryClient();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blocks, setBlocks] = useState(event.blocks);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const calendar = calendars.find((record) => record.id === event.calendarId);
  const blockedCalendars = blocks.flatMap((block) => {
    const blockedCalendar = calendars.find((record) => record.id === block.calendarId);
    return blockedCalendar ? [{ block, calendar: blockedCalendar }] : [];
  });
  const calendarsWithDetails = blockedCalendars
    .filter(({ block }) => block.mode === "details")
    .map(({ calendar: blockedCalendar }) => blockedCalendar);
  const calendarsWithBusyOnly = blockedCalendars
    .filter(({ block }) => block.mode === "busy")
    .map(({ calendar: blockedCalendar }) => blockedCalendar);
  const eventStartsAt = new Date(event.startsAt).getTime();
  const eventEndsAt = new Date(event.endsAt).getTime();
  const eventIsInProgress =
    currentTime.getTime() >= eventStartsAt && currentTime.getTime() < eventEndsAt;
  const remainingMinutes = Math.max(1, Math.ceil((eventEndsAt - currentTime.getTime()) / 60_000));
  const blockDestinations = calendars.filter(
    (record) => record.id !== event.calendarId && record.isWritable,
  );
  const remove = useMutation({
    mutationFn: () => api.deleteEvent(event.id),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const changeBlock = useMutation({
    mutationFn: async (
      input:
        | {
            calendarId: string;
            mode: "busy" | "details";
            operation: "create";
          }
        | {
            blockId: string;
            calendarId: string;
            mode: "busy" | "details";
            operation: "delete" | "update";
          },
    ) => {
      if (input.operation === "create") {
        return api.createEventBlock(event.id, {
          calendarId: input.calendarId,
          mode: input.mode,
        });
      }
      return input.operation === "delete"
        ? api.deleteEventBlock(event.id, input.blockId)
        : api.updateEventBlock(event.id, input.blockId, { mode: input.mode });
    },
    onSuccess: async (updated) => {
      setBlocks(updated.blocks);
      await invalidateMaterial(queryClient);
    },
  });
  useEffect(() => {
    const handleEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") close();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [close]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useDialogFocus(sheetRef);
  const content = (
    <>
      <header className="event-sheet__header">
        <div className="event-sheet__calendar">
          <i aria-hidden="true" style={{ background: calendar?.color ?? "#777ce3" }} />
          <span>{calendar?.name ?? "Calendar"}</span>
          <Badge>{event.provider}</Badge>
        </div>
        <Button aria-label="Close event details" onClick={close} tone="ghost">
          <XIcon aria-hidden="true" className="size-[19px]" />
        </Button>
      </header>
      <div className="event-sheet__body">
        <div className="event-sheet__title">
          <h2 id="event-sheet-title">{event.title}</h2>
          {presentation === "floating" ? (
            <div className="event-details-card__schedule">
              <span>
                {event.allDay ||
                !sameLocalDate(
                  localDateAt(new Date(event.startsAt), user.planningTimezone),
                  localDateAt(new Date(event.endsAt), user.planningTimezone),
                )
                  ? formatEventRange(event, user.planningTimezone)
                  : formatTimelineTimeRange(event, user.planningTimezone)}
              </span>
              {eventIsInProgress ? (
                <ShadcnBadge aria-live="polite" role="status" variant="secondary">
                  <PulseIcon aria-hidden="true" data-icon="inline-start" />
                  In progress · {formatMinutes(remainingMinutes)} left
                </ShadcnBadge>
              ) : null}
            </div>
          ) : null}
        </div>
        <section className="event-details-card__sharing" aria-labelledby="event-sharing-title">
          <h3 id="event-sharing-title">Shared With</h3>
          <dl>
            <div>
              <dt>
                <EyeIcon aria-hidden="true" className="size-[15px]" /> Details Included
              </dt>
              <dd>
                <EventVisibilityList
                  blocks={blocks}
                  calendars={calendarsWithDetails}
                  destinations={blockDestinations}
                  disabled={changeBlock.isPending}
                  label="Calendars with details included"
                  mode="details"
                  onAdd={(calendarId, block) =>
                    changeBlock.mutate(
                      block
                        ? {
                            blockId: block.eventId,
                            calendarId,
                            mode: "details",
                            operation: "update",
                          }
                        : { calendarId, mode: "details", operation: "create" },
                    )
                  }
                  onRemove={(block) =>
                    changeBlock.mutate({
                      blockId: block.eventId,
                      calendarId: block.calendarId,
                      mode: block.mode,
                      operation: "delete",
                    })
                  }
                />
              </dd>
            </div>
            <div>
              <dt>
                <EyeOffIcon aria-hidden="true" className="size-[15px]" /> Shown as Busy
              </dt>
              <dd>
                <EventVisibilityList
                  blocks={blocks}
                  calendars={calendarsWithBusyOnly}
                  destinations={blockDestinations}
                  disabled={changeBlock.isPending}
                  label="Calendars shown as busy"
                  mode="busy"
                  onAdd={(calendarId, block) =>
                    changeBlock.mutate(
                      block
                        ? {
                            blockId: block.eventId,
                            calendarId,
                            mode: "busy",
                            operation: "update",
                          }
                        : { calendarId, mode: "busy", operation: "create" },
                    )
                  }
                  onRemove={(block) =>
                    changeBlock.mutate({
                      blockId: block.eventId,
                      calendarId: block.calendarId,
                      mode: block.mode,
                      operation: "delete",
                    })
                  }
                />
              </dd>
            </div>
          </dl>
        </section>
        <dl className="event-sheet__facts">
          {presentation === "sheet" ? (
            <div>
              <dt>
                <ClockIcon aria-hidden="true" className="size-[17px]" /> Time
              </dt>
              <dd>{formatEventRange(event, user.planningTimezone)}</dd>
            </div>
          ) : null}
          <div>
            <dt>
              <CalendarIcon aria-hidden="true" className="size-[17px]" /> Time Zone
            </dt>
            <dd>
              {user.planningTimezone} ·{" "}
              {formatTimeZoneName(new Date(event.startsAt), user.planningTimezone)}
            </dd>
          </div>
          {event.location ? (
            <div>
              <dt>
                <MapPinIcon aria-hidden="true" className="size-[17px]" /> Location
              </dt>
              <dd>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {event.location} <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
        {changeBlock.isError ? (
          <p className="form-error" role="alert">
            {errorMessage(changeBlock.error)}
          </p>
        ) : null}
        <section className="event-sheet__notes" aria-labelledby="event-notes-title">
          <h3 id="event-notes-title">
            <FileTextIcon aria-hidden="true" className="size-4" /> Notes
          </h3>
          {event.notes ? (
            <Suspense fallback={<p className="event-sheet__empty">Formatting notes…</p>}>
              <RichEventNotes source={event.notes} />
            </Suspense>
          ) : (
            <p className="event-sheet__empty">No notes attached to this event.</p>
          )}
        </section>
        <div className="event-sheet__sync-note">
          <CloudIcon aria-hidden="true" className="size-4" />
          <span>
            {event.provider === "google"
              ? "Edits write through to Google Calendar before they appear here."
              : "This event is stored in nohmi and available to authorized agents."}
          </span>
        </div>
        {remove.isError ? (
          <p className="form-error" role="alert">
            {errorMessage(remove.error)}
          </p>
        ) : null}
      </div>
      <footer className="event-sheet__actions">
        {confirmDelete ? (
          <div className="event-sheet__confirm">
            <span>Delete this event everywhere?</span>
            <Button onClick={() => setConfirmDelete(false)}>Keep Event</Button>
            <Button disabled={remove.isPending} onClick={() => remove.mutate()} tone="danger">
              {remove.isPending ? <Spinner label="Deleting" /> : "Delete Event"}
            </Button>
          </div>
        ) : (
          <>
            <Button
              disabled={!calendar?.isWritable}
              onClick={() => setConfirmDelete(true)}
              tone="danger"
            >
              <TrashIcon aria-hidden="true" className="size-[15px]" /> Delete
            </Button>
            <Button disabled={!calendar?.isWritable} onClick={edit} tone="accent">
              <EditIcon aria-hidden="true" className="size-[15px]" /> Edit Event
            </Button>
          </>
        )}
      </footer>
    </>
  );
  if (presentation === "floating") {
    return (
      <ShadcnCard
        aria-labelledby="event-sheet-title"
        className="calendar-floating-nav__composer is-calendar-colored event-details-card"
        ref={sheetRef}
        role="dialog"
        style={{ "--calendar-color": calendar?.color ?? "#777ce3" } as CSSProperties}
        tabIndex={-1}
      >
        {content}
      </ShadcnCard>
    );
  }
  return (
    <div className="event-sheet-backdrop">
      <button
        aria-label="Close event details"
        className="event-sheet-dismiss"
        onClick={close}
        type="button"
      />
      <div
        aria-labelledby="event-sheet-title"
        aria-modal="true"
        className="event-sheet"
        ref={sheetRef}
        role="dialog"
        tabIndex={-1}
      >
        {content}
      </div>
    </div>
  );
}

function EventVisibilityList({
  blocks,
  calendars,
  destinations,
  disabled,
  label,
  mode,
  onAdd,
  onRemove,
}: {
  blocks: CalendarEvent["blocks"];
  calendars: Calendar[];
  destinations: Calendar[];
  disabled: boolean;
  label: string;
  mode: "busy" | "details";
  onAdd: (calendarId: string, block: CalendarEvent["blocks"][number] | undefined) => void;
  onRemove: (block: CalendarEvent["blocks"][number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const availableCalendars = destinations.filter(
    (calendar) => blocks.find((block) => block.calendarId === calendar.id)?.mode !== mode,
  );
  const status = mode === "details" ? "Details Included" : "Shown as Busy";
  return (
    <ul aria-label={label} className="event-details-card__calendar-list">
      {calendars.map((calendar) => {
        const block = blocks.find((record) => record.calendarId === calendar.id);
        return (
          <ShadcnBadge asChild key={calendar.id} variant="secondary">
            <li
              className={mode === "details" ? "is-details-included" : "is-shown-as-busy"}
              style={{ "--badge-color": calendar.color ?? "var(--muted)" } as CSSProperties}
            >
              <i aria-hidden="true" style={{ background: calendar.color ?? "var(--muted)" }} />
              <span>{calendar.name}</span>
              {block ? (
                <button
                  aria-label={`Remove ${calendar.name} from ${status}`}
                  className="event-details-card__calendar-remove"
                  disabled={disabled}
                  onClick={() => onRemove(block)}
                  type="button"
                >
                  <XIcon aria-hidden="true" />
                </button>
              ) : null}
            </li>
          </ShadcnBadge>
        );
      })}
      <li>
        <ShadcnPopover onOpenChange={setOpen} open={open}>
          <ShadcnPopoverTrigger asChild>
            <ShadcnButton
              aria-label={`Add calendar to ${status}`}
              disabled={disabled || availableCalendars.length === 0}
              size="icon-xs"
              variant="outline"
            >
              <PlusIcon aria-hidden="true" />
            </ShadcnButton>
          </ShadcnPopoverTrigger>
          <ShadcnPopoverContent align="start" className="event-visibility-popover">
            <ShadcnPopoverHeader>
              <ShadcnPopoverTitle>Add to {status}</ShadcnPopoverTitle>
              <ShadcnPopoverDescription>
                {mode === "details"
                  ? "Share the event and its details on another calendar."
                  : "Show the occupied time without sharing event details."}
              </ShadcnPopoverDescription>
            </ShadcnPopoverHeader>
            <div className="event-visibility-popover__options">
              {availableCalendars.map((calendar) => (
                <ShadcnButton
                  key={calendar.id}
                  onClick={() => {
                    onAdd(
                      calendar.id,
                      blocks.find((block) => block.calendarId === calendar.id),
                    );
                    setOpen(false);
                  }}
                  variant="ghost"
                >
                  <i aria-hidden="true" style={{ background: calendar.color ?? "var(--muted)" }} />
                  <span>{calendar.name}</span>
                </ShadcnButton>
              ))}
            </div>
          </ShadcnPopoverContent>
        </ShadcnPopover>
      </li>
    </ul>
  );
}

function EventDialog({
  calendars,
  close,
  draft,
  event,
  user,
}: {
  calendars: Calendar[];
  close: () => void;
  draft?: EventDraft;
  event: CalendarEvent | undefined;
  user: User;
}) {
  const queryClient = useQueryClient();
  const writable = calendars.filter((calendar) => calendar.isWritable);
  const mutation = useMutation({
    mutationFn: (input: {
      allDay: boolean;
      calendarId: string;
      endsAt: string;
      location: string | null;
      notes: string | null;
      startsAt: string;
      timezone: string;
      title: string;
    }) => (event ? api.updateEvent(event.id, input) : api.createEvent(input)),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    mutation.mutate({
      allDay: form.get("allDay") === "on",
      calendarId: String(form.get("calendarId")),
      endsAt: dateTimeLocalToIso(String(form.get("endsAt")), user.planningTimezone),
      location: nullable(form.get("location")),
      notes: nullable(form.get("notes")),
      startsAt: dateTimeLocalToIso(String(form.get("startsAt")), user.planningTimezone),
      timezone: user.planningTimezone,
      title: String(form.get("title")),
    });
  };
  return (
    <Modal
      close={close}
      eyebrow="Calendar"
      title={event ? "Refine event" : "Shape a block of time"}
    >
      <form className="editor-form" onSubmit={submit}>
        <Field autoFocus defaultValue={event?.title} label="Event" name="title" required />
        <label className="field">
          <span>Calendar</span>
          <select
            defaultValue={event?.calendarId ?? writable[0]?.id}
            disabled={Boolean(event)}
            name="calendarId"
            required
          >
            {writable.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name} · {calendar.provider}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <Field
            defaultValue={toDateTimeLocal(
              draft?.startsAt ?? event?.startsAt,
              user.planningTimezone,
              1,
            )}
            label="Starts"
            name="startsAt"
            type="datetime-local"
            required
          />
          <Field
            defaultValue={toDateTimeLocal(draft?.endsAt ?? event?.endsAt, user.planningTimezone, 2)}
            label="Ends"
            name="endsAt"
            type="datetime-local"
            required
          />
        </div>
        <div className="form-grid">
          <Field defaultValue={event?.location ?? ""} label="Location" name="location" />
          <label className="check-field">
            <input defaultChecked={event?.allDay} name="allDay" type="checkbox" /> All day
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea
            aria-describedby="event-notes-help"
            defaultValue={event?.notes ?? ""}
            name="notes"
            rows={5}
          />
          <small className="field-help" id="event-notes-help">
            Markdown and safe HTML render in event details and stay intact when synced.
          </small>
        </label>
        <FormActions
          close={close}
          error={mutation.error}
          pending={mutation.isPending}
          submitLabel={event ? "Save changes" : "Create event"}
        />
      </form>
    </Modal>
  );
}

function CalendarDialog({ close, user }: { close: () => void; user: User }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api.createCalendar({
        color: String(form.get("color")),
        name: String(form.get("name")),
        timezone: user.planningTimezone,
      }),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  return (
    <Modal close={close} eyebrow="Local calendar" title="Create a new material">
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <Field autoFocus label="Calendar name" name="name" required />
        <Field defaultValue="#7c8cff" label="Color" name="color" type="color" required />
        <FormActions
          close={close}
          error={mutation.error}
          pending={mutation.isPending}
          submitLabel="Create calendar"
        />
      </form>
    </Modal>
  );
}

function Modal({
  children,
  close,
  eyebrow,
  title,
}: {
  children: ReactNode;
  close: () => void;
  eyebrow: string;
  title: string;
}) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [close]);
  useDialogFocus(modalRef);
  return (
    <div className="modal-backdrop">
      <button aria-label="Close dialog" className="modal-dismiss" onClick={close} type="button" />
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal"
        ref={modalRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <Button aria-label="Close" onClick={close} tone="ghost">
            <XIcon className="size-[19px]" />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

function useDialogFocus(container: { current: HTMLElement | null }) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement;
    const dialog = container.current as HTMLElement;
    dialog.focus();
    return () => previouslyFocused.focus();
  }, [container]);
}

function FormActions({
  close,
  error,
  pending,
  submitLabel,
}: {
  close: () => void;
  error: unknown;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      <div className="form-actions">
        <Button onClick={close}>Cancel</Button>
        <Button disabled={pending} tone="accent" type="submit">
          {pending ? <Spinner label="Saving" /> : submitLabel}
        </Button>
      </div>
    </>
  );
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generatedId = useId();
  const fieldId = props.id ?? generatedId;
  return (
    <Label className="field" htmlFor={fieldId}>
      <span>{label}</span>
      <Input {...props} id={fieldId} />
    </Label>
  );
}

function FatalState({ error }: { error: unknown }) {
  if (error instanceof TypeError) {
    return <OfflineState />;
  }
  return (
    <main className="center-screen">
      <InlineError error={error} />
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </main>
  );
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function workspaceOwnerName(user: User): string {
  const firstName = user.displayName.trim().split(/\s+/)[0];
  return firstName || user.email.split("@")[0] || "Your";
}
function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
function toDateTimeLocal(
  value: string | null | undefined,
  timeZone: string,
  hoursFromNow?: number,
) {
  if (!value && hoursFromNow === undefined) return "";
  const date = value
    ? new Date(value)
    : new Date(Date.now() + (hoursFromNow as number) * 3_600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}
function dateTimeLocalToIso(value: string, timeZone: string): string {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}
function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(value),
  );
}

export function formatTimelineTimeRange(event: CalendarEvent, timeZone: string) {
  const start = formatTime(event.startsAt, timeZone);
  const end = formatTime(event.endsAt, timeZone);
  if (start !== end || new Date(event.endsAt).getTime() <= new Date(event.startsAt).getTime()) {
    return `${start}–${end}`;
  }
  return `${start} ${formatTimeZoneName(new Date(event.startsAt), timeZone)}–${end} ${formatTimeZoneName(new Date(event.endsAt), timeZone)}`;
}
function formatWeatherCoordinates(coordinates: WeatherCoordinates) {
  return `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`;
}

function weatherMapEmbedUrl(coordinates: WeatherCoordinates) {
  const latitudeSpan = 0.035;
  const longitudeSpan = 0.05;
  const parameters = new URLSearchParams({
    bbox: [
      coordinates.longitude - longitudeSpan,
      coordinates.latitude - latitudeSpan,
      coordinates.longitude + longitudeSpan,
      coordinates.latitude + latitudeSpan,
    ].join(","),
    layer: "mapnik",
    marker: `${coordinates.latitude},${coordinates.longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${parameters.toString()}`;
}

function weatherSkyPeriod(observedAt: string, timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      new Date(observedAt),
    ),
  );
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}
function formatEventRange(event: CalendarEvent, timeZone: string): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const startDay = localDateAt(start, timeZone);
  const endDisplay = event.allDay ? new Date(end.getTime() - 1) : end;
  const endDay = localDateAt(endDisplay, timeZone);
  const dateFormatter = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
    year: "numeric",
  });
  if (event.allDay) {
    return sameLocalDate(startDay, endDay)
      ? `${dateFormatter.format(start)} · All day`
      : `${dateFormatter.format(start)} – ${dateFormatter.format(endDisplay)} · All day`;
  }
  if (sameLocalDate(startDay, endDay)) {
    return `${dateFormatter.format(start)} · ${formatTime(event.startsAt, timeZone)}–${formatTime(event.endsAt, timeZone)}`;
  }
  const includeYear = startDay.year !== endDay.year;
  return `${formatMaterialDateTime(event.startsAt, timeZone, { includeYear })} – ${formatMaterialDateTime(event.endsAt, timeZone, { includeYear })}`;
}
const formatRelative = formatRelativeTime;
function formatMinutes(value: number) {
  if (value === 0) return "No time";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
function minuteToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
const calendarWeekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatLocalDate(date: LocalDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day, 12)),
  );
}

function formatLocalWeekday(date: LocalDate): string {
  return formatLocalDate(date, { weekday: "long" });
}

function localDateKey(date: LocalDate): string {
  return localDateToIso(date);
}

function startCalendarDrag(
  dragEvent: ReactDragEvent<HTMLButtonElement>,
  event: CalendarEvent,
  setDraggedEventId: (id: string | null) => void,
) {
  const bounds = dragEvent.currentTarget.getBoundingClientRect();
  const clientY = Number.isFinite(dragEvent.clientY) ? dragEvent.clientY : bounds.top;
  const grabOffsetY = Math.min(Math.max(0, bounds.height), Math.max(0, clientY - bounds.top));
  const clientX = Number.isFinite(dragEvent.clientX) ? dragEvent.clientX : bounds.left;
  const grabOffsetX = Math.min(Math.max(0, bounds.width), Math.max(0, clientX - bounds.left));
  dragEvent.dataTransfer.effectAllowed = "move";
  dragEvent.dataTransfer.setData(calendarDragType, event.id);
  dragEvent.dataTransfer.setData(calendarDragOffsetType, String(grabOffsetY));
  calendarDragOffsets.set(event.id, grabOffsetY);
  calendarDragMetrics.set(event.id, {
    color: dragEvent.currentTarget.style.getPropertyValue("--calendar-color") || "#777ce3",
    grabOffsetX,
    grabOffsetY,
    width: bounds.width,
  });
  setCalendarDragImage(dragEvent);
  setDraggedEventId(event.id);
}

function setCalendarDragImage(dragEvent: ReactDragEvent<HTMLButtonElement>) {
  if (typeof dragEvent.dataTransfer.setDragImage !== "function") return;
  const image = document.createElement("div");
  image.setAttribute("aria-hidden", "true");
  Object.assign(image.style, {
    background: "transparent",
    border: "0",
    height: "1px",
    left: "-10000px",
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "-10000px",
    width: "1px",
  });
  document.body.append(image);
  dragEvent.dataTransfer.setDragImage(image, 0, 0);
  window.requestAnimationFrame(() => image.remove());
}

function allowCalendarDrop(dragEvent: ReactDragEvent<HTMLElement>, draggedEventId: string | null) {
  if (!draggedEventId) return;
  dragEvent.preventDefault();
  dragEvent.dataTransfer.dropEffect = "move";
}

function calendarDragGrabOffset(dataTransfer: DataTransfer, eventId: string) {
  const storedOffset = calendarDragOffsets.get(eventId);
  if (storedOffset !== undefined) return storedOffset;
  const offset = Number(dataTransfer.getData(calendarDragOffsetType));
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

function timelineMinuteAtPointer(
  pointerEvent: { clientY: number },
  timeline: HTMLElement,
  grabOffsetY = 0,
) {
  const bounds = timeline.getBoundingClientRect();
  const clientY = Number.isFinite(pointerEvent.clientY) ? pointerEvent.clientY : 0;
  const top = Number.isFinite(bounds.top) ? bounds.top : 0;
  const relativeY = Math.min(calendarTimelineHeight, Math.max(0, clientY - top - grabOffsetY));
  const unsnappedMinute = (relativeY / calendarTimelineHeight) * calendarMinutesPerDay;
  return Math.min(23 * 60 + 45, Math.max(0, Math.round(unsnappedMinute / 15) * 15));
}

function createRangeMinuteAtPointer(pointerEvent: { clientY: number }, timeline: HTMLElement) {
  const bounds = timeline.getBoundingClientRect();
  const relativeY = Math.min(
    calendarTimelineHeight,
    Math.max(0, pointerEvent.clientY - bounds.top),
  );
  const minute = (relativeY / calendarTimelineHeight) * calendarMinutesPerDay;
  return Math.min(calendarMinutesPerDay, Math.max(0, Math.round(minute / 15) * 15));
}

function previewTimelineDrop(
  dragEvent: ReactDragEvent<HTMLElement>,
  day: LocalDate,
  events: CalendarEvent[],
  draggedEventId: string | null,
  setPreview: (preview: CalendarDropPreview | null) => void,
  timeZone: string,
) {
  if (!draggedEventId) return;
  allowCalendarDrop(dragEvent, draggedEventId);
  const dragged = events.find(
    (event) => event.id === (dragEvent.dataTransfer.getData(calendarDragType) || draggedEventId),
  );
  if (!dragged || dragged.allDay) return;
  const metrics = calendarDragMetrics.get(dragged.id);
  const minute = timelineMinuteAtPointer(
    dragEvent,
    dragEvent.currentTarget,
    calendarDragGrabOffset(dragEvent.dataTransfer, dragged.id),
  );
  const duration = Math.max(
    15,
    Math.round(
      (new Date(dragged.endsAt).getTime() - new Date(dragged.startsAt).getTime()) / 60_000,
    ),
  );
  const dayRange = localDateRange(day, addLocalDays(day, 1), timeZone);
  const dayStart = new Date(dayRange.from).getTime();
  const dayEnd = new Date(dayRange.to).getTime();
  const stationaryEvents = events.filter(
    (event) =>
      event.id !== dragged.id &&
      new Date(event.startsAt).getTime() < dayEnd &&
      new Date(event.endsAt).getTime() > dayStart,
  );
  const movedEvent = { ...dragged, ...movedEventTimes(dragged, day, minute, timeZone) };
  const movedLayout = positionTimelineEvents([...stationaryEvents, movedEvent], day, timeZone).find(
    (layout) => layout.event.id === dragged.id,
  );
  setPreview({
    color: metrics?.color ?? "#777ce3",
    column: movedLayout?.column ?? 0,
    dayKey: localDateKey(day),
    duration,
    grabOffsetX: metrics?.grabOffsetX ?? 0,
    grabOffsetY: metrics?.grabOffsetY ?? 0,
    minute,
    pointerX: Number.isFinite(dragEvent.clientX) ? dragEvent.clientX : (metrics?.grabOffsetX ?? 0),
    pointerY: Number.isFinite(dragEvent.clientY) ? dragEvent.clientY : (metrics?.grabOffsetY ?? 0),
    width: metrics?.width ?? 160,
  });
}

function clearTimelineDropPreview(
  dragEvent: ReactDragEvent<HTMLElement>,
  setPreview: (preview: CalendarDropPreview | null) => void,
) {
  if (dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) return;
  setPreview(null);
}

function dropTimelineEvent(
  dragEvent: ReactDragEvent<HTMLElement>,
  day: LocalDate,
  events: CalendarEvent[],
  moveEvent: (event: CalendarEvent, day: LocalDate, minute: number) => void,
  setDraggedEventId: (id: string | null) => void,
) {
  dragEvent.preventDefault();
  const id = dragEvent.dataTransfer.getData(calendarDragType);
  const event = events.find((record) => record.id === id);
  if (event) {
    const minute = timelineMinuteAtPointer(
      dragEvent,
      dragEvent.currentTarget,
      calendarDragGrabOffset(dragEvent.dataTransfer, id),
    );
    moveEvent(event, day, minute);
  }
  calendarDragOffsets.delete(id);
  calendarDragMetrics.delete(id);
  setDraggedEventId(null);
}

function findDraggedEvent(
  dragEvent: ReactDragEvent<HTMLElement>,
  eventsByDay: Map<string, CalendarEvent[]>,
  fallbackId: string | null,
): CalendarEvent | undefined {
  const id = dragEvent.dataTransfer.getData(calendarDragType) || fallbackId;
  return Array.from(eventsByDay.values())
    .flat()
    .find((event) => event.id === id);
}

function movedEventTimes(
  event: CalendarEvent,
  day: LocalDate,
  minute: number,
  timeZone: string,
): Pick<CalendarEvent, "endsAt" | "startsAt"> {
  if (event.allDay) {
    const originalStart = localDateAt(new Date(event.startsAt), timeZone);
    const originalEnd = localDateAt(new Date(event.endsAt), timeZone);
    const dayCount = Math.max(1, differenceInLocalDays(originalStart, originalEnd));
    const range = localDateRange(day, addLocalDays(day, dayCount), timeZone);
    return { endsAt: range.to, startsAt: range.from };
  }
  const startsAt = localDateTimeToUtc(day, minute, timeZone).toISOString();
  const duration = Math.max(
    15 * 60_000,
    new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime(),
  );
  return { endsAt: new Date(new Date(startsAt).getTime() + duration).toISOString(), startsAt };
}

function differenceInLocalDays(from: LocalDate, to: LocalDate): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  );
}

function localDateTimeAt(value: Date | string, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      month: "numeric",
      second: "numeric",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: {
      day: Number(values.day),
      month: Number(values.month),
      year: Number(values.year),
    } satisfies LocalDate,
    minute: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60,
  };
}

function minuteToTimelinePixels(minute: number): number {
  return (minute / 60) * calendarHourHeight;
}

export function positionTimelineEvents<T extends TimelinePositionable>(
  events: T[],
  day: LocalDate,
  timeZone: string,
): TimelineEventLayout<T>[] {
  const intervals = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const start = localDateTimeAt(event.startsAt, timeZone);
      const end = localDateTimeAt(event.endsAt, timeZone);
      const startMinute = sameLocalDate(start.date, day) ? start.minute : 0;
      const endMinute = sameLocalDate(end.date, day) ? end.minute : calendarMinutesPerDay;
      const elapsedMinutes = Math.max(
        15,
        (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000,
      );
      return {
        endMinute: Math.min(
          calendarMinutesPerDay,
          Math.max(endMinute, startMinute + elapsedMinutes),
        ),
        event,
        startMinute: Math.max(0, startMinute),
      };
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        left.event.id.localeCompare(right.event.id),
    );
  const layouts: TimelineEventLayout<T>[] = [];
  let cluster: typeof intervals = [];
  let clusterEnd = -Infinity;
  const layoutCluster = () => {
    const columnEnds: number[] = [];
    for (const interval of cluster) {
      const column = columnEnds.findIndex((endMinute) => endMinute <= interval.startMinute);
      const resolvedColumn = column === -1 ? columnEnds.length : column;
      columnEnds[resolvedColumn] = interval.endMinute;
      layouts.push({ ...interval, column: resolvedColumn, columns: 0 });
    }
    const columns = columnEnds.length;
    for (let index = layouts.length - cluster.length; index < layouts.length; index += 1) {
      const layout = layouts[index];
      if (layout) layouts[index] = { ...layout, columns };
    }
  };
  for (const interval of intervals) {
    if (cluster.length > 0 && interval.startMinute >= clusterEnd) {
      layoutCluster();
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(interval);
    clusterEnd = Math.max(clusterEnd, interval.endMinute);
  }
  if (cluster.length > 0) layoutCluster();
  return layouts;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function formatMinuteOfDay(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const suffix = minute % 60 === 0 ? "" : `:${String(minute % 60).padStart(2, "0")}`;
  if (hour === 0) return `12${suffix} AM`;
  if (hour === 12) return `12${suffix} PM`;
  return hour < 12 ? `${hour}${suffix} AM` : `${hour - 12}${suffix} PM`;
}

function formatTimeZoneName(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "short" }).formatToParts(
    date,
  );
  return (parts[parts.length - 1] as Intl.DateTimeFormatPart).value;
}
