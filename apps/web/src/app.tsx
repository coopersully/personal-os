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
  TaskListQuery,
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
  startOfLocalWeek,
} from "@personal-os/domain";
import { Badge, Button, EmptyState, Input, Label, Spinner } from "@personal-os/ui";
import {
  type QueryClient,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  type FormEvent,
  lazy,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
  Suspense,
  startTransition,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  type Navigator,
  NavLink,
  Route,
  Routes,
  UNSAFE_NavigationContext,
  useLocation,
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
import { BrandMark, brandTitle, hasBrandMark } from "@/components/brand-marks";
import { ChoiceCardGroup } from "@/components/choice-card-group";
import {
  EventCard,
  EventCardAside,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardFooter,
  EventCardIndicator,
  EventCardPrimaryAction,
  EventCardTime,
  EventCardTitle,
} from "@/components/event-card";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BankIcon,
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CloudIcon,
  CloudRainIcon,
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
  PanelTopIcon,
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
  AvatarImage as ShadcnAvatarImage,
} from "@/components/ui/avatar";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";
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
  SidebarMenuSub as ShadcnSidebarMenuSub,
  SidebarMenuSubItem as ShadcnSidebarMenuSubItem,
  SidebarProvider as ShadcnSidebarProvider,
} from "@/components/ui/sidebar";
import { Slider as ShadcnSlider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
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
import {
  getWorkspaceCalendarEntry,
  workspaceCalendarSummary,
  workspaceCountSummary,
  workspaceFinanceSummary,
  workspaceIndicatorOffset,
  workspaceIntentStaleTime,
  workspaceTodaySummary,
} from "./components/workspace-switching.js";
import { ActivityPage, ActivityTopbarControls } from "./features/activity/page.js";
import { calendarNavigationItem } from "./features/calendar/manifest.js";
import {
  type CalendarView,
  calendarPeriodDays,
  calendarQueryKeys,
  calendarViewFromSearch,
} from "./features/calendar/page.js";
import {
  ConnectionHealthBadge,
  ConnectionHealthDescription,
  ConnectionRecoveryAlert,
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
import { SetupPage } from "./features/setup/page.js";
import { tasksNavigationItem } from "./features/tasks/manifest.js";
import {
  TaskRow,
  TasksCreateButton,
  TasksPage,
  TasksSidebar,
  TasksTopbarControls,
} from "./features/tasks/page.js";
import { TaskDialog } from "./features/tasks/task-dialog.js";
import { formatMaterialDateTime, formatOrdinalDate } from "./lib/date-format.js";
import { invalidateMaterial } from "./lib/material-queries.js";
import { formatRelativeTime } from "./lib/time-format.js";
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
type CalendarDropPreview = { dayKey: string; duration: number; minute: number };
type EventDraft = { endsAt: string; startsAt: string };
type CalendarMap = Map<string, Calendar>;
type ContextSidebarMode = "calendar" | "finances" | "mail" | "settings" | "tasks" | null;

const calendarViews: Array<{ icon: Icon; label: string; value: CalendarView }> = [
  { icon: CalendarIcon, label: "Day", value: "day" },
  { icon: ColumnsIcon, label: "Week", value: "week" },
  { icon: GridIcon, label: "Month", value: "month" },
];

const RichEventNotes = lazy(() => import("./rich-event-notes.js"));

const calendarHourHeight = 64;
const calendarMinutesPerDay = 24 * 60;
const calendarTimelineHeight = 24 * calendarHourHeight;
const calendarHours = Array.from({ length: 24 }, (_, hour) => hour);
const calendarDragType = "application/x-personal-os-calendar-event";

type NavigationItemDefinition = {
  badge?: number | string;
  icon: Icon;
  items?: NavigationItemDefinition[];
  label: string;
  path: string;
};

type NavigationGroupDefinition = {
  items: NavigationItemDefinition[];
  label: string;
};

type WorkspaceTransitionDirection = "down" | "none" | "up";

type WorkspacePreview = {
  direction: Exclude<WorkspaceTransitionDirection, "none">;
  path: string;
};

const todayNavigationItem: NavigationItemDefinition = {
  icon: PanelTopIcon,
  label: "Today",
  path: "/today",
};

const _planNavigationItems: NavigationItemDefinition[] = [
  todayNavigationItem,
  calendarNavigationItem,
  {
    ...tasksNavigationItem,
    items: [{ icon: ListTodoIcon, label: "Reminders", path: "/reminders" }],
  },
];

const lifeNavigationItems: NavigationItemDefinition[] = [
  { icon: ShieldCheckIcon, label: "Reviews", path: "/reviews" },
  { icon: TargetIcon, label: "Goals", path: "/goals" },
  { icon: CompassIcon, label: "Motives", path: "/motives" },
  // Today owns Activity. It left the account menu with the workspace-ownership
  // change, so the Today sidebar is the only place that can still reach it.
  { icon: ActivityIcon, label: "Activity", path: "/activity" },
];

const todayNavigationGroups: NavigationGroupDefinition[] = [
  { items: [todayNavigationItem], label: "Plan" },
  { items: lifeNavigationItems, label: "Personal" },
];

const workspaceShortcuts: WorkspaceDefinition[] = workspaceDefinitions;

const accountNavigationItems: NavigationItemDefinition[] = [
  { icon: SparklesIcon, label: "Setup", path: "/setup" },
  settingsNavigationItem,
];

function workspaceForPath(pathname: string): WorkspaceDefinition | undefined {
  return workspaceForLocation(pathname);
}

/** Today's registry label is its page title; navigation names it plainly. */
function workspaceLabelForPath(pathname: string): string {
  const workspace = workspaceForLocation(pathname);
  return workspace && workspace.id !== "today" ? workspace.label : "Today";
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

const ignorePreviewNavigation = () => undefined;

const maximumTaskPagesPerSurface = 100;

export async function loadAllTaskPages(
  loadPage: (query: Partial<TaskListQuery>) => Promise<{
    items: Task[];
    nextCursor: string | null;
  }>,
  query: Partial<TaskListQuery>,
): Promise<{ items: Task[]; nextCursor: null }> {
  const items: Task[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maximumTaskPagesPerSurface; pageNumber += 1) {
    const page = await loadPage({ ...query, limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (page.nextCursor === null) return { items, nextCursor: null };
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Task pagination returned a repeated cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error(`Task pagination exceeded ${maximumTaskPagesPerSurface} pages.`);
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
        <Spinner label="Opening ilo" />
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
    return <SetupPage user={user} />;
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
      <section className="auth-story" aria-label="Product introduction">
        <div className="wordmark wordmark--light">
          <LogoMark /> ilo
        </div>
        <div>
          <p className="eyebrow">A shared surface for you and your agents</p>
          <h1>Your day, made tangible.</h1>
          <p className="auth-story__copy">
            One calm place for reminders and calendars. Directly editable by you. Safely available
            to the agents you trust.
          </p>
        </div>
        <EventCard aria-hidden="true" className="relative z-[1] max-w-[520px]" tone="inverse">
          <EventCardContent>
            <EventCardTime>09:30</EventCardTime>
            <EventCardIndicator />
            <EventCardBody>
              <EventCardTitle>Design review</EventCardTitle>
              <EventCardDescription>Product calendar · 45 min</EventCardDescription>
            </EventCardBody>
            <EventCardAside>
              <CalendarIcon />
            </EventCardAside>
          </EventCardContent>
        </EventCard>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form__heading">
            <LogoMark />
            <h2>
              {mode === "login"
                ? "Welcome back"
                : mode === "recovery"
                  ? "Reset your password"
                  : "Make this yours"}
            </h2>
            <p>
              {mode === "login"
                ? "Open your daily surface."
                : mode === "recovery"
                  ? "We’ll send a reset link if this address has an account."
                  : "Enter your invitation to create an account."}
            </p>
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
                    className="text-button auth-field-action"
                    onClick={() => selectMode("recovery")}
                    type="button"
                  >
                    Forgot your password?
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
          <Button
            className="button--wide"
            disabled={mutation.isPending || !canSubmit}
            tone="accent"
            type="submit"
          >
            {mutation.isPending ? (
              <Spinner label="Signing in" />
            ) : mode === "login" ? (
              "Open ilo"
            ) : mode === "recovery" ? (
              "Send reset link"
            ) : (
              "Create account"
            )}
          </Button>
          {mode === "login" ? (
            <button className="text-button" type="button" onClick={() => selectMode("register")}>
              I have an invite code
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
      <p>Confirm the email address for this ilo account.</p>
      {verification.isError ? (
        <p className="form-error">{errorMessage(verification.error)}</p>
      ) : null}
      {verification.isSuccess ? (
        <p className="form-success" role="status">
          Your email is confirmed. You can close this page or continue using ilo.
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
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div className="auth-form__heading">
            <LogoMark />
            <h2>{title}</h2>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

/**
 * Remembers the workspace the account utility was opened from so it can offer
 * an honest return target. Falls back to Today when no workspace was visited,
 * such as on a cold deep link straight to `/settings`.
 */
function useAccountReturnPath(workspacePath: string | null): string {
  const remembered = useRef("/today");
  if (workspacePath) remembered.current = workspacePath;
  return remembered.current;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [editor, setEditor] = useState<Editor>(null);
  const [calendarTodaySnap, setCalendarTodaySnap] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pinned, setPinned] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [workspacePreview, setWorkspacePreview] = useState<WorkspacePreview | null>(null);
  const location = useLocation();
  const isMobileWorkspaceDock = useMediaQuery("(max-width: 900px)");
  const activeWorkspace = workspaceForPath(location.pathname);
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
  const accountReturnPath = useAccountReturnPath(activeWorkspace?.path ?? null);
  const isTodayWorkspace = activeWorkspace?.path === "/today";
  const deviceWeatherLocation = useDeviceWeatherLocation(isTodayWorkspace);
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const weather = useQuery({
    enabled:
      (isTodayWorkspace || workspaceSwitcherOpen) &&
      (deviceWeatherLocation.coordinates !== null ||
        ((deviceWeatherLocation.status !== "pending" || workspaceSwitcherOpen) &&
          user.homeLocation !== null)),
    queryFn: () => api.getWeather(deviceWeatherLocation.coordinates ?? undefined),
    queryKey: ["weather", deviceWeatherLocation.coordinates, user.homeLocation],
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  const todayBrief = useQuery({
    enabled: isTodayWorkspace || workspaceSwitcherOpen,
    queryFn: api.getDailyBrief,
    queryKey: ["daily-brief", user.planningTimezone],
    refetchInterval: 60_000,
  });
  // The narrow dock owns navigation below 900px, so the desktop sidebar has no
  // drawer to dismiss. Destinations still receive this hook so the dock's sheet
  // and the sidebar share one navigation contract.
  const closeMobileMenu = () => undefined;
  // The manifest owner, never a route name, selects the sidebar. Today is the
  // one workspace whose sidebar is the application navigation itself.
  // A standalone flow never reaches the shell, so an owner here is either a
  // workspace or the account utility. Today's sidebar is the application
  // navigation itself and therefore has no contextual mode.
  const sidebarMode: ContextSidebarMode =
    navigationOwner.kind !== "workspace"
      ? "settings"
      : navigationOwner.workspace === "today"
        ? null
        : navigationOwner.workspace;
  const workspaceSettingsActions = useWorkspaceSettingsActions(sidebarMode === "settings");
  const activeSettingsSection = settingsSectionFromSearch(location.search);
  const pageTitle = workspaceTitleForLocation(location.pathname, location.search);
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

  return (
    <>
      <div className="app-shell">
        <PinterestWallpaperScheduler />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {!isMobileWorkspaceDock ? (
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
              {navigationOwner.kind === "account-utility" ? (
                <Link
                  aria-label={`Back to ${workspaceLabelForPath(accountReturnPath)}`}
                  className="sidebar__back"
                  onClick={closeMobileMenu}
                  to={accountReturnPath}
                >
                  <ArrowLeftIcon aria-hidden="true" className="size-[18px]" />{" "}
                  <span>{workspaceLabelForPath(accountReturnPath)}</span>
                </Link>
              ) : (
                <WorkspaceSwitcher
                  onNavigate={closeMobileMenu}
                  onOpenChange={setWorkspaceSwitcherOpen}
                  onPreviewChange={setWorkspacePreview}
                  pathname={location.pathname}
                  search={location.search}
                  user={user}
                  weather={weather.data}
                />
              )}
            </ShadcnSidebarHeader>
            <ShadcnSidebarContent
              className={`sidebar__content${sidebarMode ? " sidebar__content--context" : " sidebar__content--app"}${sidebarMode === "calendar" ? " sidebar__content--calendar" : ""}`}
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
              ) : sidebarMode === "calendar" ? (
                <CalendarSidebar user={user} />
              ) : sidebarMode === "tasks" ? (
                <TasksSidebar onNavigate={closeMobileMenu} />
              ) : sidebarMode === "mail" ? (
                <MailFeatureSidebar onNavigate={closeMobileMenu} />
              ) : (
                // Today is the only owner without a contextual sidebar, so this
                // branch always renders its navigation.
                todayNavigationGroups.map((group) => (
                  <ShadcnSidebarGroup key={group.label}>
                    <ShadcnSidebarGroupLabel>{group.label}</ShadcnSidebarGroupLabel>
                    <ShadcnSidebarGroupContent>
                      <nav aria-label={group.label}>
                        <ShadcnSidebarMenu>
                          {group.items.map((item) => (
                            <SidebarNavigationItem
                              key={item.path}
                              onNavigate={closeMobileMenu}
                              {...item}
                            />
                          ))}
                        </ShadcnSidebarMenu>
                      </nav>
                    </ShadcnSidebarGroupContent>
                  </ShadcnSidebarGroup>
                ))
              )}
            </ShadcnSidebarContent>
            <ShadcnSidebarFooter className="sidebar__footer">
              <AccountMenu onNavigate={closeMobileMenu} user={user} />
            </ShadcnSidebarFooter>
          </aside>
        ) : null}
        {isMobileWorkspaceDock ? (
          <MobileWorkspaceDock
            accountName={workspaceOwnerName(user)}
            accountSections={settingsSectionPages(
              user.canManageInvitations === true,
              workspaceSettingsActions,
            )}
            onLogout={mobileDockLogout}
            pathname={location.pathname}
            {...(sidebarMode === "tasks"
              ? {
                  renderWorkspaceNavigation: (onNavigate: () => void) => (
                    <TasksSidebar onNavigate={onNavigate} />
                  ),
                }
              : {})}
            workspaceDefinitions={workspaceDefinitions}
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
            onCalendarToday={() => setCalendarTodaySnap((current) => current + 1)}
            pageTitle={pageTitle}
            pathname={location.pathname}
            pinned={pinned}
            setEditor={setEditor}
            todayBrief={todayBrief.data}
            togglePin={togglePin}
            user={user}
            weather={weather.data}
          />

          <main
            className={`content${sidebarMode === "calendar" || sidebarMode === "mail" ? ` content--${sidebarMode}` : ""}`}
            id="main-content"
          >
            <div className="workspace-stage">
              <div
                className="workspace-route"
                data-direction={routeDirection}
                key={activeWorkspace?.path ?? location.pathname}
              >
                {pageTitle ? <h1 className="sr-only">{pageTitle}</h1> : null}
                <WorkspaceRoutes
                  calendarTodaySnap={calendarTodaySnap}
                  deviceWeatherLocation={deviceWeatherLocation}
                  setEditor={setEditor}
                  todayBrief={todayBrief}
                  user={user}
                  weather={weather}
                />
              </div>
              {workspaceSwitcherOpen && workspacePreview ? (
                <div
                  aria-hidden="true"
                  className="workspace-preview"
                  data-direction={workspacePreview.direction}
                  data-workspace={workspacePreview.path.slice(1)}
                  inert
                  key={`preview:${workspacePreview.path}`}
                >
                  <WorkspacePreviewNavigationBoundary>
                    <WorkspaceRoutes
                      calendarTodaySnap={calendarTodaySnap}
                      deviceWeatherLocation={deviceWeatherLocation}
                      locationOverride={workspacePreview.path}
                      setEditor={setEditor}
                      todayBrief={todayBrief}
                      user={user}
                      weather={weather}
                    />
                  </WorkspacePreviewNavigationBoundary>
                </div>
              ) : null}
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

function WorkspacePreviewNavigationBoundary({ children }: { children: ReactNode }) {
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const inertNavigationContext = useMemo(() => {
    const source = navigationContext?.navigator;
    if (!navigationContext || !isNavigator(source)) return null;
    const navigator: Navigator = {
      createHref: source.createHref.bind(source),
      ...(source.encodeLocation
        ? {
            encodeLocation: source.encodeLocation.bind(source),
          }
        : {}),
      go: ignorePreviewNavigation,
      push: ignorePreviewNavigation,
      replace: ignorePreviewNavigation,
    };
    return { ...navigationContext, navigator };
  }, [navigationContext]);
  if (!inertNavigationContext) return null;
  return (
    <UNSAFE_NavigationContext.Provider value={inertNavigationContext}>
      {children}
    </UNSAFE_NavigationContext.Provider>
  );
}

export function isNavigator(value: unknown): value is Navigator {
  if (!value || typeof value !== "object") return false;
  const navigator = value as Partial<Record<keyof Navigator, unknown>>;
  return (
    typeof navigator.createHref === "function" &&
    typeof navigator.go === "function" &&
    typeof navigator.push === "function" &&
    typeof navigator.replace === "function"
  );
}

function WorkspaceRoutes({
  calendarTodaySnap,
  deviceWeatherLocation,
  locationOverride,
  setEditor,
  todayBrief,
  user,
  weather,
}: {
  calendarTodaySnap: number;
  deviceWeatherLocation: DeviceWeatherLocation;
  locationOverride?: string;
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
    <Routes {...(locationOverride ? { location: locationOverride } : {})}>
      <Route
        path="/today"
        element={
          <TodayPage
            brief={todayBrief}
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
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/reviews" element={<ReviewsPage />} />
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/motives" element={<MotivesPage />} />
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
  Profile: UserCircleIcon,
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
  onCalendarToday,
  pageTitle,
  pathname,
  pinned,
  setEditor,
  todayBrief,
  togglePin,
  user,
  weather,
}: {
  onCalendarToday: () => void;
  pageTitle: string | null;
  pathname: string;
  pinned: boolean;
  setEditor: (editor: Editor) => void;
  todayBrief: DailyBrief | undefined;
  togglePin: () => void;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  const workspace = workspaceForLocation(pathname)?.id ?? "account";
  const identity =
    workspace === "calendar" ? (
      <CalendarAppBarIdentity user={user} />
    ) : pathname === "/today" && todayBrief ? (
      <TodayNavigationTitle generatedAt={todayBrief.generatedAt} timeZone={user.planningTimezone} />
    ) : (
      <span className="workspace-app-bar__title">
        {/* Account routes always supply a page title, so the workspace registry
            covers the remaining identities. */}
        {pageTitle ?? workspaceDefinitions.find((item) => item.id === workspace)?.label}
      </span>
    );
  const context =
    workspace === "calendar" ? (
      <CalendarAppBarControls onToday={onCalendarToday} user={user} />
    ) : workspace === "mail" ? (
      <MailTopbarSearch />
    ) : pathname === "/today" ? (
      <TodayWeatherTopbar user={user} weather={weather} />
    ) : pathname === "/activity" ? (
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
          ) : workspace === "calendar" ? (
            <CalendarCreateButton setEditor={setEditor} />
          ) : workspace === "mail" ? (
            <>
              <MailSyncButton />
              <MailComposeButton />
            </>
          ) : workspace === "finances" ? (
            <FinanceAddTransactionButton />
          ) : workspace === "account" ? null : (
            <CreateMenu setEditor={setEditor} />
          )}
        </>
      }
      context={context}
      identity={identity}
      workspace={workspace}
    />
  );
}

function warmWorkspacePreview(queryClient: QueryClient, path: WorkspaceDefinition["path"]) {
  if (path === "/mail") {
    void Promise.all([
      queryClient.prefetchQuery({
        queryFn: api.listConnectors,
        queryKey: ["connectors"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.listMailboxes,
        queryKey: ["mailboxes"],
        staleTime: workspaceIntentStaleTime,
      }),
    ]);
  }
  if (path === "/finances") {
    void Promise.all([
      queryClient.prefetchQuery({
        queryFn: api.getFinanceWealthSummary,
        queryKey: ["finance-wealth"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.getFinanceLedgerHealth,
        queryKey: ["finance-ledger-health"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.getFinanceProfile,
        queryKey: ["finance-profile"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.listFinanceIncomeStreams,
        queryKey: ["finance-income-streams"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.listFinanceRecurringObligations,
        queryKey: ["finance-recurring"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.listFinanceAlerts,
        queryKey: ["finance-alerts"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.getFinanceForecast,
        queryKey: ["finance-forecast"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: () => api.getFinanceBudgetPace("week"),
        queryKey: ["finance-budget-pace", "week"],
        staleTime: workspaceIntentStaleTime,
      }),
      queryClient.prefetchQuery({
        queryFn: api.getFinanceCategories,
        queryKey: ["finance-categories"],
        staleTime: workspaceIntentStaleTime,
      }),
    ]);
  }
}

function WorkspaceSwitcher({
  onNavigate,
  onOpenChange,
  onPreviewChange,
  pathname,
  search,
  user,
  weather: currentWeather,
}: {
  onNavigate: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviewChange: (preview: WorkspacePreview | null) => void;
  pathname: string;
  search: string;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const workspace = workspaceForPath(pathname);
  const section = workspace?.label ?? "Home OS";
  const activeWorkspaceId = workspace ? workspaceIdForPath(workspace.path) : undefined;
  const activeIndex = Math.max(
    0,
    workspaceShortcuts.findIndex((item) => item.path === workspace?.path),
  );
  const previewIndex = useRef(activeIndex);
  const previewPath = useRef<string | null>(workspace?.path ?? null);
  const [indicatorIndex, setIndicatorIndex] = useState(activeIndex);
  const indicatorOffset = workspaceIndicatorOffset(indicatorIndex);
  const calendarEntry = getWorkspaceCalendarEntry(user, search);
  const calendarEvents = useQuery({
    enabled: menuOpen,
    queryFn: () => api.listEvents(calendarEntry.range),
    queryKey: calendarQueryKeys.events(
      calendarEntry.view,
      calendarEntry.range.from,
      calendarEntry.range.to,
    ),
    staleTime: workspaceIntentStaleTime,
  });
  const taskInbox = useQuery({
    enabled: menuOpen,
    queryFn: () => loadAllTaskPages(api.listTasks, { lifecycle: "open" }),
    queryKey: ["tasks", "open", "all"],
    staleTime: workspaceIntentStaleTime,
  });
  const mailThreads = useQuery({
    enabled: menuOpen,
    queryFn: () => api.listMailThreads({}),
    queryKey: ["mail-threads", null, null, "", false],
    staleTime: workspaceIntentStaleTime,
  });
  const financeMonth = new Date().toISOString().slice(0, 7);
  const finances = useQuery({
    enabled: menuOpen,
    queryFn: api.getFinanceOverview,
    queryKey: ["finance-overview", financeMonth],
    staleTime: workspaceIntentStaleTime,
  });
  const workspaceSummaries: Record<string, string> = {
    "/calendar": workspaceCalendarSummary(calendarEvents.data, user),
    "/finances": workspaceFinanceSummary(finances.data),
    "/mail": workspaceCountSummary(
      mailThreads.data?.filter((thread) => thread.unread).length,
      "unread",
      "Inbox clear",
    ),
    "/tasks": workspaceCountSummary(taskInbox.data?.items.length, "open", "All done", "open"),
    "/today": workspaceTodaySummary(currentWeather, user.homeLocation?.label),
  };

  useEffect(() => {
    previewIndex.current = activeIndex;
    previewPath.current = pathname;
    setIndicatorIndex(activeIndex);
  }, [activeIndex, pathname]);

  const preview = (item: WorkspaceDefinition, index: number) => {
    if (previewPath.current === item.path) return;
    warmWorkspacePreview(queryClient, item.path);
    const direction = index >= previewIndex.current ? "down" : "up";
    previewIndex.current = index;
    previewPath.current = item.path;
    setIndicatorIndex(index);
    startTransition(() => {
      onPreviewChange({ direction, path: item.path });
    });
  };

  return (
    <ShadcnSidebarMenu>
      <ShadcnSidebarMenuItem>
        <DropdownMenu
          onOpenChange={(open) => {
            setMenuOpen(open);
            onOpenChange(open);
            if (open) {
              previewIndex.current = activeIndex;
              // Track the committed route, not the workspace default, so a
              // child route such as /goals can still preview its own
              // workspace's default surface.
              previewPath.current = pathname;
              setIndicatorIndex(activeIndex);
            } else {
              onPreviewChange(null);
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <ShadcnButton
              aria-label="Switch workspace"
              className="sidebar__workspace-trigger w-full justify-start"
              variant="secondary"
            >
              {activeWorkspaceId ? (
                <WorkspaceIcon size="sm" workspace={activeWorkspaceId} />
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
            className="workspace-switcher__menu w-[--radix-popper-anchor-width]"
            style={
              {
                "--workspace-indicator-y": `${indicatorOffset}px`,
              } as CSSProperties
            }
          >
            <span aria-hidden="true" className="workspace-switcher__indicator" />
            <DropdownMenuGroup>
              <WorkspaceMenuItem
                index={0}
                item={workspaceShortcuts[0] as WorkspaceDefinition}
                onNavigate={onNavigate}
                onPreview={preview}
                pathname={pathname}
                summary={workspaceSummaries["/today"] as string}
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {workspaceShortcuts.slice(1).map((item) => (
                <WorkspaceMenuItem
                  index={workspaceShortcuts.indexOf(item)}
                  item={item}
                  key={item.path}
                  onNavigate={onNavigate}
                  onPreview={preview}
                  pathname={pathname}
                  summary={workspaceSummaries[item.path] as string}
                />
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ShadcnSidebarMenuItem>
    </ShadcnSidebarMenu>
  );
}

function WorkspaceMenuItem({
  index,
  item,
  onNavigate,
  onPreview,
  pathname,
  summary,
}: {
  index: number;
  item: WorkspaceDefinition;
  onNavigate: () => void;
  onPreview: (item: WorkspaceDefinition, index: number) => void;
  pathname: string;
  summary: string;
}) {
  const { icon: Icon, label, path } = item;
  const isActive = workspaceForPath(pathname)?.path === path;
  const workspaceId = workspaceIdForPath(path);
  const summaryId = `workspace-switcher-summary-${path.slice(1)}`;
  return (
    <DropdownMenuItem asChild className="workspace-switcher__item" data-active={isActive}>
      <Link
        aria-current={isActive ? "page" : undefined}
        aria-describedby={summaryId}
        aria-label={label}
        onClick={onNavigate}
        onFocus={() => onPreview(item, index)}
        onPointerMove={() => onPreview(item, index)}
        to={path}
      >
        {workspaceId ? (
          <WorkspaceIcon size="sm" workspace={workspaceId} />
        ) : (
          <Icon aria-hidden="true" />
        )}
        <span className="workspace-switcher__copy">
          <span>{label}</span>
          <small id={summaryId}>{summary}</small>
        </span>
        {isActive ? <CheckIcon aria-hidden="true" className="ml-auto" /> : null}
      </Link>
    </DropdownMenuItem>
  );
}

function AccountMenu({ onNavigate, user }: { onNavigate: () => void; user: User }) {
  const queryClient = useQueryClient();
  const accountName = user.displayName.trim() || user.email;
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/");
    },
  });

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton
                aria-label="Account menu"
                className="size-8 shrink-0"
                size="icon"
                variant="ghost"
              >
                <SettingsIcon aria-hidden="true" />
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" side="top">
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

function CalendarCreateButton({ setEditor }: { setEditor: (editor: Editor) => void }) {
  return (
    <ShadcnButton aria-label="New event" onClick={() => setEditor({ kind: "event" })} size="sm">
      <CalendarPlusIcon aria-hidden="true" data-icon="inline-start" />
      <span>New event</span>
    </ShadcnButton>
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

function TodayPage({
  brief,
  deviceWeatherLocation,
  setEditor,
  user,
  weather,
}: {
  brief: Pick<UseQueryResult<DailyBrief>, "data" | "error" | "isError" | "isPending">;
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
  return (
    <div className="today-layout" data-page="today">
      <section className="day-column">
        <TodayConditions
          deviceWeatherLocation={deviceWeatherLocation}
          savedLocation={user.homeLocation}
          weather={weather}
        />
        <ShadcnCard aria-label="Current commitment" className="today-moment-block">
          <ShadcnCardHeader>
            <ShadcnCardTitle>
              <h2>{agenda.now.length > 0 ? "Happening now" : "Next commitment"}</h2>
            </ShadcnCardTitle>
            <ShadcnCardAction>
              <ShadcnBadge variant="secondary">
                {formatTime(currentTime.toISOString(), user.planningTimezone)}
              </ShadcnBadge>
            </ShadcnCardAction>
          </ShadcnCardHeader>
          <ShadcnCardContent className="today-moment-block__content">
            {agenda.now.length > 0 ? (
              <>
                {agenda.now.map((event) => (
                  <TodayEventCard
                    currentTime={currentTime}
                    event={event}
                    key={event.id}
                    onEdit={() => setEditor({ event, kind: "event" })}
                    timeZone={user.planningTimezone}
                  />
                ))}
                {agenda.next ? (
                  <div className="today-moment-block__then">
                    <p className="eyebrow">Up next</p>
                    <TodayEventCard
                      event={agenda.next}
                      onEdit={() =>
                        setEditor({ event: agenda.next as CalendarEvent, kind: "event" })
                      }
                      timeZone={user.planningTimezone}
                    />
                  </div>
                ) : null}
              </>
            ) : agenda.next ? (
              <TodayEventCard
                event={agenda.next}
                onEdit={() => setEditor({ event: agenda.next as CalendarEvent, kind: "event" })}
                timeZone={user.planningTimezone}
              />
            ) : (
              <EmptyState icon={<CalendarIcon />} title="The day is open">
                Leave it spacious or add a block when it matters.
              </EmptyState>
            )}
          </ShadcnCardContent>
        </ShadcnCard>
        <section aria-label="Day flow" className="today-sequence">
          <div className="section-heading">
            <div>
              <h2>Later today</h2>
            </div>
          </div>
          {agenda.allDay.length > 0 ? (
            <div className="today-all-day">
              <p className="eyebrow">All day</p>
              {agenda.allDay.map((event) => (
                <TodayEventCard
                  event={event}
                  key={event.id}
                  onEdit={() => setEditor({ event, kind: "event" })}
                  timeZone={user.planningTimezone}
                />
              ))}
            </div>
          ) : null}
          {agenda.laterToday.filter((event) => event.id !== agenda.next?.id).length > 0 ? (
            agenda.laterToday
              .filter((event) => event.id !== agenda.next?.id)
              .map((event) => (
                <TodayEventCard
                  event={event}
                  key={event.id}
                  onEdit={() => setEditor({ event, kind: "event" })}
                  timeZone={user.planningTimezone}
                />
              ))
          ) : (
            <p className="today-sequence__empty">Nothing else is fixed on the calendar.</p>
          )}
        </section>
      </section>
      <aside aria-labelledby="today-queue-title" className="today-queue">
        <div className="section-heading">
          <div>
            <h2 id="today-queue-title">Your commitments</h2>
            <p className="today-queue__summary">
              {agenda.capacity.overcommitted
                ? `No free time before ${formatTime(agenda.capacity.workdayEndsAt, user.planningTimezone)}.`
                : `${formatMinutes(agenda.capacity.availableMinutes)} free until ${formatTime(
                    agenda.capacity.workdayEndsAt,
                    user.planningTimezone,
                  )}`}
            </p>
          </div>
          <ShadcnBadge variant="secondary">{remainingCount}</ShadcnBadge>
        </div>
        {overdueReminders.length > 0 && (
          <ReminderGroup
            label="Overdue"
            reminders={overdueReminders}
            setEditor={setEditor}
            timeZone={user.planningTimezone}
          />
        )}
        {todayReminders.length > 0 ? (
          <ReminderGroup
            label="Today"
            reminders={todayReminders}
            setEditor={setEditor}
            timeZone={user.planningTimezone}
          />
        ) : (
          overdueReminders.length === 0 &&
          overdueTasks.length === 0 &&
          todayTasks.length === 0 && (
            <EmptyState icon={<CircleCheckIcon />} title="Nothing pulling at you">
              Add a reminder when something deserves your attention.
            </EmptyState>
          )
        )}
        {anytimeReminders.length > 0 ? (
          <ReminderGroup
            label="No due date"
            reminders={anytimeReminders}
            setEditor={setEditor}
            timeZone={user.planningTimezone}
          />
        ) : null}
        {overdueTasks.length > 0 ? (
          <TaskGroup
            label="Overdue tasks"
            recommendations={recommendedTasks}
            setEditor={setEditor}
            tasks={overdueTasks}
            timeZone={user.planningTimezone}
          />
        ) : null}
        {todayTasks.length > 0 ? (
          <TaskGroup
            label="Today tasks"
            recommendations={recommendedTasks}
            setEditor={setEditor}
            tasks={todayTasks}
            timeZone={user.planningTimezone}
          />
        ) : null}
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
        : "Allow device location or add a saved location in Profile.";
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
  user,
  weather,
}: {
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  if (!weather) return null;
  const WeatherIcon = weather.alerts.some((alert) => alert.kind === "rain")
    ? CloudRainIcon
    : weather.condition.includes("Clear")
      ? SunIcon
      : CloudIcon;
  const temperature = `${Math.round(weather.temperatureF)}°F`;
  const alertDescription =
    weather.alerts.length > 0 ? weather.alerts.map((alert) => alert.label).join(" · ") : null;
  return (
    <fieldset aria-label="Today conditions" className="workspace-app-bar__weather">
      <TodayWeatherPopover
        content={
          <WeatherConditionsPopoverContent
            alertDescription={alertDescription}
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
  planningTimezone,
  weather,
  WeatherIcon,
}: {
  alertDescription: string | null;
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
            <dd>{formatTime(weather.observedAt, planningTimezone)}</dd>
          </div>
          <div>
            <dt>Air quality</dt>
            <dd>{weather.usAqi === null ? "Unavailable" : `AQI ${weather.usAqi}`}</dd>
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

function WeatherLocationPopoverContent({ weather }: { weather: WeatherSnapshot }) {
  const { coordinates, label, mapUrl, source } = weather.location;
  return (
    <>
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
      <div className="weather-location-popover__details">
        <strong>{label}</strong>
        <span>{source === "device" ? "Using this device" : "Home location"}</span>
        <span>{formatWeatherCoordinates(coordinates)}</span>
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
  if (pathname === "/settings") return "Settings";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<CalendarDropPreview | null>(null);
  const requestedView = searchParams.get("view");
  const defaultView: CalendarView =
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 560px)").matches
      ? "day"
      : "week";
  const view = calendarViewFromSearch(requestedView, defaultView);
  const includeWeekends = searchParams.get("weekends") !== "0";
  const requestedAnchor = searchParams.get("date");
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
  const calendarsById = useMemo(
    () => new Map((calendars.data ?? []).map((calendar) => [calendar.id, calendar])),
    [calendars.data],
  );
  const moveEvent = useMutation({
    mutationFn: async (input: CalendarEventMove) => {
      const times = movedEventTimes(input.event, input.day, input.minute, user.planningTimezone);
      return api.updateEvent(input.event.id, times);
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      for (const [key, data] of context.snapshots) {
        queryClient.setQueryData(key, data);
      }
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
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const showDay = (day: LocalDate) => {
    updateCalendarState({ date: localDateToIso(day), view: "day" });
  };
  const dropEvent = (event: CalendarEvent, day: LocalDate, minute: number) => {
    if (calendarsById.get(event.calendarId)?.isWritable) {
      moveEvent.mutate({ day, event, minute });
    }
    setDraggedEventId(null);
    setDragPreview(null);
  };
  const clearDrag = () => {
    setDraggedEventId(null);
    setDragPreview(null);
  };

  return (
    <div className="calendar-page">
      {moveEvent.isError ? <InlineError error={moveEvent.error} /> : null}
      <ConnectionRecoveryAlert
        accounts={(connectorAccounts.data ?? []).filter((account) => account.calendarEnabled)}
      />
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
          setEditor={setEditor}
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
          setEditor={setEditor}
          setDraggedEventId={setDraggedEventId}
          setDragPreview={setDragPreview}
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
          setEditor={setEditor}
          setDraggedEventId={setDraggedEventId}
          showDay={showDay}
          key={localDateKey(anchor)}
          timeZone={user.planningTimezone}
          today={today}
          todaySnap={todaySnap}
        />
      )}
    </div>
  );
}

function CalendarAppBarIdentity({ user }: { user: User }) {
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
  const viewLabel = calendarViews.find((option) => option.value === view)?.label ?? view;
  const title =
    view === "day"
      ? formatLocalDate(start, { day: "numeric", month: "long", weekday: "long", year: "numeric" })
      : view === "week"
        ? calendarOrientationWeekTitle(start, end)
        : formatLocalDate(anchor, { month: "long", year: "numeric" });

  return (
    <div className="calendar-app-bar__orientation">
      <div>
        <span>{viewLabel}</span>
        <h2>{title}</h2>
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
  const includeWeekends = searchParams.get("weekends") !== "0";
  const updateCalendarState = (updates: Record<string, null | string>) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  return (
    <fieldset className="calendar-app-bar__controls">
      <legend className="sr-only">Calendar controls</legend>
      <div className="calendar-app-bar__control-set">
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="bottom">Return to today</TooltipContent>
        </Tooltip>
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
        {view === "week" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ShadcnButton
                aria-label="Weekends"
                aria-pressed={includeWeekends}
                className="calendar-app-bar__weekends"
                onClick={() => updateCalendarState({ weekends: includeWeekends ? "0" : null })}
                size="icon"
                variant={includeWeekends ? "secondary" : "ghost"}
              >
                {includeWeekends ? (
                  <EyeIcon aria-hidden="true" />
                ) : (
                  <EyeOffIcon aria-hidden="true" />
                )}
              </ShadcnButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {includeWeekends ? "Hide weekends" : "Show weekends"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </fieldset>
  );
}

function CalendarSidebar({ user }: { user: User }) {
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });

  return (
    <div className="calendar-sidebar">
      <CalendarSidebarDatePicker user={user} />
      <CalendarVisibilitySidebar accounts={accounts.data ?? []} calendars={calendars.data ?? []} />
    </div>
  );
}

function CalendarSidebarDatePicker({ user }: { user: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const selectedDate = calendarDate(anchor);
  const weekStart = startOfLocalWeek(anchor);
  const weekEnd = addLocalDays(weekStart, 6);
  const setAnchor = (nextAnchor: LocalDate) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("date", localDateToIso(nextAnchor));
      return next;
    });
  const setMonth = (month: number) => {
    const daysInMonth = new Date(Date.UTC(anchor.year, month, 0)).getUTCDate();
    setAnchor({ ...anchor, day: Math.min(anchor.day, daysInMonth), month });
  };
  const setYear = (year: number) => {
    const daysInMonth = new Date(Date.UTC(year, anchor.month, 0)).getUTCDate();
    setAnchor({ ...anchor, day: Math.min(anchor.day, daysInMonth), year });
  };

  return (
    <section
      aria-label="Calendar date picker"
      className="context-sidebar__section context-sidebar__date-picker"
    >
      <ShadcnCalendar
        className="[--cell-size:--spacing(5)]"
        classNames={{
          day: "group/day relative h-6 w-full rounded-(--cell-radius) p-0 text-center select-none",
          day_button: "aspect-auto h-6 min-w-0 text-xs",
          month: "flex w-full flex-col gap-2",
          month_caption:
            "relative z-10 flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          week: "mt-0 flex w-full",
          weekday:
            "flex h-4 flex-1 items-center justify-center rounded-(--cell-radius) text-[0.6875rem] font-normal text-muted-foreground select-none",
        }}
        components={{
          CaptionLabel: () => (
            <CalendarSidebarCaption
              month={anchor.month}
              onMonthChange={setMonth}
              onYearChange={setYear}
              year={anchor.year}
            />
          ),
        }}
        mode="single"
        modifiers={{ selectedWeek: { from: calendarDate(weekStart), to: calendarDate(weekEnd) } }}
        modifiersClassNames={{
          selectedWeek:
            "rounded-none bg-secondary text-secondary-foreground first:rounded-s-(--cell-radius) last:rounded-e-(--cell-radius)",
        }}
        month={selectedDate}
        onMonthChange={(month) => {
          const nextMonth = localDateAt(month, user.planningTimezone);
          const daysInMonth = new Date(Date.UTC(nextMonth.year, nextMonth.month, 0)).getUTCDate();
          setAnchor({ ...nextMonth, day: Math.min(anchor.day, daysInMonth) });
        }}
        onSelect={(date) => {
          if (date) setAnchor(localDateAt(date, user.planningTimezone));
        }}
        selected={selectedDate}
        timeZone={user.planningTimezone}
      />
    </section>
  );
}

function CalendarSidebarCaption({
  month,
  onMonthChange,
  onYearChange,
  year,
}: {
  month: number;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  year: number;
}) {
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
  });
  return (
    <div className="calendar-sidebar__caption">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ShadcnButton aria-label="Choose the month" size="sm" variant="ghost">
            {monthName}
          </ShadcnButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Select month</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <DropdownMenuItem key={value} onSelect={() => onMonthChange(value)}>
                {new Date(Date.UTC(year, value - 1, 1)).toLocaleString("en-US", {
                  month: "long",
                })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ShadcnButton aria-label="Choose the year" size="sm" variant="ghost">
            {year}
          </ShadcnButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Select year</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {Array.from({ length: 11 }, (_, index) => year - 5 + index).map((value) => (
              <DropdownMenuItem key={value} onSelect={() => onYearChange(value)}>
                {value}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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

function CalendarVisibilitySidebar({
  accounts,
  calendars,
}: {
  accounts: CalendarAccount[];
  calendars: Calendar[];
}) {
  const [toggleError, setToggleError] = useState<unknown>(null);
  const calendarGroups = groupCalendarsByAccount(accounts, calendars);
  return (
    <section className="context-sidebar__calendar-visibility" aria-label="Calendars">
      {calendars.length === 0 ? (
        <div className="context-sidebar__calendar-scroll-content">
          <ShadcnSidebarGroupLabel>Calendars 0/0</ShadcnSidebarGroupLabel>
          <p className="context-sidebar__empty">No calendars are available.</p>
        </div>
      ) : (
        <ShadcnScrollArea className="context-sidebar__calendar-scroll">
          <div className="context-sidebar__calendar-scroll-content">
            <ShadcnSidebarGroupLabel>
              Calendars {calendars.filter((calendar) => calendar.isSelected).length}/
              {calendars.length}
            </ShadcnSidebarGroupLabel>
            <ShadcnSidebarMenu className="context-sidebar__calendar-groups">
              {calendarGroups.map((group) => (
                <ShadcnCollapsible
                  asChild
                  className="group/calendar-account"
                  defaultOpen
                  key={group.accountId}
                >
                  <ShadcnSidebarMenuItem className="context-sidebar__calendar-account">
                    <ShadcnCollapsibleTrigger asChild>
                      <ShadcnSidebarMenuButton
                        aria-label={`Toggle ${group.label} calendars`}
                        className="context-sidebar__calendar-account-trigger px-0 hover:!bg-transparent hover:!text-sidebar-foreground active:!bg-transparent active:!text-sidebar-foreground data-[state=open]:!bg-transparent data-[state=open]:!text-sidebar-foreground data-[state=open]:hover:!bg-transparent data-[state=open]:hover:!text-sidebar-foreground"
                      >
                        <ConnectedAccountIdentity
                          avatarUrl={group.account?.avatarUrl}
                          label={group.label}
                          provider={group.provider}
                        />
                        <span className="context-sidebar__calendar-account-copy truncate">
                          <span className="context-sidebar__calendar-account-name truncate">
                            {group.label}
                          </span>
                          {group.account?.email && group.account.email !== group.label ? (
                            <span className="context-sidebar__calendar-account-email truncate">
                              {group.account.email}
                            </span>
                          ) : null}
                        </span>
                        <span className="context-sidebar__calendar-count ml-auto shrink-0 text-xs tabular-nums">
                          {group.calendars.filter((calendar) => calendar.isSelected).length}/
                          {group.calendars.length}
                        </span>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="transition-transform group-data-[state=closed]/calendar-account:-rotate-90"
                          data-icon="inline-end"
                        />
                      </ShadcnSidebarMenuButton>
                    </ShadcnCollapsibleTrigger>
                    <ShadcnCollapsibleContent>
                      <ShadcnSidebarMenuSub className="context-sidebar__calendar-list">
                        {group.calendars.map((calendar) => (
                          <ShadcnSidebarMenuSubItem key={calendar.id}>
                            <CalendarVisibilityToggle
                              calendar={calendar}
                              setError={setToggleError}
                            />
                          </ShadcnSidebarMenuSubItem>
                        ))}
                      </ShadcnSidebarMenuSub>
                    </ShadcnCollapsibleContent>
                  </ShadcnSidebarMenuItem>
                </ShadcnCollapsible>
              ))}
            </ShadcnSidebarMenu>
            {toggleError ? (
              <p className="context-sidebar__error" role="alert">
                {errorMessage(toggleError)}
              </p>
            ) : null}
          </div>
        </ShadcnScrollArea>
      )}
    </section>
  );
}

function CalendarVisibilityToggle({
  calendar,
  setError,
}: {
  calendar: Calendar;
  setError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<Calendar, Error, boolean, { previousSelected: boolean }>({
    mutationFn: (selected) => api.setCalendarSelected(calendar.id, selected),
    onError: (error, _selected, context) => {
      queryClient.setQueryData<Calendar[]>(["calendars"], (records) =>
        records?.map((record) =>
          record.id === calendar.id && context
            ? { ...record, isSelected: context.previousSelected }
            : record,
        ),
      );
      setError(error);
    },
    onMutate: async (selected) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ["calendars"] });
      queryClient.setQueryData<Calendar[]>(["calendars"], (records) =>
        records?.map((record) =>
          record.id === calendar.id ? { ...record, isSelected: selected } : record,
        ),
      );
      return { previousSelected: calendar.isSelected };
    },
    onSettled: () => invalidateMaterial(queryClient),
  });
  return (
    <ShadcnField className="context-sidebar__calendar" orientation="horizontal">
      <ShadcnCheckbox
        checked={calendar.isSelected}
        className="data-checked:border-(--calendar-color) data-checked:bg-(--calendar-color)"
        disabled={mutation.isPending}
        id={`calendar-${calendar.id}`}
        onCheckedChange={(checked) => mutation.mutate(checked === true)}
        style={
          {
            "--calendar-color": calendar.color ?? "var(--sidebar-primary)",
          } as CSSProperties
        }
      />
      <ShadcnFieldLabel htmlFor={`calendar-${calendar.id}`}>
        <span>{calendar.name}</span>
        {!calendar.isWritable ? (
          <ExternalLinkIcon
            aria-label="Subscribed calendar"
            className="context-sidebar__calendar-external"
            role="img"
          />
        ) : null}
      </ShadcnFieldLabel>
    </ShadcnField>
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
  const [contextMinute, setContextMinute] = useState(0);
  useEffect(() => {
    if (!isToday) scrollTimelineToMinute(scrollContainer.current, 8 * 60);
  }, [isToday]);
  useEffect(() => {
    if (!isToday || !followToday) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
  }, [currentTime, followToday, isToday, timeZone]);
  useEffect(() => {
    if (!isToday || !followToday || todaySnap === 0) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
  }, [currentTime, followToday, isToday, timeZone, todaySnap]);
  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!followToday) return;
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
          <AllDayEvents events={allDayEvents} setEditor={setEditor} />
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
                  previewTimelineDrop(dragEvent, day, events, draggedEventId, setDragPreview)
                }
                onDrop={(dragEvent) =>
                  dropTimelineEvent(dragEvent, day, events, moveEvent, setDraggedEventId)
                }
                style={{ height: calendarTimelineHeight }}
              >
                {dragPreview?.dayKey === localDateKey(day) ? (
                  <CalendarDropPreview preview={dragPreview} />
                ) : null}
                {isToday ? <TimelineNow currentTime={currentTime} timeZone={timeZone} /> : null}
                {timelineEvents.length === 0 ? (
                  <span className="calendar-timeline-empty">This day is open</span>
                ) : null}
                {timelineEvents.map((layout) => (
                  <TimelineEvent
                    calendar={calendarsById.get(layout.event.calendarId)}
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
              setEditor={setEditor}
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
  onExitFollow,
  setEditor,
  setDraggedEventId,
  setDragPreview,
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
  onExitFollow: () => void;
  setEditor: (editor: Editor) => void;
  setDraggedEventId: (id: string | null) => void;
  setDragPreview: (preview: CalendarDropPreview | null) => void;
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
  const scrollContainer = useRef<HTMLDivElement>(null);
  const includesToday = days.some((day) => sameLocalDate(day, today));
  useEffect(() => {
    if (!includesToday) scrollTimelineToMinute(scrollContainer.current, 8 * 60);
  }, [includesToday]);
  useEffect(() => {
    if (!includesToday || !followToday) return;
    scrollTimelineToMinute(scrollContainer.current, localDateTimeAt(currentTime, timeZone).minute);
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
  }, [followToday, includesToday, timeZone, todaySnap]);
  const handleScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!followToday) return;
    const container = event.currentTarget;
    const verticalTarget = Math.max(
      0,
      minuteToTimelinePixels(localDateTimeAt(currentTime, timeZone).minute) -
        container.clientHeight / 2,
    );
    const todayButton = container.querySelector<HTMLElement>(
      'button[aria-current="date"]',
    ) as HTMLElement;
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
                  <AllDayEvents compact events={allDayEvents} setEditor={setEditor} />
                </header>
              );
            })}
          </WorkspaceSecondaryAppBarContent>
        </WorkspaceSecondaryAppBar>
        <TimeAxis />
        {days.map((day) => {
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
                  Array.from(eventsByDay.values()).flat(),
                  draggedEventId,
                  setDragPreview,
                )
              }
              onDrop={(dragEvent) =>
                dropTimelineEvent(
                  dragEvent,
                  day,
                  Array.from(eventsByDay.values()).flat(),
                  moveEvent,
                  setDraggedEventId,
                )
              }
              style={{ height: calendarTimelineHeight }}
            >
              {dragPreview?.dayKey === localDateKey(day) ? (
                <CalendarDropPreview preview={dragPreview} />
              ) : null}
              {isToday ? <TimelineNow currentTime={currentTime} timeZone={timeZone} /> : null}
              {layouts.length === 0 ? <span className="calendar-timeline-empty">Open</span> : null}
              {layouts.map((layout) => (
                <TimelineEvent
                  calendar={calendarsById.get(layout.event.calendarId)}
                  compact
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

type TimelineEventLayout = {
  column: number;
  columns: number;
  endMinute: number;
  event: CalendarEvent;
  startMinute: number;
};

function TimeAxis() {
  return (
    <ol
      aria-hidden="true"
      className="calendar-time-axis"
      style={{ height: calendarTimelineHeight }}
    >
      {calendarHours.map((hour) => (
        <li key={hour} style={{ top: minuteToTimelinePixels(hour * 60) }}>
          {formatHour(hour)}
        </li>
      ))}
    </ol>
  );
}

function TimelineNow({ currentTime, timeZone }: { currentTime: Date; timeZone: string }) {
  return (
    <div
      aria-label={`Current time ${formatTime(currentTime.toISOString(), timeZone)}`}
      className="calendar-now-line"
      role="timer"
      style={{ top: minuteToTimelinePixels(localDateTimeAt(currentTime, timeZone).minute) }}
    >
      <span>
        <strong>Now</strong>
        {formatTime(currentTime.toISOString(), timeZone)}
      </span>
      <i />
    </div>
  );
}

function CalendarDropPreview({ preview }: { preview: CalendarDropPreview }) {
  return (
    <div
      aria-live="polite"
      className="calendar-drop-preview"
      role="status"
      style={{
        height: Math.max(minuteToTimelinePixels(preview.duration), 18),
        top: minuteToTimelinePixels(preview.minute),
      }}
    >
      Drop at {formatHour(Math.floor(preview.minute / 60))}
    </div>
  );
}

function TimelineEvent({
  calendar,
  compact = false,
  layout,
  onEdit,
  onDragEnd,
  setDraggedEventId,
  timeZone,
}: {
  calendar: Calendar | undefined;
  compact?: boolean;
  layout: TimelineEventLayout;
  onEdit: () => void;
  onDragEnd: () => void;
  setDraggedEventId: (id: string | null) => void;
  timeZone: string;
}) {
  const { column, columns, endMinute, event, startMinute } = layout;
  const writable = calendar?.isWritable ?? false;
  return (
    <CalendarEventContextMenu calendar={calendar} event={event} timeZone={timeZone}>
      <button
        aria-label={`${formatTime(event.startsAt, timeZone)} ${event.title}`}
        className={`calendar-timeline-event${compact ? " calendar-timeline-event--compact" : ""}${writable ? " is-draggable" : ""}`}
        draggable={writable}
        onDragEnd={onDragEnd}
        onDragStart={(dragEvent) => startCalendarDrag(dragEvent, event, setDraggedEventId)}
        onClick={onEdit}
        style={{
          borderLeftColor: calendar?.color ?? "#777ce3",
          height: Math.max(minuteToTimelinePixels(endMinute - startMinute), 18),
          left: `calc(${(column / columns) * 100}% + 3px)`,
          top: minuteToTimelinePixels(startMinute),
          width: `calc(${100 / columns}% - 6px)`,
        }}
        title={writable ? "Drag to reschedule · Open for precise editing" : "Read-only calendar"}
        type="button"
      >
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
  setEditor,
  timeZone,
}: {
  day: LocalDate;
  minute: number;
  setEditor: (editor: Editor) => void;
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
      if (!event) throw new Error("Copy an event from ilo before pasting it here.");
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
      <ContextMenuItem onSelect={() => setEditor({ draft: { endsAt, startsAt }, kind: "event" })}>
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
  calendar,
  children,
  event,
  timeZone,
}: {
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
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
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
  compact = false,
  events,
  setEditor,
}: {
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
                    className={`month-event${calendarsById.get(event.calendarId)?.isWritable ? " is-draggable" : ""}`}
                    draggable={calendarsById.get(event.calendarId)?.isWritable ?? false}
                    key={event.id}
                    onDragEnd={clearDrag}
                    onDragStart={(dragEvent) =>
                      startCalendarDrag(dragEvent, event, setDraggedEventId)
                    }
                    onClick={() => setEditor({ event, kind: "event" })}
                    type="button"
                  >
                    <i
                      style={{
                        background: calendarsById.get(event.calendarId)?.color ?? "#777ce3",
                      }}
                    />
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
  | "agent-connections"
  | "appearance"
  | "calendar"
  | "connections"
  | "finances"
  | "invitations"
  | "mail"
  | "profile"
  | "sessions"
  | "tasks"
  | "wallpaper"
  | "workspace-access";

const settingsNavigation: Array<{
  items: Array<{ icon: Icon; id: SettingsSectionId; label: string }>;
  label: string;
}> = [
  {
    label: "Personal",
    items: [
      { icon: UserIcon, id: "profile", label: "Profile" },
      { icon: PaintBrushIcon, id: "appearance", label: "Appearance" },
      { icon: ImageIcon, id: "wallpaper", label: "Wallpaper" },
    ],
  },
  {
    label: "Security",
    items: [
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

/** One permission rule for every surface that lists account sections. */
function visibleSettingsNavigation(canManageInvitations: boolean) {
  return settingsNavigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== "invitations" || canManageInvitations),
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
        {section === "appearance" ? <ThemeSettings user={user} /> : null}
        {section === "profile" ? <ProfileSettings user={user} /> : null}
        {section === "invitations" ? <InvitationsSettings /> : null}
        {section === "sessions" ? <SessionsSettings /> : null}
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
                          ? "ilo calendar"
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
    throw new Error("Pinterest wallpaper is available in the ilo desktop app.");
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
  return isTauri() ? (
    <PinterestWallpaperDesktopSettingsPanel />
  ) : (
    <PinterestWallpaperWebPlaceholder />
  );
}

function PinterestWallpaperWebPlaceholder() {
  return (
    <SettingsSection
      description="Pinterest wallpapers are created and applied from ilo for macOS."
      title="Pinterest wallpaper"
    >
      <ShadcnAlert role="status" variant="info">
        <ImageIcon />
        <ShadcnAlertTitle>Available in ilo for macOS</ShadcnAlertTitle>
        <ShadcnAlertDescription>
          Open the desktop app to choose a public Pinterest board and refine the wallpaper.
        </ShadcnAlertDescription>
      </ShadcnAlert>
    </SettingsSection>
  );
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
      description="Paste a public board URL and ilo will compose a fresh tiled collage from its Pins each day."
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
            The board must be public. If Pinterest only exposes a few Pins, ilo repeats them to
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
              A new collage is applied at 8:00 AM while ilo is running, and catches up when you next
              open it.
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
      title="Profile"
    >
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
              Confirm this address to keep account recovery available and unlock connected accounts.
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
            <ShadcnFieldLabel htmlFor="profile-workday-start">Planning day starts</ShadcnFieldLabel>
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
      description="Devices with an active sign-in to your ilo account. Revoke access you no longer recognize."
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
  recommendations,
  setEditor,
  tasks,
  timeZone,
}: {
  label: string;
  recommendations?: Map<string, DailyBrief["recommendedTasks"][number]>;
  setEditor: (editor: Editor) => void;
  tasks: Task[];
  timeZone: string;
}) {
  return (
    <section className="reminder-group">
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
  currentTime,
  event,
  onEdit,
  timeZone,
}: {
  currentTime?: Date;
  event: CalendarEvent;
  onEdit: () => void;
  timeZone: string;
}) {
  const eventLabel = `${event.allDay ? "All day" : formatTime(event.startsAt, timeZone)} ${event.title}`;
  const isInProgress =
    currentTime !== undefined &&
    !event.allDay &&
    new Date(event.startsAt).getTime() <= currentTime.getTime() &&
    currentTime.getTime() < new Date(event.endsAt).getTime();
  const conferenceProvider = event.conferenceUrl
    ? conferenceProviderLabel(event.conferenceUrl)
    : null;
  return (
    <EventCard>
      <EventCardContent>
        <EventCardTime>
          {event.allDay ? "All day" : formatTime(event.startsAt, timeZone)}
        </EventCardTime>
        <EventCardIndicator />
        <EventCardPrimaryAction aria-label={`${eventLabel}. Open details`} onClick={onEdit}>
          <EventCardBody>
            <EventCardTitle>
              <span className="truncate">{event.title}</span>
              {event.blocks.length > 0 ? <LockIcon aria-label="Blocks another calendar" /> : null}
            </EventCardTitle>
            <EventCardDescription>
              {event.location ? (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPinIcon aria-hidden="true" />
                  <span className="truncate">{event.location}</span>
                </span>
              ) : (
                `${formatTime(event.startsAt, timeZone)}–${formatTime(event.endsAt, timeZone)}`
              )}
            </EventCardDescription>
          </EventCardBody>
        </EventCardPrimaryAction>
        {event.provider.toLowerCase() !== "local" ? (
          <EventCardAside>
            <ConnectedServiceMark provider={event.provider} />
          </EventCardAside>
        ) : null}
      </EventCardContent>
      {isInProgress ? (
        <EventCardFooter>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ShadcnBadge variant="outline">
              <ClockIcon aria-hidden="true" data-icon="inline-start" /> In progress
            </ShadcnBadge>
            <span className="font-mono text-xs text-muted-foreground">
              {meetingTimingSummary(event, currentTime)}
            </span>
          </div>
          {event.conferenceUrl ? (
            <ShadcnButton asChild size="sm">
              <a href={event.conferenceUrl} rel="noreferrer" target="_blank">
                Join {conferenceProvider}
                <ExternalLinkIcon aria-hidden="true" data-icon="inline-end" />
              </a>
            </ShadcnButton>
          ) : null}
        </EventCardFooter>
      ) : null}
    </EventCard>
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
  user,
}: {
  calendars: Calendar[];
  close: () => void;
  edit: () => void;
  event: CalendarEvent;
  user: User;
}) {
  const queryClient = useQueryClient();
  const sheetRef = useRef<HTMLElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blocks, setBlocks] = useState(event.blocks);
  const calendar = calendars.find((record) => record.id === event.calendarId);
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
  useDialogFocus(sheetRef);
  return (
    <div className="event-sheet-backdrop">
      <button
        aria-label="Close event details"
        className="event-sheet-dismiss"
        onClick={close}
        type="button"
      />
      <aside
        aria-labelledby="event-sheet-title"
        aria-modal="true"
        className="event-sheet"
        ref={sheetRef}
        role="dialog"
        tabIndex={-1}
      >
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
            <p className="eyebrow">{event.allDay ? "All-day event" : "Scheduled event"}</p>
            <h2 id="event-sheet-title">{event.title}</h2>
          </div>
          <dl className="event-sheet__facts">
            <div>
              <dt>
                <ClockIcon aria-hidden="true" className="size-[17px]" /> Time
              </dt>
              <dd>{formatEventRange(event, user.planningTimezone)}</dd>
            </div>
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
          {blockDestinations.length > 0 ? (
            <section className="event-sheet__blocking" aria-labelledby="event-blocking-title">
              <header>
                <div>
                  <h3 id="event-blocking-title">
                    <LockIcon aria-hidden="true" className="size-4" /> Blocked time
                  </h3>
                  <p>Keep one event here while reserving the same time elsewhere.</p>
                </div>
                {blocks.length > 0 ? <Badge>{blocks.length} linked</Badge> : null}
              </header>
              <div className="event-block-list">
                {blockDestinations.map((destination) => {
                  const block = blocks.find((record) => record.calendarId === destination.id);
                  return (
                    <div className="event-block-row" key={destination.id}>
                      <label>
                        <input
                          checked={Boolean(block)}
                          disabled={changeBlock.isPending}
                          onChange={(changeEvent) => {
                            if (changeEvent.currentTarget.checked) {
                              changeBlock.mutate({
                                calendarId: destination.id,
                                mode: "busy",
                                operation: "create",
                              });
                            } else {
                              const linkedBlock = block as NonNullable<typeof block>;
                              changeBlock.mutate({
                                blockId: linkedBlock.eventId,
                                calendarId: destination.id,
                                mode: linkedBlock.mode,
                                operation: "delete",
                              });
                            }
                          }}
                          type="checkbox"
                        />
                        <i
                          aria-hidden="true"
                          style={{ background: destination.color ?? "#777ce3" }}
                        />
                        <span>
                          <strong>{destination.name}</strong>
                          <small>{destination.provider}</small>
                        </span>
                      </label>
                      <select
                        aria-label={`Privacy on ${destination.name}`}
                        disabled={!block || changeBlock.isPending}
                        onChange={(changeEvent) =>
                          block &&
                          changeBlock.mutate({
                            blockId: block.eventId,
                            calendarId: destination.id,
                            mode: changeEvent.currentTarget.value as "busy" | "details",
                            operation: "update",
                          })
                        }
                        value={block?.mode ?? "busy"}
                      >
                        <option value="busy">Busy only</option>
                        <option value="details">Include details</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              {changeBlock.isError ? (
                <p className="form-error" role="alert">
                  {errorMessage(changeBlock.error)}
                </p>
              ) : null}
            </section>
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
                : "This event is stored in ilo and available to authorized agents."}
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
      </aside>
    </div>
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
    return (
      <main className="center-screen">
        <div className="inline-error" role="alert">
          <strong>ilo service is offline.</strong>
          <span>Run the Start environment action, then try again.</span>
        </div>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </main>
    );
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
function meetingTimingSummary(event: CalendarEvent, currentTime: Date) {
  const elapsed = Math.max(
    0,
    Math.floor((currentTime.getTime() - new Date(event.startsAt).getTime()) / 60_000),
  );
  const remaining = Math.max(
    0,
    Math.ceil((new Date(event.endsAt).getTime() - currentTime.getTime()) / 60_000),
  );
  return `Started ${formatMinutes(elapsed)} ago · ${formatMinutes(remaining)} left`;
}
function conferenceProviderLabel(url: string): string {
  const hostname = new URL(url).hostname;
  if (hostname === "meet.google.com") return "Google Meet";
  if (hostname === "teams.live.com" || hostname.endsWith(".teams.microsoft.com")) {
    return "Microsoft Teams";
  }
  if (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) return "Zoom";
  if (hostname === "webex.com" || hostname.endsWith(".webex.com")) return "Webex";
  return "meeting";
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

function calendarDate(date: LocalDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

function localDateKey(date: LocalDate): string {
  return localDateToIso(date);
}

function startCalendarDrag(
  dragEvent: ReactDragEvent<HTMLButtonElement>,
  event: CalendarEvent,
  setDraggedEventId: (id: string | null) => void,
) {
  dragEvent.dataTransfer.effectAllowed = "move";
  dragEvent.dataTransfer.setData(calendarDragType, event.id);
  setDraggedEventId(event.id);
}

function allowCalendarDrop(dragEvent: ReactDragEvent<HTMLElement>, draggedEventId: string | null) {
  if (!draggedEventId) return;
  dragEvent.preventDefault();
  dragEvent.dataTransfer.dropEffect = "move";
}

function timelineMinuteAtPointer(pointerEvent: { clientY: number }, timeline: HTMLElement) {
  const bounds = timeline.getBoundingClientRect();
  const clientY = Number.isFinite(pointerEvent.clientY) ? pointerEvent.clientY : 0;
  const top = Number.isFinite(bounds.top) ? bounds.top : 0;
  const relativeY = Math.min(calendarTimelineHeight, Math.max(0, clientY - top));
  const unsnappedMinute = (relativeY / calendarTimelineHeight) * calendarMinutesPerDay;
  return Math.min(23 * 60 + 45, Math.max(0, Math.round(unsnappedMinute / 15) * 15));
}

function previewTimelineDrop(
  dragEvent: ReactDragEvent<HTMLElement>,
  day: LocalDate,
  events: CalendarEvent[],
  draggedEventId: string | null,
  setPreview: (preview: CalendarDropPreview | null) => void,
) {
  if (!draggedEventId) return;
  allowCalendarDrop(dragEvent, draggedEventId);
  const dragged = events.find(
    (event) => event.id === (dragEvent.dataTransfer.getData(calendarDragType) || draggedEventId),
  );
  if (!dragged || dragged.allDay) return;
  setPreview({
    dayKey: localDateKey(day),
    duration: Math.max(
      15,
      Math.round(
        (new Date(dragged.endsAt).getTime() - new Date(dragged.startsAt).getTime()) / 60_000,
      ),
    ),
    minute: timelineMinuteAtPointer(dragEvent, dragEvent.currentTarget),
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
    const minute = timelineMinuteAtPointer(dragEvent, dragEvent.currentTarget);
    moveEvent(event, day, minute);
  }
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

export function positionTimelineEvents(
  events: CalendarEvent[],
  day: LocalDate,
  timeZone: string,
): TimelineEventLayout[] {
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
  const layouts: TimelineEventLayout[] = [];
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

function formatTimeZoneName(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "short" }).formatToParts(
    date,
  );
  return (parts[parts.length - 1] as Intl.DateTimeFormatPart).value;
}
