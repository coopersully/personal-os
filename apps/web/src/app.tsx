import {
  ApiClientError,
  type CalendarAccount,
  type Session,
  type XBookmarkAccount,
} from "@personal-os/api-client";
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
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  createContext,
  type FormEvent,
  lazy,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  Suspense,
  useCallback,
  useContext,
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
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { toast } from "sonner";
import {
  AccountSelectionPopoverContent,
  AccountSelectionTrigger,
  reconnectAccountsLabel,
} from "@/components/account-selection-trigger";
import {
  EmailField,
  InviteCodeField,
  isValidEmailAddress,
  isValidPassword,
  PasswordFields,
  TextField,
} from "@/components/auth-fields";
import { BrandMark, brandTitle, hasBrandMark, NohmiBrandMark } from "@/components/brand-marks";
import { BrandPattern } from "@/components/brand-pattern";
import { ChoiceCardGroup } from "@/components/choice-card-group";
import { ConnectionCard } from "@/components/connection-card";
import { DateInput } from "@/components/date-input";
import { ErrorPage } from "@/components/error-page";
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
  AlertTriangleIcon,
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
  PauseIcon,
  PinIcon,
  PlayIcon,
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
import { SegmentedControl, SegmentedControlItem } from "@/components/segmented-control";
import { SidebarItemMeta } from "@/components/sidebar-item-meta";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Sidebar as ShadcnSidebar,
  SidebarContent as ShadcnSidebarContent,
  SidebarGroup as ShadcnSidebarGroup,
  SidebarGroupContent as ShadcnSidebarGroupContent,
  SidebarGroupLabel as ShadcnSidebarGroupLabel,
  SidebarHeader as ShadcnSidebarHeader,
  SidebarMenu as ShadcnSidebarMenu,
  SidebarMenuButton as ShadcnSidebarMenuButton,
  SidebarMenuItem as ShadcnSidebarMenuItem,
  SidebarProvider as ShadcnSidebarProvider,
} from "@/components/ui/sidebar";
import { Slider as ShadcnSlider } from "@/components/ui/slider";
import { Toaster } from "@/components/ui/sonner";
import { Switch as ShadcnSwitch } from "@/components/ui/switch";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { ConnectionAuthorizationOutcome } from "@/features/connections/authorization-outcome";
import { api, isUnauthorized } from "./api.js";
import { scrollTimelineToMinute } from "./calendar-timeline.js";
import { InlineError, PageLoading, QueryFeedback } from "./components/async-state.js";
import { useConfirmAction } from "./components/confirm-action.js";
import { FeedbackForm } from "./components/feedback-form.js";
import { MobileWorkspaceDock } from "./components/mobile-workspace-dock.js";
import { MutationFeedback } from "./components/mutation-feedback.js";
import { SettingsRecord, SettingsRecordAction } from "./components/settings-record.js";
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
import {
  ConnectionHealthBadge,
  ConnectionHealthDescription,
  connectionHealth,
  visibleConnectorRefreshInterval,
} from "./features/connections/health.js";
import { DesktopDownloads } from "./features/desktop/downloads.js";
import { useDesktopActions } from "./features/desktop/events.js";
import { resetDesktopSession } from "./features/desktop/session.js";
import { DesktopSettingsPanel } from "./features/desktop/settings.js";
import {
  FinanceSidebarNavigation,
  financeSectionFromPath,
} from "./features/finances/navigation.js";
import { FinanceSettings } from "./features/finances/settings.js";
import {
  MailPage as MailFeaturePage,
  MailSidebar as MailFeatureSidebar,
  MailTopbarSearch,
} from "./features/mail/mail.js";
import {
  ReminderRow,
  RemindersCreateButton,
  RemindersTopbarControls,
} from "./features/reminders/page.js";
import { ReviewFlowHost } from "./features/reviews/flow.js";
import { ReviewNavigation } from "./features/reviews/navigation.js";

import { AccountIdentity, AccountOverview } from "./features/settings/account-overview.js";
import {
  ConnectedAgentsSettings,
  useWorkspaceSettingsActions,
  WorkspaceAccessSettings,
  WorkspaceSettings,
  type WorkspaceSettingsActions,
} from "./features/settings/agent-access.js";
import { RelatedSettings } from "./features/settings/related-settings.js";
import {
  SettingsBento,
  SettingsPageLayout,
  SettingsSection,
} from "./features/settings/settings-layout.js";
import { SettingsSearch, settingsDescriptions } from "./features/settings/settings-search.js";
import { SetupSettings } from "./features/settings/setup-settings.js";
import { useSettingsSidebarCounts } from "./features/settings/sidebar-counts.js";
import {
  TaskRow,
  TasksCreateButton,
  TasksSidebar,
  TasksTopbarControls,
} from "./features/tasks/page.js";
import { TaskDialog } from "./features/tasks/task-dialog.js";
import { TasksWorkspacePage } from "./features/tasks/workspace-page.js";
import { textingSettingsNavigationItem } from "./features/texting/manifest.js";
import { TextingSettings } from "./features/texting/page.js";
import { RitualSettings } from "./features/tracking/ritual-settings.js";
import { RitualSetupOffer } from "./features/tracking/ritual-setup-offer.js";
import {
  formatCalendarDate,
  formatMaterialDateTime,
  formatOrdinalDate,
} from "./lib/date-format.js";
import { invalidateMaterial } from "./lib/material-queries.js";
import { formatRelativeTime } from "./lib/time-format.js";
import { useFeedbackMutation } from "./lib/use-feedback-mutation.js";
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
const FinanceWorkspacePage = lazy(() =>
  import("./features/finances/workspace-page.js").then((module) => ({
    default: module.FinanceWorkspacePage,
  })),
);
const ErrorPagePreview = import.meta.env.DEV
  ? lazy(() => import("./components/error-page-preview.js"))
  : null;
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
  count?: number | undefined;
  icon: Icon;
  items?: NavigationItemDefinition[];
  label: string;
  path: string;
};

type WorkspaceTransitionDirection = "down" | "none" | "up";

const workspaceShortcuts: WorkspaceDefinition[] = workspaceDefinitions;

function workspaceForPath(pathname: string): WorkspaceDefinition | undefined {
  return workspaceForLocation(pathname);
}

export function normalizeShellPathname(pathname: string): string {
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
  const location = useLocation();
  if (location.pathname === "/downloads") {
    return (
      <>
        <DesktopDownloads standalone />
        <Toaster position="bottom-right" theme="system" />
      </>
    );
  }
  if (ErrorPagePreview && location.pathname === "/dev/errors") {
    return (
      <Suspense
        fallback={
          <main className="center-screen">
            <Spinner label="Opening preview" />
          </main>
        }
      >
        <ErrorPagePreview />
      </Suspense>
    );
  }
  return <SessionApp />;
}

function SessionApp() {
  const me = useQuery({ queryFn: api.getMe, queryKey: ["me"] });
  return (
    <>
      <AppContent me={me} />
      <Toaster
        theme={typeof window.matchMedia === "function" ? (me.data?.theme ?? "system") : "light"}
      />
    </>
  );
}

function AppContent({ me }: { me: UseQueryResult<User> }) {
  if (me.isPending) {
    return (
      <main className="center-screen">
        <Spinner label="Opening nohmi" />
      </main>
    );
  }
  if (me.isError && isUnauthorized(me.error)) return <AuthScreen />;
  if (me.isError && !me.data)
    return (
      <>
        <FatalState error={me.error} />
        {isTauri() ? <DesktopSettingsPanel connectionOnly /> : null}
      </>
    );
  return (
    <TooltipProvider>
      <QueryFeedback query={me} title="Couldn’t refresh your account." staleOnly />
      <AuthenticatedExperience user={me.data as User} />
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
  return <AuthenticatedApp user={user} />;
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
  const invitationValidation = useFeedbackMutation({
    feedback: { action: "check this invitation", form: true },
    mutationFn: (inviteCode: string) => api.validateInvitation({ inviteCode }),
  });
  const mutation = useFeedbackMutation({
    feedback: {
      action:
        mode === "login"
          ? "sign in"
          : mode === "register"
            ? "create your account"
            : "send a password reset link",
      form: true,
    },
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
        ? "Couldn’t check this invitation. Try again."
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
  const registrationFeedback = useMemo(
    () =>
      invitationError && mode === "register"
        ? {
            kind: "validation" as const,
            message: invitationError,
            persistent: true,
            fields: { inviteCode: invitationError },
          }
        : mutation.feedback,
    [invitationError, mode, mutation.feedback],
  );
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
    <AuthLayout>
      <FeedbackForm
        feedback={registrationFeedback}
        className="auth-form"
        onSubmit={submit}
        validate={() => {
          const errors: Record<string, string> = {};
          if (!emailValid) errors.email = "Enter an email address in the format name@example.com.";
          if (mode === "register") {
            if (!credentials.displayName.trim()) errors.displayName = "Enter your name.";
            if (!invitationValid && invitationStatus !== "checking")
              errors.inviteCode =
                invitationError ?? "Enter a valid invitation and wait for it to be checked.";
            if (!passwordValid) errors.password = "Meet each password requirement shown below.";
            if (!passwordsMatch) errors.confirmPassword = "Passwords must match.";
          }
          return errors;
        }}
      >
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
              onBlur={() => {
                setInviteBlurred(true);
                if (credentials.inviteCode.length === 8) {
                  if (!invitationResultIsCurrent || invitationValidation.isError)
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
            labelAction={
              mode === "login" ? (
                <button
                  className="text-button auth-field-action"
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

        {mutation.isSuccess && mode === "recovery" ? (
          <p className="form-success" role="status">
            If an account exists for that email, a password-reset link is on its way.
          </p>
        ) : null}
        <ShadcnButton className="button--wide" disabled={mutation.isPending} type="submit">
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
            className="text-button"
            type="button"
            onClick={() => selectMode("register")}
          >
            Have an invite? Create an account
          </button>
        ) : (
          <button className="text-button" type="button" onClick={() => selectMode("login")}>
            {mode === "register" ? "Already have an account? Sign in" : "Back to sign in"}
          </button>
        )}
      </FeedbackForm>
      {isTauri() ? <DesktopSettingsPanel connectionOnly /> : null}
    </AuthLayout>
  );
}

function EmailVerificationScreen({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const verification = useFeedbackMutation({
    feedback: { action: "confirm your email", form: true },
    mutationFn: () => api.confirmEmailVerification({ token }),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
  });
  return (
    <AuthActionShell
      description="Confirm the email address for this nohmi account."
      title="Confirm your email"
    >
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
      <MutationFeedback feedback={verification.feedback} />
    </AuthActionShell>
  );
}

function PasswordResetScreen({ token }: { token: string }) {
  const [complete, setComplete] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const reset = useFeedbackMutation({
    feedback: { action: "reset your password", form: true },
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
        <FeedbackForm
          feedback={reset.feedback}
          validate={() => {
            const errors: Record<string, string> = {};
            if (!isValidPassword(password))
              errors.password = "Meet each password requirement shown below.";
            if (!passwordsMatch) errors.confirmPassword = "Passwords must match.";
            return errors;
          }}
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate();
          }}
        >
          <PasswordFields
            autoComplete="new-password"
            confirmValue={confirmPassword}
            label="New password"
            onConfirmValueChange={setConfirmPassword}
            onValueChange={setPassword}
            showRequirements
            value={password}
          />

          <Button disabled={reset.isPending} tone="accent" type="submit">
            {reset.isPending ? <Spinner label="Resetting password" /> : "Reset password"}
          </Button>
        </FeedbackForm>
      )}
    </AuthActionShell>
  );
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="auth-shell">
        <div className="auth-entry">
          <header className="auth-header">
            <div className="auth-header__brand">
              <span aria-hidden="true" className="auth-header__symbol">
                <NohmiBrandMark symbol />
              </span>
              <NohmiBrandMark />
            </div>
          </header>
          <section className="auth-form-wrap">{children}</section>
        </div>
        <ShadcnCard aria-hidden="true" className="auth-brand-panel">
          <ShadcnCardContent>
            <BrandPattern />
          </ShadcnCardContent>
        </ShadcnCard>
      </main>
    </>
  );
}

function AuthActionShell({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <AuthLayout>
      <div className="auth-form auth-action-content">
        <div className="auth-form__heading">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {children}
      </div>
    </AuthLayout>
  );
}

const sidebarWidthStorageKey = "nohmi.sidebar-width.v1";
const collapsedSidebarWidth = 48;
const defaultSidebarWidth = 256;
function normalizeSidebarWidth(width: number) {
  return width < (collapsedSidebarWidth + defaultSidebarWidth) / 2
    ? collapsedSidebarWidth
    : defaultSidebarWidth;
}

function storedSidebarWidth() {
  try {
    if (typeof window === "undefined") return defaultSidebarWidth;
    const stored = Number(window.localStorage.getItem(sidebarWidthStorageKey));
    return Number.isFinite(stored) && stored > 0
      ? normalizeSidebarWidth(stored)
      : defaultSidebarWidth;
  } catch {
    return defaultSidebarWidth;
  }
}

function persistSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(sidebarWidthStorageKey, String(width));
  } catch {
    // A browser storage restriction must not prevent layout resizing.
  }
}

function SidebarCollapseHandle({
  onResize,
  collapsedWidth = collapsedSidebarWidth,
  expandedWidth = defaultSidebarWidth,
  label = "Collapse or show sidebar",
  controls = "app-sidebar",
  className = "",
  width,
}: {
  onResize: (width: number, persist: boolean) => void;
  width: number;
  collapsedWidth?: number;
  expandedWidth?: number;
  label?: string;
  controls?: string;
  className?: string;
}) {
  const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "Home" || event.key === "ArrowLeft"
        ? collapsedWidth
        : event.key === "End" || event.key === "ArrowRight"
          ? expandedWidth
          : event.key === "Enter" || event.key === " "
            ? width === collapsedWidth
              ? expandedWidth
              : collapsedWidth
            : null;
    if (next === null) return;
    event.preventDefault();
    onResize(next, true);
  };

  return (
    <hr
      aria-label={label}
      aria-controls={controls}
      aria-valuetext={width === collapsedWidth ? "Collapsed" : "Expanded"}
      aria-orientation="vertical"
      aria-valuemax={expandedWidth}
      aria-valuemin={collapsedWidth}
      aria-valuenow={width}
      className={`sidebar-collapse-handle ${className}`}
      onDoubleClick={() =>
        onResize(width === collapsedWidth ? expandedWidth : collapsedWidth, true)
      }
      onKeyDown={resizeFromKeyboard}
      onPointerDown={(event) => {
        event.preventDefault();
        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startWidth = width;
        let finalWidth = width;
        let finished = false;
        const move = (moveEvent: PointerEvent) => {
          finalWidth = Math.min(
            expandedWidth,
            Math.max(collapsedWidth, startWidth + moveEvent.clientX - startX),
          );
          onResize(finalWidth, false);
        };
        const finish = () => {
          if (finished) return;
          finished = true;
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", finish);
          handle.removeEventListener("pointercancel", finish);
          handle.removeEventListener("lostpointercapture", finish);
          window.removeEventListener("blur", finish);
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          onResize(finalWidth, true);
          handle.blur();
        };
        handle.setPointerCapture(pointerId);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", finish, { once: true });
        handle.addEventListener("pointercancel", finish, { once: true });
        handle.addEventListener("lostpointercapture", finish, { once: true });
        window.addEventListener("blur", finish, { once: true });
      }}
      tabIndex={0}
    />
  );
}

function AuthenticatedApp({ user }: { user: User }) {
  const [editor, setEditor] = useState<Editor>(null);
  const desktopCapture = useCallback(
    (kind: "task" | "reminder" | "event") => setEditor({ kind }),
    [],
  );
  useDesktopActions(desktopCapture);
  const [calendarTodaySnap, setCalendarTodaySnap] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pinned, setPinned] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("nohmi.workspace-rail-collapsed.v1") === "true";
    } catch {
      return false;
    }
  });
  const railContainer = useRef<HTMLDivElement>(null);
  const compactSwitcher = useRef<HTMLDivElement>(null);
  const pendingRailFocus = useRef(false);
  const updateRailCollapsed = (collapsed: boolean) => {
    pendingRailFocus.current =
      !collapsed || !!railContainer.current?.contains(document.activeElement);
    setRailCollapsed(collapsed);
    try {
      window.localStorage.setItem("nohmi.workspace-rail-collapsed.v1", String(collapsed));
    } catch {
      /* Navigation remains usable when storage is unavailable. */
    }
  };

  useEffect(() => {
    if (!pendingRailFocus.current) return;
    pendingRailFocus.current = false;
    // Wait for dropdown dismissal focus restoration before focusing the newly
    // visible navigation. Neither target is allowed to remain in an inert tree.
    let frame = window.requestAnimationFrame(function focusVisibleNavigation() {
      const target = railCollapsed
        ? compactSwitcher.current?.querySelector<HTMLButtonElement>("button")
        : (railContainer.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ??
          railContainer.current?.querySelector<HTMLAnchorElement>("a"));
      if (target && window.getComputedStyle(target).visibility !== "visible") {
        frame = window.requestAnimationFrame(focusVisibleNavigation);
        return;
      }
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [railCollapsed]);

  const sidebarState = sidebarWidth === collapsedSidebarWidth ? "collapsed" : "expanded";
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
  const settingsCounts = useSettingsSidebarCounts(sidebarMode === "settings");
  const activeSettingsSection = settingsSectionFromSearch(location.search);
  const pageTitle = workspaceTitleForLocation(shellPathname, location.search);
  const activeFinanceSection = financeSectionFromPath(location.pathname);
  const financeInbox = useQuery({
    enabled: sidebarMode === "finances",
    queryFn: api.getFinanceInbox,
    queryKey: ["finance-inbox"],
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

  const updateSidebarWidth = (width: number, persist: boolean) => {
    if (isMobileWorkspaceDock || !sidebarMode) return;
    const normalized = normalizeSidebarWidth(width);
    if (
      normalized === collapsedSidebarWidth &&
      document.getElementById("app-sidebar")?.contains(document.activeElement)
    ) {
      document.querySelector<HTMLElement>('[aria-controls="app-sidebar"]')?.focus();
    }
    setSidebarWidth(normalized);
    if (persist) persistSidebarWidth(normalized);
  };

  return (
    <ShadcnSidebarProvider
      className="contents"
      open={sidebarState === "expanded"}
      onOpenChange={(open) => {
        updateSidebarWidth(open ? defaultSidebarWidth : collapsedSidebarWidth, true);
      }}
    >
      <div
        className={`app-shell${isCalendarWorkspace ? " app-shell--calendar" : sidebarMode === "mail" ? " app-shell--mail" : ""}${isTodayWorkspace && !isMobileWorkspaceDock ? " app-shell--full-width" : ""}`}
        data-rail-collapsed={!isMobileWorkspaceDock && railCollapsed ? "true" : undefined}
        data-sidebar-state={!isMobileWorkspaceDock && sidebarMode ? sidebarState : undefined}
        style={
          sidebarMode ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties) : undefined
        }
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {!isMobileWorkspaceDock ? (
          <div
            ref={railContainer}
            className="workspace-rail-container"
            inert={railCollapsed}
            aria-hidden={railCollapsed}
          >
            <WorkspaceRail pathname={shellPathname} user={user} weather={weather.data} />
            <SidebarCollapseHandle
              className="workspace-rail-collapse-handle"
              label="Minimize workspace rail"
              controls="workspace-rail"
              collapsedWidth={0}
              expandedWidth={64}
              width={64}
              onResize={(width, persist) => {
                if (persist) updateRailCollapsed(width < 32);
              }}
            />
          </div>
        ) : null}
        {!isMobileWorkspaceDock ? (
          <div
            ref={compactSwitcher}
            className="workspace-switcher-floating"
            inert={!railCollapsed}
            aria-hidden={!railCollapsed}
          >
            <WorkspaceSwitcher
              compact
              onShowRail={() => updateRailCollapsed(false)}
              onNavigate={closeMobileMenu}
              pathname={shellPathname}
              user={user}
              weather={weather.data}
            />
          </div>
        ) : null}
        {!isMobileWorkspaceDock && !isCalendarWorkspace && !isTodayWorkspace ? (
          <ShadcnSidebar
            collapsible="none"
            role="complementary"
            aria-label={
              navigationOwner.kind !== "workspace"
                ? "Account utility navigation"
                : sidebarMode
                  ? `${sidebarMode.charAt(0).toUpperCase()}${sidebarMode.slice(1)} Sidebar`
                  : "Today Sidebar"
            }
            className={`sidebar${sidebarMode ? " sidebar--context" : ""}`}
            data-state={sidebarState}
            id="app-sidebar"
          >
            <ShadcnSidebarHeader className="workspace-sidebar__header">
              <span className="truncate text-sm font-semibold">
                {sidebarMode === "settings" ? "Settings" : activeWorkspace?.label}
              </span>
              {sidebarMode === "settings" ? (
                <SettingsSearch
                  groups={searchableSettingsNavigation(user.canManageInvitations === true)}
                />
              ) : null}
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
                  counts={settingsCounts}
                />
              ) : sidebarMode === "finances" ? (
                <FinanceSidebarNavigation
                  onNavigate={closeMobileMenu}
                  reviewCount={financeInbox.data?.remainingWork.count ?? 0}
                  section={activeFinanceSection}
                />
              ) : sidebarMode === "tasks" ? (
                <TasksSidebar onNavigate={closeMobileMenu} />
              ) : sidebarMode === "mail" ? (
                <MailFeatureSidebar onNavigate={closeMobileMenu} />
              ) : null}
            </ShadcnSidebarContent>
            {sidebarMode === "mail" || sidebarMode === "tasks" || sidebarMode === "finances" ? (
              <ReviewNavigation workspace={sidebarMode} footer />
            ) : null}
          </ShadcnSidebar>
        ) : null}
        {!isMobileWorkspaceDock && sidebarMode ? (
          <SidebarCollapseHandle onResize={updateSidebarWidth} width={sidebarWidth} />
        ) : null}
        {isMobileWorkspaceDock && !isCalendarWorkspace ? (
          <MobileWorkspaceDock
            showWorkspaceSwitcher={false}
            accountSections={settingsSectionPages(
              user.canManageInvitations === true,
              workspaceSettingsActions,
              settingsCounts,
            )}
            pathname={shellPathname}
            {...(sidebarMode === "tasks"
              ? {
                  renderWorkspaceNavigation: (onNavigate: () => void) => (
                    <TasksSidebar onNavigate={onNavigate} />
                  ),
                }
              : sidebarMode === "mail"
                ? {
                    renderWorkspaceNavigation: (onNavigate: () => void) => (
                      <MailFeatureSidebar onNavigate={onNavigate} />
                    ),
                  }
                : sidebarMode === "finances"
                  ? {
                      renderWorkspaceNavigation: (onNavigate: () => void) => (
                        <FinanceSidebarNavigation
                          onNavigate={onNavigate}
                          reviewCount={financeInbox.data?.remainingWork.count ?? 0}
                          section={activeFinanceSection}
                        />
                      ),
                    }
                  : {})}
            planningTimezone={user.planningTimezone}
            workspaceDefinitions={workspaceDefinitions}
            weather={weather.data}
          />
        ) : null}
        <ReviewFlowHost
          workspace={
            shellPathname === "/settings"
              ? ["mail", "calendar", "tasks", "finances"].includes(activeSettingsSection)
                ? (activeSettingsSection as "mail" | "calendar" | "tasks" | "finances")
                : undefined
              : activeWorkspace?.id === "today"
                ? undefined
                : activeWorkspace?.id
          }
        />
        <WorkspaceLayout
          banner={
            !online && (
              <div className="offline-banner">
                <WifiOffIcon className="size-[15px]" /> Offline — changes are paused until you
                reconnect.
              </div>
            )
          }
          primaryNavigation={
            shellPathname === "/settings" ? (
              isMobileWorkspaceDock ? (
                <WorkspaceAppBar
                  workspace="account"
                  identity={
                    <WorkspaceSwitcher
                      compact
                      onNavigate={closeMobileMenu}
                      pathname={location.pathname}
                      user={user}
                      weather={weather.data}
                    />
                  }
                />
              ) : null
            ) : (
              <WorkspaceAppBarForRoute
                sidebarOwnsTitle={
                  !isMobileWorkspaceDock && !!sidebarMode && sidebarMode !== "settings"
                }
                workspaceSwitcher={
                  isMobileWorkspaceDock ? (
                    <WorkspaceSwitcher
                      compact
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
            )
          }
        >
          <main
            className={`content${isSpatialCalendar ? " content--calendar" : shellPathname === "/mail" ? " content--mail" : ""}`}
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
                {isTauri() ? <RitualSetupOffer userId={user.id} /> : null}
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
        </WorkspaceLayout>
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
    </ShadcnSidebarProvider>
  );
}

function LegacyReviewRedirect({ workspace }: { workspace: "mail" | "calendar" | "finances" }) {
  const [params] = useSearchParams();
  const item = params.get("item");
  const question = params.get("question");
  const approval = params.get("approval");
  const contextual = params.get("contextualQuestion");
  const id = item
    ? `finance-review:${item}`
    : contextual
      ? `finance-contextual:${contextual}`
      : question
        ? `${workspace === "mail" ? "mail-question" : "finance-action"}:${question}`
        : approval
          ? `finance-action:${approval}`
          : "open";
  return <Navigate replace to={`/${workspace}?review=${encodeURIComponent(id)}`} />;
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
  todayBrief: Pick<
    UseQueryResult<DailyBrief>,
    "data" | "error" | "isError" | "isPending" | "refetch"
  >;
  user: User;
  weather: {
    data: WeatherSnapshot | undefined;
    isError: boolean;
    isPending: boolean;
  };
}) {
  return (
    <Routes>
      {(["calendar", "mail", "tasks", "finances"] as const).map((workspace) => (
        <Route
          key={workspace}
          path={`/${workspace}/decisions`}
          element={<Navigate replace to={`/${workspace}?review=open`} />}
        />
      ))}
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
      <Route path="/calendar/review" element={<LegacyReviewRedirect workspace="calendar" />} />
      <Route
        path="/reminders"
        element={
          <TasksWorkspacePage
            onEdit={(task) => setEditor({ kind: "task", task })}
            onEditReminder={(reminder) => setEditor({ kind: "reminder", reminder })}
            timeZone={user.planningTimezone}
          />
        }
      />
      <Route
        path="/tasks"
        element={
          <TasksWorkspacePage
            onEdit={(task) => setEditor({ kind: "task", task })}
            onEditReminder={(reminder) => setEditor({ kind: "reminder", reminder })}
            timeZone={user.planningTimezone}
          />
        }
      />
      <Route path="/mail" element={<MailFeaturePage user={user} />} />
      <Route path="/mail/review" element={<LegacyReviewRedirect workspace="mail" />} />
      <Route
        path="/automations"
        element={<Navigate replace to="/settings?section=workspace-access" />}
      />
      <Route path="/activity" element={<LegacySettingsRedirect section="activity" />} />
      <Route path="/reviews" element={<Navigate replace to="/settings?section=profile" />} />
      <Route path="/goals" element={<LegacySettingsRedirect section="goals" />} />
      <Route path="/motives" element={<LegacySettingsRedirect section="motives" />} />
      <Route path="/finances/review/*" element={<LegacyReviewRedirect workspace="finances" />} />
      <Route
        path="/finances/profile"
        element={<Navigate replace to="/settings?section=finances#guidance" />}
      />
      <Route
        path="/finances/*"
        element={
          <Suspense fallback={<PageLoading workspace="finances" />}>
            <FinanceWorkspacePage />
          </Suspense>
        }
      />
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
  count,
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
      <ShadcnSidebarMenuButton
        className={badge || count !== undefined ? "sidebar-item-with-meta" : undefined}
        asChild
        isActive={isActive}
        tooltip={label}
      >
        <Link onClick={onNavigate} to={path} aria-current={isActive ? "page" : undefined}>
          {workspaceId ? (
            <WorkspaceIcon size="sm" workspace={workspaceId} />
          ) : (
            <NavigationIcon active={isActive} fallback={Icon} label={label} />
          )}
          <span>{label}</span>
        </Link>
      </ShadcnSidebarMenuButton>
      <SidebarItemMeta attention={Boolean(badge)} count={count} label={label} />
    </ShadcnSidebarMenuItem>
  );
}

const navigationIcons = {
  Profile: UserCircleIcon,
  "Security & access": LockIcon,
  "Activity log": PulseIcon,
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
  sidebarOwnsTitle,
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
  sidebarOwnsTitle: boolean;
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
  const isReviewQueue = pathname.endsWith("/decisions");
  const identity = isReviewQueue ? (
    <span className="workspace-app-bar__title">Needs review</span>
  ) : sidebarOwnsTitle ? null : isSpatialCalendar ? (
    <CalendarAppBarIdentity user={user} workspaceSwitcher={workspaceSwitcher} />
  ) : pathname === "/today" ? (
    <div className="calendar-app-bar__identity-cluster">
      {workspaceSwitcher ? (
        <div className="calendar-workspace-switcher">{workspaceSwitcher}</div>
      ) : null}
      {todayBrief ? (
        <TodayNavigationTitle
          generatedAt={todayBrief.generatedAt}
          timeZone={user.planningTimezone}
        />
      ) : (
        <span className="workspace-app-bar__title">Today</span>
      )}
    </div>
  ) : workspace === "mail" ? (
    <div className="mail-app-bar__identity-cluster">
      <span className="workspace-app-bar__title">Mail</span>
    </div>
  ) : (
    <span className="workspace-app-bar__title">
      {/* Account routes always supply a page title, so the workspace registry
            covers the remaining identities. */}
      {pageTitle ?? workspaceDefinitions.find((item) => item.id === workspace)?.label}
    </span>
  );
  const context = isReviewQueue ? null : isSpatialCalendar ? (
    <CalendarAppBarControls onToday={onCalendarToday} user={user} />
  ) : pathname === "/today" ? (
    <TodayWeatherTopbar generatedAt={todayBrief?.generatedAt} user={user} weather={weather} />
  ) : pathname === "/activity" ? (
    <ActivityTopbarControls />
  ) : pathname === "/reminders" ? (
    <RemindersTopbarControls />
  ) : pathname === "/tasks" ? (
    <TasksTopbarControls />
  ) : workspace === "mail" ? (
    <MailAppBarControls />
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
          <div
            className={
              workspace !== "mail" && workspace !== "calendar" && workspace !== "account"
                ? "workspace-create-actions"
                : undefined
            }
          >
            {isReviewQueue ? null : pathname === "/reminders" ? (
              <RemindersCreateButton onCreate={() => setEditor({ kind: "reminder" })} />
            ) : workspace === "tasks" ? (
              <TasksCreateButton
                onCreate={() => setEditor({ kind: "task" })}
                onCreateReminder={() => setEditor({ kind: "reminder" })}
              />
            ) : workspace === "calendar" ? null : workspace === "mail" ? (
              <MailAccountsControl />
            ) : workspace === "finances" ? (
              <FinanceAddTransactionButton />
            ) : workspace === "account" ? null : (
              <CreateMenu setEditor={setEditor} />
            )}
          </div>
        </>
      }
      context={context}
      identity={
        <>
          {workspaceSwitcher && !isSpatialCalendar && pathname !== "/today"
            ? workspaceSwitcher
            : null}
          {identity}
          {workspaceSwitcher &&
          (workspace === "mail" || workspace === "tasks" || workspace === "finances") ? (
            <ReviewNavigation workspace={workspace} />
          ) : null}
        </>
      }
      workspace={workspace}
    />
  );
}

function WorkspaceRail({
  pathname,
  user,
  weather,
}: {
  pathname: string;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  const owner = navigationOwnerForLocation(pathname);
  return (
    <nav aria-label="Workspace navigation" className="workspace-rail" id="workspace-rail">
      <div className="workspace-rail__destinations">
        {workspaceDefinitions.map((workspace) => {
          const active = owner.kind === "workspace" && owner.workspace === workspace.id;
          const Icon =
            workspace.id === "today"
              ? todayWeatherIcon(weather, user.planningTimezone)
              : workspace.icon;
          return (
            <Tooltip key={workspace.id}>
              <TooltipTrigger asChild>
                <ShadcnButton
                  asChild
                  className="workspace-rail__link"
                  size="icon"
                  variant={active ? "secondary" : "ghost"}
                >
                  <Link
                    aria-current={active ? "page" : undefined}
                    aria-label={workspace.label}
                    data-workspace={workspace.id}
                    to={workspace.path}
                  >
                    <Icon aria-hidden="true" weight={active ? "Filled" : "Outline"} />
                  </Link>
                </ShadcnButton>
              </TooltipTrigger>
              <TooltipContent side="right">{workspace.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <ShadcnButton
            asChild
            className="workspace-rail__link workspace-rail__settings"
            size="icon"
            variant={owner.kind === "account-utility" ? "secondary" : "ghost"}
          >
            <Link
              aria-current={owner.kind === "account-utility" ? "page" : undefined}
              aria-label="Settings"
              to="/settings"
            >
              <SettingsIcon aria-hidden="true" />
            </Link>
          </ShadcnButton>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </nav>
  );
}

function WorkspaceSwitcher({
  compact = false,
  onShowRail,
  onNavigate,
  pathname,
  user,
  weather: currentWeather,
}: {
  compact?: boolean;
  onShowRail?: () => void;
  onNavigate: () => void;
  pathname: string;
  user: User;
  weather: WeatherSnapshot | undefined;
}) {
  const workspace = workspaceForPath(pathname);
  const isSettings = pathname === "/settings";
  const section = isSettings ? "Settings" : (workspace?.label ?? "Home OS");
  const activeWorkspaceId = workspace ? workspaceIdForPath(workspace.path) : undefined;
  const CurrentWorkspaceIcon = isSettings
    ? SettingsIcon
    : workspace?.id === "today"
      ? todayWeatherIcon(currentWeather, user.planningTimezone)
      : (workspace?.icon ?? GridIcon);

  return (
    <ShadcnSidebarMenu>
      <ShadcnSidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ShadcnButton
              aria-label="Switch workspace"
              className={
                compact
                  ? "sidebar__workspace-trigger workspace-navigation-item"
                  : "sidebar__workspace-trigger w-full justify-start"
              }
              data-workspace={compact ? workspace?.id : undefined}
              data-active={compact ? "true" : undefined}
              size={compact ? "icon" : "default"}
              variant="secondary"
            >
              {compact ? (
                <CurrentWorkspaceIcon aria-hidden="true" weight="Filled" />
              ) : isSettings ? (
                <SettingsIcon aria-hidden="true" />
              ) : activeWorkspaceId ? (
                <WorkspaceIcon size="sm" workspace={activeWorkspaceId} />
              ) : workspace?.id === "today" ? (
                <TodayWorkspaceIcon timeZone={user.planningTimezone} weather={currentWeather} />
              ) : (
                <LogoMark compact />
              )}
              {!compact ? <span>{section}</span> : null}
              {!compact ? (
                <ChevronDownIcon aria-hidden="true" className="ml-auto" data-icon="inline-end" />
              ) : null}
            </ShadcnButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            aria-label="Switch workspace"
            className={compact ? "w-56" : "w-[--radix-popper-anchor-width]"}
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
            {onShowRail ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onShowRail}>Show workspace rail</DropdownMenuItem>
              </>
            ) : null}
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
  const { label, path } = item;
  const Icon = item.id === "today" ? todayWeatherIcon(weather, timeZone) : item.icon;
  const isActive = workspaceForPath(pathname)?.path === path;
  return (
    <DropdownMenuItem asChild>
      <Link
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
        className="workspace-navigation-item"
        data-workspace={item.id}
        data-active={isActive ? "true" : undefined}
        onClick={onNavigate}
        to={path}
      >
        <Icon aria-hidden="true" weight={isActive ? "Filled" : "Outline"} />
        <span>{label}</span>
      </Link>
    </DropdownMenuItem>
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
  brief: Pick<UseQueryResult<DailyBrief>, "data" | "error" | "isError" | "isPending" | "refetch">;
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
  if (brief.isError && !brief.data)
    return <InlineError error={brief.error} retry={brief.refetch} />;
  if (completedReminders.isError && !completedReminders.data)
    return <InlineError error={completedReminders.error} retry={completedReminders.refetch} />;
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
      <QueryFeedback query={brief} title="Couldn’t refresh today’s plan." staleOnly />
      <QueryFeedback
        query={completedReminders}
        title="Couldn’t refresh completed reminders."
        staleOnly
      />
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
      <SegmentedControl aria-label="Commitment filters" onValueChange={selectFilter} value={filter}>
        <SegmentedControlItem value="all">All</SegmentedControlItem>
        <SegmentedControlItem value="overdue">Overdue</SegmentedControlItem>
        <SegmentedControlItem value="tasks">Tasks</SegmentedControlItem>
        <SegmentedControlItem value="reminders">Reminders</SegmentedControlItem>
      </SegmentedControl>
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
  if (pathname === "/mail/review") return "Mail stewardship";
  if (pathname === "/mail") return "Mail";
  if (pathname === "/goals") return "Goals";
  if (pathname === "/motives") return "Motives";
  if (pathname === "/finances") return "Finances";
  if (pathname === "/finances/accounts") return "Accounts";
  if (pathname === "/finances/budgets" || pathname === "/finances/plan") return "Plan";
  if (pathname === "/finances/wealth") return "Wealth";
  if (pathname === "/finances/setup") return "Financial setup";
  if (pathname.startsWith("/finances/reviews/")) return "Financial review";
  if (pathname === "/finances/cashflow") return "Cash flow";
  if (pathname === "/finances/health") return "Ledger health";
  if (pathname === "/finances/imports") return "Import history";
  if (pathname === "/finances/review") return "Review";
  if (pathname === "/finances/review/legacy") return "Earlier transaction reviews";
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

const CalendarFeedbackRegion = createContext<HTMLElement | null>(null);

function CalendarContextFeedback({ children }: { children: ReactNode }) {
  const region = useContext(CalendarFeedbackRegion);
  return region ? createPortal(children, region) : null;
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
  const [feedbackRegion, setFeedbackRegion] = useState<HTMLDivElement | null>(null);
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
  const moveEvent = useFeedbackMutation({
    feedback: { action: "move this event", safeToRetry: true },
    mutationFn: async (input: CalendarEventMove) => {
      const times = movedEventTimes(input.event, input.day, input.minute, user.planningTimezone);
      return api.updateEvent(input.event.id, times);
    },
    onError: (_error, _input, context) => {
      if (context) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
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
          records.filter((event) => calendarEventOccursOnDay(event, day, startsAt, endsAt)),
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
    <CalendarFeedbackRegion value={feedbackRegion}>
      <div className="calendar-page">
        <div ref={setFeedbackRegion} data-calendar-feedback />
        <QueryFeedback query={events} title="Couldn’t refresh calendar events." staleOnly />
        <QueryFeedback query={calendars} title="Couldn’t load calendars." />
        <QueryFeedback query={connectorAccounts} title="Couldn’t load calendar accounts." />
        <MutationFeedback feedback={moveEvent.feedback} />
        {events.isPending ? (
          <PageLoading workspace="calendar" />
        ) : events.isError && !events.data ? (
          <InlineError
            error={events.error}
            title="Couldn’t load calendar events."
            retry={events.refetch}
          />
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
    </CalendarFeedbackRegion>
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
      {workspaceSwitcher ? (
        <div className="calendar-workspace-switcher">{workspaceSwitcher}</div>
      ) : null}
      <div className="calendar-app-bar__orientation">
        <h2>
          <span className="calendar-app-bar__title-full">{title}</span>
          <span aria-hidden="true" className="calendar-app-bar__title-compact">
            {compactTitle}
          </span>
        </h2>
      </div>
      <ReviewNavigation workspace="calendar" />
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
        <SegmentedControl
          aria-label="Calendar view: choose day, week, or month"
          className="calendar-app-bar__view-switch"
          data-view={view}
          onValueChange={(value) => {
            if (value === "day" || value === "week" || value === "month") {
              updateCalendarState({ view: value === defaultView ? null : value });
            }
          }}
          value={view}
        >
          {calendarViews.map((option) => {
            const Icon = option.icon;
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <SegmentedControlItem
                    aria-label={option.label}
                    className="calendar-app-bar__view-option"
                    value={option.value}
                  >
                    <Icon aria-hidden="true" data-icon="inline-start" />
                    <span className="calendar-app-bar__view-label">{option.label}</span>
                  </SegmentedControlItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Show {option.label.toLowerCase()} view
                </TooltipContent>
              </Tooltip>
            );
          })}
        </SegmentedControl>
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
  const attentionCount = enabledAccounts.filter(
    (account) => !["ready", "syncing"].includes(connectionHealth(account).state),
  ).length;
  const needsAttention = attentionCount > 0;
  const triggerLabel = `${label}${needsAttention ? ", attention required" : ""}`;
  return (
    <ShadcnPopover>
      <ShadcnPopoverTrigger asChild>
        <AccountSelectionTrigger
          ariaLabel={triggerLabel}
          className="calendar-accounts-trigger"
          disabled={accounts.isPending || records.length === 0}
          identities={enabledAccounts.map((account) => ({
            avatarUrl: account.avatarUrl,
            fallback: initials(account.label ?? account.email ?? account.provider),
            id: account.id,
          }))}
          needsAttention={needsAttention}
          selectedCount={selectedCount}
          totalCount={records.length}
        />
      </ShadcnPopoverTrigger>
      <AccountSelectionPopoverContent
        className="calendar-accounts-popover"
        description={label}
        primaryAction={
          needsAttention ? (
            <ShadcnButton asChild className="w-full">
              <Link to="/settings?section=connections">
                {reconnectAccountsLabel(attentionCount)}
              </Link>
            </ShadcnButton>
          ) : null
        }
        title="Calendars"
      >
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
      </AccountSelectionPopoverContent>
    </ShadcnPopover>
  );
}

function CalendarVisibilitySwitch({ calendar }: { calendar: Calendar }) {
  const queryClient = useQueryClient();
  const mutation = useFeedbackMutation<Calendar, Error, boolean, { previous: Calendar[] }>({
    feedback: { action: "change calendar visibility", safeToRetry: true },
    mutationFn: (selected) => api.setCalendarSelected(calendar.id, selected),
    onError: (_error, _selected, context) => {
      if (context) queryClient.setQueryData(calendarQueryKeys.calendars, context.previous);
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
    <>
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
      <MutationFeedback feedback={mutation.feedback} />
    </>
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
        placement="inline"
        data-calendar-axis="top"
        className="calendar-secondary-app-bar calendar-secondary-app-bar--day"
      >
        <WorkspaceSecondaryAppBarContent>
          <div className="calendar-all-day-grid">
            <span className="week-time-corner" data-calendar-axis="corner">
              All day
            </span>
            <CalendarAllDayEvents
              calendarsById={calendarsById}
              days={[day]}
              highlightToday={false}
              layouts={positionCalendarAllDayEvents(
                [day],
                new Map([[localDateKey(day), allDayEvents]]),
              )}
              setEditor={setEditor}
              today={today}
            />
          </div>
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
                <TimelineEventCollection
                  calendarsById={calendarsById}
                  draggedEventId={draggedEventId}
                  layouts={timelineEvents}
                  onDragEnd={clearDrag}
                  setDraggedEventId={setDraggedEventId}
                  setEditor={setEditor}
                  timeZone={timeZone}
                />
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
  const allDayLayouts = useMemo(
    () => positionCalendarAllDayEvents(days, eventsByDay),
    [days, eventsByDay],
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
          gridTemplateColumns: `var(--calendar-time-gutter-width) repeat(${days.length}, minmax(140px, 1fr))`,
          minWidth: 56 + days.length * 140,
        }}
      >
        <WorkspaceSecondaryAppBar
          aria-label="Calendar week navigation"
          placement="inline"
          className="calendar-secondary-app-bar calendar-secondary-app-bar--week"
        >
          <WorkspaceSecondaryAppBarContent
            className="calendar-secondary-app-bar__week-grid"
            style={{
              gridTemplateColumns: `var(--calendar-time-gutter-width) repeat(${days.length}, minmax(140px, 1fr))`,
            }}
          >
            <div data-calendar-axis="corner" className="week-time-corner">
              All day
            </div>
            <div aria-hidden="true" data-calendar-axis="corner" className="week-all-day-corner" />
            {days.map((day) => {
              const isToday = sameLocalDate(day, today);
              return (
                <header
                  data-calendar-axis="top"
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
                </header>
              );
            })}
            <CalendarAllDayEvents
              calendarsById={calendarsById}
              days={days}
              layouts={allDayLayouts}
              setEditor={setEditor}
              today={today}
            />
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
              <TimelineEventCollection
                calendarsById={calendarsById}
                compact
                draggedEventId={draggedEventId}
                layouts={layouts}
                onDragEnd={clearDrag}
                {...(dayIndex === 0
                  ? { orbitHorizontalInset: "start" as const }
                  : dayIndex === days.length - 1
                    ? { orbitHorizontalInset: "end" as const }
                    : {})}
                setDraggedEventId={setDraggedEventId}
                setEditor={setEditor}
                timeZone={timeZone}
              />
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

type TimelineEventCluster = {
  endMinute: number;
  layouts: TimelineEventLayout[];
  startMinute: number;
};

function groupTimelineEventLayouts(layouts: TimelineEventLayout[]): TimelineEventCluster[] {
  const clusters: TimelineEventCluster[] = [];
  for (const layout of layouts) {
    const cluster = clusters.at(-1);
    if (!cluster || layout.startMinute >= cluster.endMinute) {
      clusters.push({
        endMinute: layout.endMinute,
        layouts: [layout],
        startMinute: layout.startMinute,
      });
      continue;
    }
    cluster.layouts.push(layout);
    cluster.endMinute = Math.max(cluster.endMinute, layout.endMinute);
  }
  return clusters;
}

function TimeAxis() {
  return (
    <ol
      aria-hidden="true"
      data-calendar-axis="left"
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
          ? `calc(var(--calendar-time-gutter-width) + ${spanColumns * 100}% + ${Math.max(0, spanColumns - 1)}px)`
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
    if (
      (event.target as Element).closest(
        ".calendar-timeline-event, .calendar-overlap-cluster__toggle",
      )
    ) {
      return;
    }
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

export function calendarEventOccursOnDay(
  event: CalendarEvent,
  day: LocalDate,
  dayStartsAt: number,
  dayEndsAt: number,
) {
  if (event.allDay && event.provider !== "local") {
    const date = localDateKey(day);
    return date >= event.startsAt.slice(0, 10) && date < event.endsAt.slice(0, 10);
  }
  return (
    new Date(event.startsAt).getTime() < dayEndsAt && new Date(event.endsAt).getTime() > dayStartsAt
  );
}

export function overlapOrbitPoint(
  index: number,
  total: number,
  compact: boolean,
  bounds?: {
    clusterEndMinute: number;
    clusterStartMinute: number;
    eventEndMinute: number;
    eventStartMinute: number;
    horizontalInset?: "end" | "start";
  },
) {
  const pointAt = (pointIndex: number) => {
    if (total === 2) {
      const offset = compact ? 52 : 76;
      return {
        rotation: pointIndex === 0 ? -4 : 4,
        x: pointIndex === 0 ? -offset : offset,
        y: 0,
      };
    }
    const radius = compact ? Math.min(64, 40 + total * 4) : Math.min(92, 58 + total * 6);
    const angle = Math.PI + (pointIndex * Math.PI * 2) / total;
    return {
      rotation: Math.round(Math.sin(angle) * 8),
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    };
  };
  const point = pointAt(index);
  if (!bounds) return point;
  const orbitXs = Array.from({ length: total }, (_, pointIndex) => pointAt(pointIndex).x);
  if (bounds.horizontalInset === "start") {
    point.x -= Math.min(...orbitXs, 0);
  } else if (bounds.horizontalInset === "end") {
    point.x -= Math.max(...orbitXs, 0);
  }
  const eventHeight = Math.max(
    minuteToTimelinePixels(bounds.eventEndMinute - bounds.eventStartMinute),
    18,
  );
  const maximumEventWidth = compact ? 160 : 320;
  const rotationRadians = (Math.abs(point.rotation) * Math.PI) / 180;
  const transformedEventHeight =
    eventHeight * Math.cos(rotationRadians) + maximumEventWidth * Math.sin(rotationRadians);
  const clusterHeight = Math.max(
    minuteToTimelinePixels(bounds.clusterEndMinute - bounds.clusterStartMinute),
    48,
  );
  const center = minuteToTimelinePixels(bounds.clusterStartMinute) + clusterHeight / 2;
  const minimumY = transformedEventHeight / 2 - center;
  const maximumY = calendarTimelineHeight - transformedEventHeight / 2 - center;
  const clampedY = Math.round(Math.min(maximumY, Math.max(minimumY, point.y)));
  return {
    ...point,
    rotation: point.rotation,
    y: clampedY || 0,
  };
}

export function overlapPinOffset(clusterStartMinute: number, clusterEndMinute: number) {
  const clusterTop = minuteToTimelinePixels(clusterStartMinute);
  const clusterHeight = Math.max(minuteToTimelinePixels(clusterEndMinute - clusterStartMinute), 48);
  const desiredTop = clusterTop + clusterHeight / 2 - 15;
  const clampedTop = Math.min(calendarTimelineHeight - 30, Math.max(0, desiredTop));
  return Math.round(clampedTop - desiredTop);
}

function TimelineEventCollection({
  calendarsById,
  compact = false,
  draggedEventId,
  layouts,
  onDragEnd,
  orbitHorizontalInset,
  setDraggedEventId,
  setEditor,
  timeZone,
}: {
  calendarsById: CalendarMap;
  compact?: boolean;
  draggedEventId: string | null;
  layouts: TimelineEventLayout[];
  onDragEnd: () => void;
  orbitHorizontalInset?: "end" | "start";
  setDraggedEventId: (id: string | null) => void;
  setEditor: (editor: Editor) => void;
  timeZone: string;
}) {
  return groupTimelineEventLayouts(layouts).map((cluster) => {
    const shared = {
      calendarsById,
      compact,
      draggedEventId,
      onDragEnd,
      ...(orbitHorizontalInset ? { orbitHorizontalInset } : {}),
      setDraggedEventId,
      setEditor,
      timeZone,
    };
    if (cluster.layouts.length === 1) {
      const layout = cluster.layouts[0] as TimelineEventLayout;
      return <TimelineEventItem {...shared} key={layout.event.id} layout={layout} />;
    }
    return (
      <TimelineOverlapCluster
        {...shared}
        cluster={cluster}
        key={cluster.layouts.map((layout) => layout.event.id).join(":")}
      />
    );
  });
}

function TimelineEventItem({
  calendarsById,
  compact,
  draggedEventId,
  layout,
  onDragEnd,
  orbit,
  setDraggedEventId,
  setEditor,
  timeZone,
  topOffsetMinute,
}: {
  calendarsById: CalendarMap;
  compact: boolean;
  draggedEventId: string | null;
  layout: TimelineEventLayout;
  onDragEnd: () => void;
  orbit?: {
    clusterEndMinute: number;
    clusterStartMinute: number;
    horizontalInset?: "end" | "start";
    index: number;
    total: number;
  };
  setDraggedEventId: (id: string | null) => void;
  setEditor: (editor: Editor) => void;
  timeZone: string;
  topOffsetMinute?: number;
}) {
  return (
    <TimelineEvent
      blockColors={eventBlockColors(layout.event, calendarsById)}
      calendar={calendarsById.get(layout.event.calendarId)}
      compact={compact}
      isDragging={draggedEventId === layout.event.id}
      layout={layout}
      onEdit={() => setEditor({ event: layout.event, kind: "event" })}
      onDragEnd={onDragEnd}
      setDraggedEventId={setDraggedEventId}
      timeZone={timeZone}
      {...(orbit ? { orbit } : {})}
      {...(topOffsetMinute === undefined ? {} : { topOffsetMinute })}
    />
  );
}

function TimelineOverlapCluster({
  calendarsById,
  cluster,
  compact,
  draggedEventId,
  onDragEnd,
  orbitHorizontalInset,
  setDraggedEventId,
  setEditor,
  timeZone,
}: {
  calendarsById: CalendarMap;
  cluster: TimelineEventCluster;
  compact: boolean;
  draggedEventId: string | null;
  onDragEnd: () => void;
  orbitHorizontalInset?: "end" | "start";
  setDraggedEventId: (id: string | null) => void;
  setEditor: (editor: Editor) => void;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hoverLeaveTimer = useRef<number | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const clusterId = useId();
  const count = cluster.layouts.length;
  // Keep the hover envelope fixed while cards animate between their resting and
  // spread positions. Include rotated card bounds and the toggle, not just gaps.
  const hoverBounds = cluster.layouts.map((layout, index) => {
    const point = overlapOrbitPoint(index, count, compact, {
      clusterEndMinute: cluster.endMinute,
      clusterStartMinute: cluster.startMinute,
      eventEndMinute: layout.endMinute,
      eventStartMinute: layout.startMinute,
      ...(orbitHorizontalInset ? { horizontalInset: orbitHorizontalInset } : {}),
    });
    const angle = (Math.abs(point.rotation) * Math.PI) / 180;
    const height = Math.max(minuteToTimelinePixels(layout.endMinute - layout.startMinute), 18);
    const width = compact ? 160 : 320;
    const halfWidth = (width * Math.cos(angle) + height * Math.sin(angle)) / 2 + 12;
    const halfHeight = (height * Math.cos(angle) + width * Math.sin(angle)) / 2 + 12;
    return {
      left: point.x - halfWidth,
      right: point.x + halfWidth,
      top: point.y - halfHeight,
      bottom: point.y + halfHeight,
    };
  });
  useEffect(
    () => () => {
      if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
    },
    [],
  );
  return (
    <fieldset
      aria-label={`${count} overlapping events`}
      className={`calendar-overlap-cluster${expanded ? " is-expanded" : ""}${hovered ? " is-hovered" : ""}`}
      id={clusterId}
      onKeyDown={(event) => {
        const focusedEvent = (event.target as Element).closest(".calendar-timeline-event");
        if (event.key !== "Escape" || (!expanded && !hovered && !focusedEvent)) return;
        event.stopPropagation();
        setExpanded(false);
        setHovered(false);
        toggle.current?.focus();
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
        hoverLeaveTimer.current = null;
        setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
        hoverLeaveTimer.current = window.setTimeout(() => {
          setHovered(false);
          hoverLeaveTimer.current = null;
        }, 160);
      }}
      style={
        {
          height: Math.max(minuteToTimelinePixels(cluster.endMinute - cluster.startMinute), 48),
          top: minuteToTimelinePixels(cluster.startMinute),
          "--overlap-hit-left": `${Math.min(...hoverBounds.map((bounds) => bounds.left))}px`,
          "--overlap-hit-right": `${-Math.max(...hoverBounds.map((bounds) => bounds.right))}px`,
          "--overlap-hit-top": `${Math.min(...hoverBounds.map((bounds) => bounds.top))}px`,
          "--overlap-hit-bottom": `${-Math.max(...hoverBounds.map((bounds) => bounds.bottom))}px`,
          "--overlap-pin-y": `${overlapPinOffset(cluster.startMinute, cluster.endMinute)}px`,
          "--overlap-front-layer": count + 3,
          "--overlap-control-layer": count + 4,
        } as CSSProperties
      }
    >
      <button
        aria-controls={clusterId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Spread"} ${count} overlapping events`}
        className="calendar-overlap-cluster__toggle"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        ref={toggle}
        type="button"
      >
        <LayersIcon aria-hidden="true" />
        <span>{count}</span>
      </button>
      {cluster.layouts.map((layout, index) => (
        <TimelineEventItem
          calendarsById={calendarsById}
          compact={compact}
          draggedEventId={draggedEventId}
          key={layout.event.id}
          layout={layout}
          onDragEnd={onDragEnd}
          orbit={{
            clusterEndMinute: cluster.endMinute,
            clusterStartMinute: cluster.startMinute,
            index,
            total: count,
            ...(orbitHorizontalInset ? { horizontalInset: orbitHorizontalInset } : {}),
          }}
          setDraggedEventId={setDraggedEventId}
          setEditor={setEditor}
          timeZone={timeZone}
          topOffsetMinute={cluster.startMinute}
        />
      ))}
    </fieldset>
  );
}

function TimelineEvent({
  blockColors,
  calendar,
  compact = false,
  layout,
  onEdit,
  onDragEnd,
  orbit,
  setDraggedEventId,
  isDragging = false,
  timeZone,
  topOffsetMinute = 0,
}: {
  blockColors: EventBlockColor[];
  calendar: Calendar | undefined;
  compact?: boolean;
  layout: TimelineEventLayout;
  onEdit: () => void;
  onDragEnd: () => void;
  orbit?: {
    clusterEndMinute: number;
    clusterStartMinute: number;
    horizontalInset?: "end" | "start";
    index: number;
    total: number;
  };
  setDraggedEventId: (id: string | null) => void;
  isDragging?: boolean;
  timeZone: string;
  topOffsetMinute?: number;
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
  const orbitPoint = orbit
    ? overlapOrbitPoint(orbit.index, orbit.total, compact, {
        clusterEndMinute: orbit.clusterEndMinute,
        clusterStartMinute: orbit.clusterStartMinute,
        eventEndMinute: endMinute,
        eventStartMinute: startMinute,
        ...(orbit.horizontalInset ? { horizontalInset: orbit.horizontalInset } : {}),
      })
    : null;
  const laneCount = orbit ? Math.max(layout.columns, 1) : 1;
  const stackInset = orbit && laneCount === 1 ? Math.min(orbit.index * 4, 16) : 0;
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
        style={
          {
            ...calendarEventColorStyle(calendar?.color),
            "--calendar-event-height": `${Math.max(minuteToTimelinePixels(endMinute - startMinute), 18)}px`,
            "--calendar-event-left": orbit
              ? `calc(${(column / laneCount) * 100}% + ${2 + stackInset}px)`
              : `${3 + column * 12}px`,
            "--calendar-event-top": `${minuteToTimelinePixels(startMinute - topOffsetMinute)}px`,
            "--calendar-event-width": orbit
              ? `calc(${100 / laneCount}% - ${4 + stackInset}px)`
              : `calc(100% - ${6 + column * 12}px)`,
            "--overlap-orbit-rotation": `${orbitPoint?.rotation ?? 0}deg`,
            "--overlap-orbit-width": compact
              ? `clamp(88px, calc(100% - ${Math.abs(orbitPoint?.x ?? 0) * 2 + 6}px), 160px)`
              : `min(320px, calc(100% - ${Math.abs(orbitPoint?.x ?? 0) * 2 + 6}px))`,
            "--overlap-orbit-x": `${orbitPoint?.x ?? 0}px`,
            "--overlap-orbit-y": `${orbitPoint?.y ?? 0}px`,
            zIndex: 2 + (orbit?.index ?? column),
          } as CSSProperties
        }
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
  const paste = useFeedbackMutation({
    feedback: { action: "paste this event" },
    mutationFn: async () => {
      let event: CalendarEvent | undefined;
      try {
        event = parseClipboardCalendarEvent(await navigator.clipboard.readText());
      } catch {
        toast.error("Couldn’t read the clipboard. Check clipboard access and try again.", {
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      }
      if (
        !event ||
        !Number.isFinite(Date.parse(event.startsAt)) ||
        !Number.isFinite(Date.parse(event.endsAt))
      ) {
        toast.error("Copy an event from nohmi before pasting it here.", {
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      }
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
    <>
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
      <CalendarContextFeedback>
        <MutationFeedback feedback={paste.feedback} />
      </CalendarContextFeedback>
    </>
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
  const { confirm, confirmation } = useConfirmAction();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const canCopy = typeof navigator.clipboard?.writeText === "function";
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const writable = calendar?.isWritable ?? false;
  const destinations = (calendars.data ?? []).filter(
    (candidate) =>
      !(event.sourceCalendarIds ?? [event.calendarId]).includes(candidate.id) &&
      !event.blocks.some((eventBlock) => eventBlock.calendarId === candidate.id) &&
      candidate.isWritable,
  );
  const remove = useFeedbackMutation({
    feedback: { action: "delete this event", safeToRetry: false },
    mutationFn: () => api.deleteEvent(event.id),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const duplicate = useFeedbackMutation({
    feedback: { action: "duplicate this event" },
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
  const block = useFeedbackMutation({
    feedback: { action: "block this time" },
    mutationFn: (calendarId: string) =>
      api.createEventBlock(event.id, { calendarId, mode: "busy" }),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event));
      toast.success("Event copied.");
      return true;
    } catch {
      toast.error("Couldn’t copy this event. Check clipboard access and try again.", {
        duration: Number.POSITIVE_INFINITY,
      });
      return false;
    }
  };
  const cut = async () => {
    if (await copy())
      confirm({
        title: "Cut event?",
        returnFocus: triggerRef.current,
        description: "The event is copied. Cutting deletes the original from its calendar.",
        actionLabel: "Cut event",
        onConfirm: () => remove.mutate(),
      });
  };
  const trigger = (
    <ContextMenuTrigger ref={triggerRef} asChild>
      {children}
    </ContextMenuTrigger>
  );
  return (
    <>
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
            onSelect={() =>
              confirm({
                title: "Delete event?",
                description: "This permanently deletes the event from its calendar.",
                actionLabel: "Delete event",
                onConfirm: () => remove.mutate(),
              })
            }
            variant="destructive"
          >
            <TrashIcon aria-hidden="true" /> Delete event
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CalendarContextFeedback>
        <MutationFeedback feedback={remove.feedback} />
        <MutationFeedback feedback={duplicate.feedback} />
        <MutationFeedback feedback={block.feedback} />
      </CalendarContextFeedback>
      {confirmation}
    </>
  );
}

type CalendarAllDayEventLayout = {
  endColumn: number;
  event: CalendarEvent;
  row: number;
  startColumn: number;
};

function positionCalendarAllDayEvents(
  days: LocalDate[],
  eventsByDay: Map<string, CalendarEvent[]>,
): CalendarAllDayEventLayout[] {
  const spans = new Map<string, Omit<CalendarAllDayEventLayout, "row">>();
  days.forEach((day, dayIndex) => {
    for (const event of eventsByDay.get(localDateKey(day)) ?? []) {
      if (!event.allDay) continue;
      const current = spans.get(event.id);
      spans.set(event.id, {
        endColumn: dayIndex + 2,
        event,
        startColumn: current?.startColumn ?? dayIndex + 1,
      });
    }
  });
  const rowEnds: number[] = [];
  return [...spans.values()]
    .sort(
      (left, right) =>
        left.startColumn - right.startColumn ||
        right.endColumn - right.startColumn - (left.endColumn - left.startColumn),
    )
    .map((span) => {
      let row = rowEnds.findIndex((endColumn) => endColumn <= span.startColumn);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = span.endColumn;
      return { ...span, row: row + 1 };
    });
}

function weekDaySurface(dayIndex: number, isToday: boolean) {
  if (isToday) {
    return "var(--calendar-today-background)";
  }
  return dayIndex % 2 === 0 ? "var(--background)" : "var(--calendar-tile-background)";
}

function CalendarAllDayEvents({
  calendarsById,
  days,
  layouts,
  highlightToday = true,
  setEditor,
  today,
}: {
  calendarsById: CalendarMap;
  days: LocalDate[];
  layouts: CalendarAllDayEventLayout[];
  highlightToday?: boolean;
  setEditor: (editor: Editor) => void;
  today: LocalDate;
}) {
  const rowCount = Math.max(0, ...layouts.map((layout) => layout.row));
  const isEmpty = rowCount === 0;
  return (
    <div
      className={`week-all-day-layer${isEmpty ? " is-empty" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gridTemplateRows: isEmpty ? "0px" : `repeat(${rowCount}, 28px)`,
        paddingBottom: isEmpty ? 0 : undefined,
      }}
    >
      {days.map((day, dayIndex) => (
        <div
          aria-hidden="true"
          className={`week-all-day-day${highlightToday && sameLocalDate(day, today) ? " is-today" : ""}`}
          key={`all-day-surface-${localDateKey(day)}`}
          style={
            {
              "--week-day-surface": highlightToday
                ? weekDaySurface(dayIndex, sameLocalDate(day, today))
                : "var(--background)",
              gridColumn: dayIndex + 1,
              gridRow: `1 / span ${Math.max(rowCount, 1)}`,
            } as CSSProperties
          }
        />
      ))}
      {layouts.map((layout) => {
        const startIndex = layout.startColumn - 1;
        const endIndex = layout.endColumn - 2;
        const startDay = days[startIndex] as LocalDate;
        const endDay = days[endIndex] as LocalDate;
        const accessibleStart = formatLocalDate(startDay, {
          day: "numeric",
          month: "long",
          weekday: "long",
        });
        const accessibleEnd = formatLocalDate(endDay, {
          day: "numeric",
          month: "long",
          weekday: "long",
        });
        const accessibleDate = sameLocalDate(startDay, endDay)
          ? accessibleStart
          : `${accessibleStart} through ${accessibleEnd}`;
        const eventStyle = calendarEventColorStyle(
          calendarsById.get(layout.event.calendarId)?.color,
        );
        return (
          <button
            aria-label={`All day ${layout.event.title}, ${accessibleDate}`}
            className="week-all-day-event"
            key={layout.event.id}
            onClick={() => setEditor({ event: layout.event, kind: "event" })}
            style={
              {
                ...eventStyle,
                gridColumn: `${layout.startColumn} / ${layout.endColumn}`,
                gridRow: layout.row,
              } as CSSProperties
            }
            type="button"
          >
            <span>{layout.event.title}</span>
            {layout.event.blocks.length > 0 ? (
              <LockIcon aria-label="Blocks another calendar" className="linked-block-icon" />
            ) : null}
          </button>
        );
      })}
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
        placement="inline"
        data-calendar-axis="top"
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
  const { confirm, confirmation } = useConfirmAction();
  const queryClient = useQueryClient();
  const goals = useQuery({ queryFn: api.listGoals, queryKey: ["goals"] });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["goals"] });
  const create = useFeedbackMutation({
    feedback: { action: "create this goal", form: true },
    mutationFn: () =>
      api.createGoal({
        description: description.trim() || null,
        progress: 0,
        targetDate: targetDate || null,
        title: title.trim(),
      }),
    onSuccess: () => {
      setCreating(false);
      setTitle("");
      setDescription("");
      setTargetDate("");
      return refresh();
    },
  });
  const update = useFeedbackMutation({
    feedback: { action: "update this goal", safeToRetry: true },
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateGoal>[1] }) =>
      api.updateGoal(id, input),
    onSuccess: refresh,
  });
  const remove = useFeedbackMutation({
    feedback: { action: "delete this goal", safeToRetry: false },
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: refresh,
  });
  if (goals.isPending) return <PageLoading />;
  if (goals.isError && !goals.data)
    return <InlineError error={goals.error} retry={goals.refetch} />;
  return (
    <div className="settings-stack">
      <QueryFeedback query={goals} title="Couldn’t refresh goals." staleOnly />
      <Dialog open={creating} onOpenChange={setCreating}>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Active outcomes</ShadcnCardTitle>
            <ShadcnCardAction>
              <DialogTrigger asChild>
                <SettingsRecordAction label="Add goal">
                  <PlusIcon />
                </SettingsRecordAction>
              </DialogTrigger>
            </ShadcnCardAction>
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
                    onDelete={() =>
                      confirm({
                        title: "Delete goal?",
                        description: "This permanently deletes the goal.",
                        actionLabel: "Delete goal",
                        onConfirm: () => remove.mutate(goal.id),
                      })
                    }
                    onUpdate={(input) => update.mutate({ id: goal.id, input })}
                    pending={update.isPending || remove.isPending}
                  />
                ))}
              </ShadcnItemGroup>
            )}
          </ShadcnCardContent>
        </ShadcnCard>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New goal</DialogTitle>
            <DialogDescription>Describe the outcome, not a long task list.</DialogDescription>
          </DialogHeader>
          <FeedbackForm
            feedback={create.feedback}
            validate={() => (title.trim() ? {} : { title: "Enter a goal." })}
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <ShadcnFieldGroup>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="goal-title">Outcome</ShadcnFieldLabel>
                <ShadcnInput
                  id="goal-title"
                  name="title"
                  required
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
                  name="description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional context for you and authorized agents"
                  value={description}
                />
              </ShadcnField>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="goal-target-date">Target date</ShadcnFieldLabel>
                <DateInput
                  id="goal-target-date"
                  name="targetDate"
                  onValueChange={setTargetDate}
                  value={targetDate}
                />
              </ShadcnField>
              <ShadcnButton disabled={create.isPending} type="submit">
                <TargetIcon data-icon="inline-start" />
                Create goal
              </ShadcnButton>
            </ShadcnFieldGroup>
          </FeedbackForm>
        </DialogContent>
      </Dialog>

      <MutationFeedback feedback={update.feedback} />
      <MutationFeedback feedback={remove.feedback} />
      {confirmation}
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
    <SettingsRecord
      title={goal.title}
      description={goal.description ?? "No supporting context yet."}
      actions={
        <>
          <SettingsRecordAction
            label={goal.status === "paused" ? "Resume" : "Pause"}
            disabled={pending}
            onClick={() => onUpdate({ status: goal.status === "paused" ? "active" : "paused" })}
          >
            {goal.status === "paused" ? <PlayIcon /> : <PauseIcon />}
          </SettingsRecordAction>
          <SettingsRecordAction
            label={`Remove ${goal.title}`}
            disabled={pending}
            onClick={onDelete}
          >
            <TrashIcon />
          </SettingsRecordAction>
        </>
      }
      metadata={
        <>
          <ShadcnBadge variant="secondary">
            {goal.status.charAt(0).toUpperCase() + goal.status.slice(1)}
          </ShadcnBadge>
          <ShadcnBadge asChild variant="secondary">
            <button
              type="button"
              title="Advance progress by 10%"
              disabled={pending}
              onClick={() =>
                onUpdate({
                  progress: Math.min(100, goal.progress + 10),
                  ...(goal.progress >= 90 ? { status: "completed" } : {}),
                })
              }
            >
              {goal.progress}%
            </button>
          </ShadcnBadge>
          {goal.targetDate ? (
            <span>
              Target <time dateTime={goal.targetDate}>{formatCalendarDate(goal.targetDate)}</time>
            </span>
          ) : null}
        </>
      }
    />
  );
}

function MotivesPage() {
  const { confirm, confirmation } = useConfirmAction();
  const queryClient = useQueryClient();
  const motives = useQuery({ queryFn: api.listMotives, queryKey: ["motives"] });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["motives"] });
  const create = useFeedbackMutation({
    feedback: { action: "create this motive", form: true },
    mutationFn: () => api.createMotive({ detail: detail.trim() || null, title: title.trim() }),
    onSuccess: () => {
      setCreating(false);
      setTitle("");
      setDetail("");
      return refresh();
    },
  });
  const update = useFeedbackMutation({
    feedback: { action: "update this motive", safeToRetry: true },
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateMotive>[1] }) =>
      api.updateMotive(id, input),
    onSuccess: refresh,
  });
  const remove = useFeedbackMutation({
    feedback: { action: "delete this motive", safeToRetry: false },
    mutationFn: (id: string) => api.deleteMotive(id),
    onSuccess: refresh,
  });
  if (motives.isPending) return <PageLoading />;
  if (motives.isError && !motives.data)
    return <InlineError error={motives.error} retry={motives.refetch} />;
  return (
    <div className="settings-stack">
      <QueryFeedback query={motives} title="Couldn’t refresh motives." staleOnly />
      <Dialog open={creating} onOpenChange={setCreating}>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Decision context</ShadcnCardTitle>
            <ShadcnCardAction>
              <DialogTrigger asChild>
                <SettingsRecordAction label="Add motive">
                  <PlusIcon />
                </SettingsRecordAction>
              </DialogTrigger>
            </ShadcnCardAction>
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
                  <SettingsRecord
                    key={motive.id}
                    title={motive.title}
                    description={motive.detail ?? "No additional context."}
                    metadata={
                      <ShadcnBadge variant="secondary">
                        {motive.isActive ? "Active" : "Paused"}
                      </ShadcnBadge>
                    }
                    actions={
                      <>
                        <SettingsRecordAction
                          label={motive.isActive ? "Pause" : "Resume"}
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({ id: motive.id, input: { isActive: !motive.isActive } })
                          }
                        >
                          {motive.isActive ? <PauseIcon /> : <PlayIcon />}
                        </SettingsRecordAction>
                        <SettingsRecordAction
                          label={`Remove ${motive.title}`}
                          disabled={remove.isPending}
                          onClick={() =>
                            confirm({
                              title: "Delete motive?",
                              description: "This permanently deletes the motive.",
                              actionLabel: "Delete motive",
                              onConfirm: () => remove.mutate(motive.id),
                            })
                          }
                        >
                          <TrashIcon />
                        </SettingsRecordAction>
                      </>
                    }
                  />
                ))}
              </ShadcnItemGroup>
            )}
          </ShadcnCardContent>
        </ShadcnCard>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New motive</DialogTitle>
            <DialogDescription>Use a value, identity, or reason—not a task.</DialogDescription>
          </DialogHeader>
          <FeedbackForm
            feedback={create.feedback}
            validate={() => (title.trim() ? {} : { title: "Enter a motive." })}
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <ShadcnFieldGroup>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="motive-title">Motive</ShadcnFieldLabel>
                <ShadcnInput
                  id="motive-title"
                  name="title"
                  required
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Protect focused time"
                  value={title}
                />
              </ShadcnField>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="motive-detail">Context</ShadcnFieldLabel>
                <ShadcnTextarea
                  id="motive-detail"
                  name="detail"
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder="Optional explanation for future decisions"
                  value={detail}
                />
              </ShadcnField>
              <ShadcnButton disabled={create.isPending} type="submit">
                <CompassIcon data-icon="inline-start" />
                Create motive
              </ShadcnButton>
            </ShadcnFieldGroup>
          </FeedbackForm>
        </DialogContent>
      </Dialog>

      <MutationFeedback feedback={update.feedback} />
      <MutationFeedback feedback={remove.feedback} />
      {confirmation}
    </div>
  );
}

function MailAppBarControls() {
  const [params, setParams] = useSearchParams();
  return (
    <div className="mail-app-bar__controls">
      <MailTopbarSearch
        onSearch={(query) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            query ? next.set("q", query) : next.delete("q");
            next.delete("thread");
            return next;
          })
        }
        search={params.get("q")?.trim() ?? ""}
      />
      <MailSyncButton />
    </div>
  );
}

function MailAccountsControl() {
  const [params, setParams] = useSearchParams();
  const accounts = useQuery({
    queryFn: api.listConnectors,
    queryKey: ["connectors"],
    refetchInterval: visibleConnectorRefreshInterval,
  });
  const enabledAccounts = (accounts.data ?? []).filter((account) => account.mailEnabled);
  const availableIds = new Set(enabledAccounts.map((account) => account.id));
  const requestedIds = params.getAll("account").filter((id) => availableIds.has(id));
  const selectedIds = requestedIds.length
    ? new Set(requestedIds)
    : new Set(enabledAccounts.map((account) => account.id));
  const label = `${selectedIds.size} of ${enabledAccounts.length} mail accounts`;
  const attentionCount = enabledAccounts.filter(
    (account) => !["ready", "syncing"].includes(connectionHealth(account).state),
  ).length;
  const needsAttention = attentionCount > 0;
  const triggerLabel = accounts.isPending
    ? "Loading mail accounts"
    : `${label}${needsAttention ? ", attention required" : ""}`;
  const setAccountVisible = (accountId: string, visible: boolean) => {
    const nextIds = new Set(selectedIds);
    visible ? nextIds.add(accountId) : nextIds.delete(accountId);
    if (nextIds.size === 0) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("account");
      next.delete("mailbox");
      next.delete("thread");
      if (nextIds.size !== enabledAccounts.length) {
        for (const id of enabledAccounts.map((account) => account.id)) {
          if (nextIds.has(id)) next.append("account", id);
        }
      }
      return next;
    });
  };

  return (
    <ShadcnPopover>
      <ShadcnPopoverTrigger asChild>
        <AccountSelectionTrigger
          ariaLabel={triggerLabel}
          className="mail-accounts-trigger"
          disabled={accounts.isPending || enabledAccounts.length === 0}
          identities={enabledAccounts.map((account) => ({
            avatarUrl: account.avatarUrl,
            fallback: initials(account.label || account.email || account.provider),
            id: account.id,
          }))}
          needsAttention={needsAttention}
          selectedCount={selectedIds.size}
          totalCount={enabledAccounts.length}
        />
      </ShadcnPopoverTrigger>
      <AccountSelectionPopoverContent
        className="mail-accounts-popover"
        description={label}
        primaryAction={
          needsAttention ? (
            <ShadcnButton asChild className="w-full">
              <Link to="/settings?section=connections">
                {reconnectAccountsLabel(attentionCount)}
              </Link>
            </ShadcnButton>
          ) : null
        }
        title="Mail accounts"
      >
        <ShadcnFieldGroup className="mail-accounts-popover__list">
          {enabledAccounts.map((account) => {
            const health = connectionHealth(account);
            const accountLabel = account.label || account.email || "Connected account";
            const selected = selectedIds.has(account.id);
            return (
              <ShadcnField
                className="mail-account-visibility"
                key={account.id}
                orientation="horizontal"
              >
                <ShadcnCheckbox
                  aria-label={`${selected ? "Hide" : "Show"} ${accountLabel}`}
                  checked={selected}
                  disabled={selected && selectedIds.size === 1}
                  id={`mail-account-${account.id}`}
                  onCheckedChange={(checked) => setAccountVisible(account.id, checked === true)}
                />
                <ShadcnFieldLabel htmlFor={`mail-account-${account.id}`}>
                  <ShadcnAvatar size="sm">
                    {account.avatarUrl ? (
                      <ShadcnAvatarImage alt="" src={account.avatarUrl} />
                    ) : null}
                    <ShadcnAvatarFallback>{initials(accountLabel)}</ShadcnAvatarFallback>
                  </ShadcnAvatar>
                  <span className="mail-account-visibility__copy">
                    <strong>{accountLabel}</strong>
                    <small>
                      {account.email || brandTitle(account.provider) || account.provider}
                    </small>
                  </span>
                </ShadcnFieldLabel>
                <MailAccountHealthIndicator
                  accountLabel={brandTitle(account.provider) || accountLabel}
                  health={health}
                />
              </ShadcnField>
            );
          })}
        </ShadcnFieldGroup>
      </AccountSelectionPopoverContent>
    </ShadcnPopover>
  );
}

function MailAccountHealthIndicator({
  accountLabel,
  health,
}: {
  accountLabel: string;
  health: ReturnType<typeof connectionHealth>;
}) {
  if (health.state === "syncing" || health.state === "retrying") {
    return (
      <span
        aria-label={`${accountLabel} account is syncing`}
        className="mail-account-visibility__health"
        data-state="syncing"
        role="img"
      >
        <RefreshIcon aria-hidden="true" className="spin" />
      </span>
    );
  }
  if (health.state === "ready") return null;
  return (
    <span
      aria-label={`${accountLabel} account needs attention`}
      className="mail-account-visibility__health"
      data-state="attention"
      role="img"
    >
      <AlertTriangleIcon aria-hidden="true" />
    </span>
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
  const lastSyncedAt = enabledAccounts
    .map((account) => account.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  const nextSyncAt = enabledAccounts
    .map((account) => account.nextSyncAt ?? connectionHealth(account).nextSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
  const syncPaused = enabledAccounts.some((account) =>
    ["reconnect", "service_attention"].includes(connectionHealth(account).state),
  );
  const lastSyncLabel = lastSyncedAt
    ? `Last synced ${formatRelative(lastSyncedAt)}`
    : "Not synced yet";
  const nextSyncLabel = syncPaused
    ? "Sync paused"
    : nextSyncAt
      ? `Next ${formatRelative(nextSyncAt)}`
      : "Next sync not scheduled";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [failedAccountIds, setFailedAccountIds] = useState<string[]>([]);
  const [partialOutcome, setPartialOutcome] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const sync = useFeedbackMutation({
    feedback: { action: "sync mail accounts", safeToRetry: true },
    onMutate: () => setDetailsOpen(false),
    onError: () => setDetailsOpen(true),
    mutationFn: async () => {
      const targets = failedAccountIds.length
        ? enabledAccounts.filter((account) => failedAccountIds.includes(account.id))
        : enabledAccounts;
      const results = await Promise.allSettled(
        targets.map((account) => api.syncConnector(account.id)),
      );
      const failures = results.flatMap((result, index) => {
        const account = targets[index];
        return result.status === "rejected" && account
          ? [{ id: account.id, error: result.reason as unknown }]
          : [];
      });
      setFailedAccountIds(failures.map((failure) => failure.id));
      setPartialOutcome(
        failures.length
          ? { completed: targets.length - failures.length, total: targets.length }
          : null,
      );
      if (failures.length) {
        const authenticationFailure = failures.find(
          ({ error }) => error instanceof ApiClientError && error.status === 401,
        );
        throw authenticationFailure?.error ?? failures[0]?.error;
      }
    },
    onSettled: () =>
      Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["mail-threads"] }),
      ]),
  });

  const hasSyncDetails = Boolean(accounts.isError || sync.feedback?.persistent || partialOutcome);
  useEffect(() => {
    if (!hasSyncDetails) setDetailsOpen(false);
  }, [hasSyncDetails]);

  return (
    <div className="mail-sync-control">
      {hasSyncDetails ? (
        <ShadcnPopover open={detailsOpen} onOpenChange={setDetailsOpen}>
          <ShadcnPopoverTrigger asChild>
            <ShadcnButton aria-label="Mail sync details" size="icon-sm" variant="ghost">
              <AlertTriangleIcon aria-hidden="true" />
            </ShadcnButton>
          </ShadcnPopoverTrigger>
          <ShadcnPopoverContent className="space-y-3" align="end">
            <ShadcnPopoverHeader>
              <ShadcnPopoverTitle>Mail sync needs attention</ShadcnPopoverTitle>
            </ShadcnPopoverHeader>
            <QueryFeedback query={accounts} title="Couldn’t load mail accounts." />
            <MutationFeedback feedback={sync.feedback} />
            {partialOutcome ? (
              <p className="text-sm text-muted-foreground" role="status">
                {partialOutcome.completed} of {partialOutcome.total} mail accounts synced.{" "}
                {failedAccountIds.length}{" "}
                {failedAccountIds.length === 1 ? "account needs" : "accounts need"} another attempt.
              </p>
            ) : null}
          </ShadcnPopoverContent>
        </ShadcnPopover>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <ShadcnButton
            className="mail-sync-control__action"
            aria-label={
              failedAccountIds.length ? "Retry failed mail accounts" : "Sync all mail accounts"
            }
            disabled={accounts.isPending || enabledAccounts.length === 0 || sync.isPending}
            onClick={() => {
              onSelect?.();
              sync.mutate();
            }}
            size="sm"
            variant={variant}
          >
            <RefreshIcon aria-hidden="true" className={sync.isPending ? "spin" : ""} />
            <span>{sync.isPending ? "Syncing…" : failedAccountIds.length ? "Retry" : "Sync"}</span>
          </ShadcnButton>
        </TooltipTrigger>
        <TooltipContent>
          <p>{lastSyncLabel}</p>
          <p>{nextSyncLabel}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

type SettingsSectionId =
  | "security"
  | "setup"
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
  | "desktop"
  | "pet"
  | "notifications"
  | "rituals"
  | "workspace-access";

const secondarySettings: Array<{
  icon: Icon;
  id: SettingsSectionId;
  label: string;
  parent: SettingsSectionId;
}> = [
  { icon: SparklesIcon, id: "setup", label: "Setup", parent: "profile" },
  { icon: PlugIcon, id: "agent-connections", label: "Connected agents", parent: "connections" },
  { icon: ShieldCheckIcon, id: "workspace-access", label: "Workspace access", parent: "security" },
  { icon: LockIcon, id: "sessions", label: "Signed-in devices", parent: "security" },
  { icon: UserIcon, id: "invitations", label: "Invitations", parent: "security" },
  { icon: ImageIcon, id: "wallpaper", label: "Wallpaper", parent: "appearance" },
  { icon: SparklesIcon, id: "pet", label: "Desktop pet", parent: "desktop" },
];
const settingsNavigation: Array<{
  items: Array<{ icon: Icon; id: SettingsSectionId; label: string }>;
  label: string;
}> = [
  {
    label: "Account",
    items: [
      { icon: UserIcon, id: "profile", label: "Profile" },
      { icon: CloudIcon, id: "connections", label: "Connections" },
      { icon: LockIcon, id: "security", label: "Security & access" },
      { icon: ActivityIcon, id: "activity", label: "Activity log" },
    ],
  },
  {
    label: "Personal",
    items: [
      { icon: TargetIcon, id: "goals", label: "Goals" },
      { icon: CompassIcon, id: "motives", label: "Motives" },
      { icon: SparklesIcon, id: "rituals", label: "Rituals" },
    ],
  },
  {
    label: "Workspaces",
    items: [
      { icon: CalendarIcon, id: "calendar", label: "Calendar" },
      { icon: ListChecksIcon, id: "tasks", label: "Tasks" },
      { icon: MailIcon, id: "mail", label: "Mail" },
      { icon: BankIcon, id: "finances", label: "Finances" },
    ],
  },
  {
    label: "App",
    items: [
      { icon: PaintBrushIcon, id: "appearance", label: "Appearance" },
      { icon: PulseIcon, id: "notifications", label: "Notifications" },
      { ...textingSettingsNavigationItem, id: "texting", label: "Texting" },
      { icon: MonitorIcon, id: "desktop", label: "Desktop app" },
    ],
  },
];
const settingsSectionIds = new Set<SettingsSectionId>([
  ...settingsNavigation.flatMap((group) => group.items.map((item) => item.id)),
  ...secondarySettings.map((item) => item.id),
  "reviews",
]);
function settingsParent(section: SettingsSectionId): SettingsSectionId {
  return secondarySettings.find((item) => item.id === section)?.parent ?? section;
}
function searchableSettingsNavigation(canManageInvitations: boolean) {
  return [
    ...visibleSettingsNavigation(canManageInvitations),
    {
      label: "More settings",
      items: secondarySettings.filter(
        (item) =>
          (item.id !== "invitations" || canManageInvitations) &&
          (!["wallpaper", "pet"].includes(item.id) || isTauri()),
      ),
    },
  ];
}

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
    [...settingsNavigation.flatMap((group) => group.items), ...secondarySettings].find(
      (item) => item.id === section,
    )?.label ?? "Settings"
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
          (item.id !== "wallpaper" || isTauri()) &&
          (isTauri() || !["pet", "notifications"].includes(item.id)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** The narrow-layout dock lists the same sections as the sidebar, flattened. */
function settingsSectionPages(
  canManageInvitations: boolean,
  workspaceActions: WorkspaceSettingsActions,
  counts: ReturnType<typeof useSettingsSidebarCounts>,
): MobileWorkspacePage[] {
  return visibleSettingsNavigation(canManageInvitations).flatMap((group) =>
    group.items.map(({ icon, id, label }) => {
      const badge = workspaceActionBadge(id, workspaceActions);
      return {
        ...(badge ? { badge } : {}),
        count: id === "connections" || id === "agent-connections" ? counts[id] : undefined,
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
  counts,
}: {
  canManageInvitations: boolean;
  onNavigate: () => void;
  section: SettingsSectionId;
  workspaceActions: WorkspaceSettingsActions;
  counts: ReturnType<typeof useSettingsSidebarCounts>;
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
                      count={
                        id === "connections" || id === "agent-connections" ? counts[id] : undefined
                      }
                      icon={icon}
                      isActive={settingsParent(section) === id}
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
  const legacyRule = new URLSearchParams(location.search).get("reviewRule");
  if (section === "mail" && legacyRule)
    return (
      <Navigate
        replace
        to={`/settings?section=mail&review=${encodeURIComponent(`mail-rule:${legacyRule}`)}`}
      />
    );
  if (section === "reviews") {
    const next = new URLSearchParams(location.search);
    next.delete("section");
    return <Navigate replace to={`/reviews${next.size ? `?${next}` : ""}`} />;
  }
  if (section === "wallpaper" && !isTauri()) {
    return <Navigate replace to="/settings?section=appearance" />;
  }
  if (["pet", "notifications"].includes(section) && !isTauri()) {
    return <Navigate replace to="/settings?section=desktop" />;
  }
  if (section === "invitations" && user.canManageInvitations !== true) {
    return <Navigate replace to="/settings?section=profile" />;
  }
  return (
    <SettingsPageLayout
      key={section}
      actions={
        section === "calendar" ||
        section === "tasks" ||
        section === "mail" ||
        section === "finances" ? (
          <ReviewNavigation workspace={section} />
        ) : undefined
      }
      title={settingsSectionLabel(section)}
      description={settingsDescriptions[section]}
      search={
        <SettingsSearch groups={searchableSettingsNavigation(user.canManageInvitations === true)} />
      }
    >
      {settingsParent(section) !== section ? (
        <ShadcnButton asChild variant="ghost" size="sm">
          <Link to={settingsSectionPath(settingsParent(section))}>
            Back to {settingsSectionLabel(settingsParent(section))}
          </Link>
        </ShadcnButton>
      ) : null}
      {section === "mail" ? <WorkspaceSettings domain="mail" /> : null}
      {section === "finances" ? (
        <div className="settings-stack">
          <FinanceSettings />
          <WorkspaceSettings domain="finances" />
        </div>
      ) : null}
      {section === "calendar" ? (
        <div className="settings-stack">
          <CalendarsSettings setEditor={setEditor} />
          <WorkspaceSettings domain="calendar" />
        </div>
      ) : null}
      {section === "tasks" ? <WorkspaceSettings domain="tasks" /> : null}
      {section === "connections" ? (
        <div className="settings-stack">
          <ConnectorsSettings />
          <RelatedSettings
            title="Assistants"
            items={[
              {
                label: "Connected agents",
                description: "Manage assistant connections, credentials, and granted permissions.",
                section: "agent-connections",
              },
            ]}
          />
        </div>
      ) : null}
      {section === "security" ? (
        <div className="settings-stack">
          <ProfileSecurity user={user} />
          <RelatedSettings
            title="Access"
            items={[
              {
                label: "Signed-in devices",
                description: "Review active sessions and revoke devices you no longer use.",
                section: "sessions",
              },
              {
                label: "Workspace access",
                description: "Inspect permissions by workspace and manage approval policy.",
                section: "workspace-access",
              },
              ...(user.canManageInvitations
                ? [
                    {
                      label: "Invitations",
                      description: "Manage invitations to nohmi.",
                      section: "invitations",
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
      {section === "agent-connections" ? <ConnectedAgentsSettings /> : null}
      {section === "workspace-access" ? <WorkspaceAccessSettings /> : null}
      {section === "activity" ? (
        <SettingsSection
          title="Activity history"
          description="Search changes made by you, agents, and connected services."
        >
          <div>
            <ActivityTopbarControls />
          </div>
          <ActivityPage />
        </SettingsSection>
      ) : null}
      {section === "appearance" ? (
        <div className="settings-stack">
          <ThemeSettings user={user} />
          {isTauri() ? (
            <RelatedSettings
              title="Desktop appearance"
              items={[
                {
                  label: "Wallpaper",
                  description: "Choose your desktop wallpaper and layout.",
                  section: "wallpaper",
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}
      {section === "rituals" ? <RitualSettings timeZone={user.planningTimezone} /> : null}
      {section === "goals" ? <GoalsPage /> : null}
      {section === "motives" ? <MotivesPage /> : null}
      {section === "profile" ? (
        <div className="settings-stack">
          <ProfileSettings user={user} />
          <RelatedSettings
            title="Account preferences"
            items={[
              {
                label: "Setup",
                description: "Change setup preferences or revisit the guided experience.",
                section: "setup",
              },
              {
                label: "Security & access",
                description: "Manage your password, devices, and permissions.",
                section: "security",
              },
            ]}
          />
        </div>
      ) : null}
      {section === "setup" ? <SetupSettings user={user} /> : null}
      {section === "invitations" ? <InvitationsSettings /> : null}
      {section === "sessions" ? <SessionsSettings /> : null}
      {section === "texting" ? <TextingSettings /> : null}
      {section === "desktop" ? (
        <div className="settings-stack">
          <DesktopDownloads />
          {isTauri() ? (
            <RelatedSettings
              title="Desktop companion"
              items={[
                {
                  label: "Desktop pet",
                  description: "Choose your companion and its shortcuts.",
                  section: "pet",
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}
      {section === "wallpaper" ? <PinterestWallpaperSettingsPanel /> : null}
      {isTauri() && (section === "desktop" || section === "pet" || section === "notifications") ? (
        <DesktopSettingsPanel section={section} />
      ) : null}
    </SettingsPageLayout>
  );
}

function CalendarsSettings({ setEditor }: { setEditor: (editor: Editor) => void }) {
  const { confirm, confirmation } = useConfirmAction();
  const queryClient = useQueryClient();
  const query = useQuery({ queryFn: api.listCalendars, queryKey: ["calendars"] });
  const accounts = useQuery({ queryFn: api.listConnectors, queryKey: ["connectors"] });
  const selected = useFeedbackMutation({
    feedback: { action: "change calendar visibility", safeToRetry: true },
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      api.setCalendarSelected(id, value),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const remove = useFeedbackMutation({
    feedback: { action: "delete this calendar", safeToRetry: false },
    mutationFn: api.deleteCalendar,
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const calendarGroups = groupCalendarsByAccount(accounts.data ?? [], query.data ?? []);
  if (query.isPending) return <PageLoading />;
  if (query.isError && !query.data)
    return <InlineError error={query.error} retry={query.refetch} />;
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
      <QueryFeedback query={query} title="Couldn’t load calendars." />
      <QueryFeedback query={accounts} title="Couldn’t load connected accounts." />
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
                  <ShadcnItem
                    variant="secondary"
                    className="calendar-settings__calendar"
                    key={calendar.id}
                    size="sm"
                  >
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
                          onClick={() =>
                            confirm({
                              title: "Delete calendar?",
                              description:
                                "This permanently deletes this local calendar and its events.",
                              actionLabel: "Delete calendar",
                              onConfirm: () => remove.mutate(calendar.id),
                            })
                          }
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

      <MutationFeedback feedback={selected.feedback} />
      <MutationFeedback feedback={remove.feedback} />
      {confirmation}
    </SettingsSection>
  );
}

function ConnectorsSettings() {
  const { confirm, confirmation } = useConfirmAction();
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
  const googleConnect = useFeedbackMutation({
    feedback: { action: "connect Google", safeToRetry: true },
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
  const xConnect = useFeedbackMutation({
    feedback: { action: "connect X bookmarks", safeToRetry: true },
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
  const selectXFolder = useFeedbackMutation({
    feedback: { action: "select this bookmark folder", safeToRetry: true },
    mutationFn: api.selectXBookmarkFolder,
    onSuccess: refreshXBookmarks,
  });
  const syncXBookmarks = useFeedbackMutation({
    feedback: { action: "sync your bookmarks", safeToRetry: true },
    mutationFn: api.syncXBookmarks,
    onSuccess: refreshXBookmarks,
  });
  const disconnectXBookmarks = useFeedbackMutation({
    feedback: { action: "disconnect X bookmarks", safeToRetry: false },
    mutationFn: api.deleteXBookmarkAccount,
    onSuccess: refreshXBookmarks,
  });
  const icloudConnect = useFeedbackMutation({
    feedback: { action: "connect iCloud", form: true },
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
  const sync = useFeedbackMutation({
    feedback: { action: "sync this account", safeToRetry: true },
    mutationFn: api.syncConnector,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        invalidateMaterial(queryClient),
      ]),
    onSuccess: () => toast.success("Connection synced."),
  });
  const disconnect = useFeedbackMutation({
    feedback: { action: "disconnect this account", safeToRetry: false },
    mutationFn: api.deleteConnector,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["connectors"] }),
        invalidateMaterial(queryClient),
      ]),
  });
  if (query.isPending) return <PageLoading />;
  if (query.isError && !query.data)
    return <InlineError error={query.error} retry={query.refetch} />;
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
      <QueryFeedback query={query} title="Couldn’t load connected accounts." />
      <QueryFeedback query={xAccount} title="Couldn’t load X bookmarks account." />
      <QueryFeedback query={xFolders} title="Couldn’t load bookmark folders." />
      {showICloud ? (
        <FeedbackForm
          feedback={icloudConnect.feedback}
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
        </FeedbackForm>
      ) : null}
      {xAccount.data ? (
        <XBookmarksConnectorRow
          account={xAccount.data}
          disconnect={() =>
            confirm({
              title: "Disconnect X bookmarks?",
              description: "This stops syncing your X bookmarks.",
              actionLabel: "Disconnect X bookmarks",
              onConfirm: () => disconnectXBookmarks.mutate(),
            })
          }
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
              disconnect={() =>
                confirm({
                  title: "Disconnect account?",
                  description: "This stops syncing this account with nohmi.",
                  actionLabel: "Disconnect account",
                  onConfirm: () => disconnect.mutate(account.id),
                })
              }
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

      <MutationFeedback feedback={googleConnect.feedback} />
      <MutationFeedback feedback={xConnect.feedback} />
      <MutationFeedback feedback={selectXFolder.feedback} />
      <MutationFeedback feedback={syncXBookmarks.feedback} />
      <MutationFeedback feedback={disconnectXBookmarks.feedback} />
      <MutationFeedback feedback={sync.feedback} />
      <MutationFeedback feedback={disconnect.feedback} />
      {confirmation}
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
    <ShadcnItem variant="secondary">
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
          <ShadcnNativeSelect
            aria-label="X bookmark folder"
            disabled={syncing || !folders.length}
            onChange={(event) => selectFolder(event.target.value)}
            value={account.selectedFolderId ?? ""}
          >
            <NativeSelectOption disabled value="">
              Choose a folder
            </NativeSelectOption>
            {folders.map((folder) => (
              <NativeSelectOption key={folder.id} value={folder.remoteFolderId}>
                {folder.name}
              </NativeSelectOption>
            ))}
          </ShadcnNativeSelect>
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
  const pins = await api.listPinterestPins(
    12,
    isTauri()
      ? localDateToIso(localDateAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone))
      : undefined,
  );
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
  const boardEdited = useRef(false);
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
    if (!boardEdited.current) setBoardUrl(settings.data?.boardUrl ?? "");
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
  const saveBoard = useFeedbackMutation({
    feedback: { action: "save this board URL", form: true, safeToRetry: true },
    mutationFn: api.updatePinterestWallpaperSettings,
    onSuccess: async (next) => {
      boardEdited.current = false;
      queryClient.setQueryData(["pinterest-wallpaper"], next);
      await invalidate();
    },
  });
  const update = useFeedbackMutation({
    feedback: { action: "save wallpaper settings", safeToRetry: true },
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
  const apply = useFeedbackMutation({
    feedback: {
      action: "refresh the wallpaper",
      safeToRetry: true,
      success: "Wallpaper refreshed.",
    },
    mutationFn: () => {
      if (!settings.data) throw new Error("Wallpaper settings are still loading.");
      return applyPinterestWallpaper(settings.data);
    },
    onSuccess: async (images) => {
      setAppliedImages(images);
      await invalidate();
    },
  });
  const value = settings.data;
  const dailyBackdropTimestamp = value?.lastAppliedAt
    ? new Date(value.lastAppliedAt).getTime()
    : Date.now();
  const preview = useQuery({
    enabled: Boolean(value?.boardUrl),
    queryFn: () =>
      api.listPinterestPins(
        12,
        isTauri()
          ? localDateToIso(
              localDateAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
            )
          : undefined,
      ),
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
      <QueryFeedback query={settings} title="Couldn’t load wallpaper settings." />
      <QueryFeedback query={preview} title="Couldn’t load wallpaper preview." />
      <QueryFeedback query={desktopEnvironment} title="Couldn’t load desktop settings." />

      <ShadcnFieldGroup className="pinterest-wallpaper__controls">
        <FeedbackForm
          feedback={saveBoard.feedback}
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveBoard.isPending) saveBoard.mutate({ boardUrl: boardUrl.trim() || null });
          }}
        >
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="pinterest-board-url">Public board URL</ShadcnFieldLabel>
            <ShadcnInput
              autoComplete="url"
              id="pinterest-board-url"
              name="boardUrl"
              disabled={saveBoard.isPending}
              onBlur={(event) => {
                if (boardEdited.current && event.currentTarget.checkValidity())
                  event.currentTarget.form?.requestSubmit();
              }}
              onChange={(event) => {
                boardEdited.current = true;
                setBoardUrl(event.target.value);
              }}
              placeholder="https://www.pinterest.com/name/board-name/"
              type="url"
              value={boardUrl}
            />
            <ShadcnFieldDescription>
              The board must be public. If Pinterest only exposes a few Pins, nohmi repeats them to
              complete the collage.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnButton type="submit" disabled={saveBoard.isPending}>
            {saveBoard.isPending ? "Saving board…" : "Save board"}
          </ShadcnButton>
        </FeedbackForm>
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
          <SegmentedControl
            aria-label="Wallpaper layout"
            onValueChange={(next) => {
              if (next === "grid" || next === "stack") update.mutate({ layout: next });
            }}
            value={value?.layout ?? "grid"}
          >
            <SegmentedControlItem aria-label="Tiled grid" value="grid">
              <GridIcon data-icon="inline-start" className="size-[15px]" /> Grid
            </SegmentedControlItem>
            <SegmentedControlItem aria-label="Overlapping stack" value="stack">
              <LayersIcon data-icon="inline-start" className="size-[15px]" /> Stack
            </SegmentedControlItem>
          </SegmentedControl>
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
            <SegmentedControl
              aria-label="Mosaic fit"
              onValueChange={(next) => {
                if (next === "preserve" || next === "fill") update.mutate({ mosaicFit: next });
              }}
              value={value?.mosaicFit ?? "preserve"}
            >
              <SegmentedControlItem aria-label="Preserve image shapes" value="preserve">
                Preserve images
              </SegmentedControlItem>
              <SegmentedControlItem aria-label="Fill the rectangular frame" value="fill">
                Fill frame
              </SegmentedControlItem>
            </SegmentedControl>
            <ShadcnFieldDescription>
              Preserve keeps every image uncropped and centers the clean mosaic. Fill makes an exact
              rectangle with equal edges by allowing a small, centered crop.
            </ShadcnFieldDescription>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel>Backdrop</ShadcnFieldLabel>
            <SegmentedControl
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
              value={value?.backgroundMode ?? "white"}
            >
              <SegmentedControlItem aria-label="White backdrop" value="white">
                White
              </SegmentedControlItem>
              <SegmentedControlItem aria-label="Custom backdrop" value="custom">
                Custom
              </SegmentedControlItem>
              <SegmentedControlItem aria-label="Color-matched backdrop" value="matched">
                Matched
              </SegmentedControlItem>
              <SegmentedControlItem aria-label="Daily random backdrop" value="random">
                Daily
              </SegmentedControlItem>
            </SegmentedControl>
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
            appliedImages.map((imageUrl, index) => ({
              id: String(index),
              imageUrl,
              title: null,
            }))
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
          previewError={preview.error ? "Couldn’t load the wallpaper preview. Try again." : null}
          tileSize={tileSize}
        />
      ) : null}

      <MutationFeedback feedback={update.feedback} />
      <MutationFeedback feedback={apply.feedback} />
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
  // Native application uses this device's current date, independently of another Mac's stamp.
  const current = new Date();
  const day = isTauri()
    ? Math.floor(
        Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) / 86_400_000,
      )
    : Math.floor(timestamp / 86_400_000);
  return palette[((day % palette.length) + palette.length) % palette.length] ?? "#ffffff";
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
    <ConnectionCard
      actions={
        <>
          {reconnect ? (
            <SettingsRecordAction label="Reconnect" onClick={reconnect}>
              <RefreshIcon />
            </SettingsRecordAction>
          ) : null}
          <SettingsRecordAction label={`Sync ${account.label}`} disabled={syncing} onClick={sync}>
            <RefreshIcon aria-hidden="true" className={syncing ? "spin" : ""} />
          </SettingsRecordAction>
          <SettingsRecordAction label={`Disconnect ${account.label}`} onClick={disconnect}>
            <TrashIcon aria-hidden="true" />
          </SettingsRecordAction>
        </>
      }
      capabilities={
        <>
          <span className="connection-card__capabilities-label">Available in</span>
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
        </>
      }
      identity={
        <ConnectedAccountIdentity
          avatarUrl={account.avatarUrl}
          label={account.label}
          provider={account.provider}
          size="default"
        />
      }
      state={health.state}
      status={<ConnectionHealthBadge health={health} />}
      subtitle={account.email ?? "Connected account"}
      summary={
        <>
          <strong>{connectionHealthTitle(health.state)}</strong>
          <span>
            <ConnectionHealthDescription health={health} lastSyncedAt={account.lastSyncedAt} />
          </span>
          <small>{connectionHealthGuidance(health.state)}</small>
        </>
      }
      title={account.label}
    />
  );
}

function connectionHealthTitle(state: ReturnType<typeof connectionHealth>["state"]) {
  if (state === "syncing") return "Syncing now";
  if (state === "retrying") return "Sync delayed";
  if (state === "reconnect") return "Reconnect this account";
  if (state === "service_attention") return "Connection temporarily unavailable";
  return "Connected and ready";
}

function connectionHealthGuidance(state: ReturnType<typeof connectionHealth>["state"]) {
  if (state === "syncing") return "New information will appear when this sync finishes.";
  if (state === "retrying") return "No action is needed while automatic retries continue.";
  if (state === "reconnect") return "Use Reconnect to restore access.";
  if (state === "service_attention") return "No action is needed. We’ll keep retrying.";
  return "You can sync now whenever you want to check for new information.";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [editRevision, setEditRevision] = useState(0);
  const attempted = useRef("");
  const saving = useRef(false);
  const revisionRef = useRef(0);
  const queryClient = useQueryClient();
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(user.homeLocation);
  const [homeLocationValid, setHomeLocationValid] = useState(true);
  const [planningTimezone, setPlanningTimezone] = useState(user.planningTimezone);
  const update = useFeedbackMutation({
    feedback: { action: "save your profile", form: true },
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
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const resendVerification = useFeedbackMutation({
    feedback: {
      action: "send a confirmation email",
      safeToRetry: true,
      success: "Confirmation email sent.",
    },
    mutationFn: api.resendEmailVerification,
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

  // Keep requests serialized. When one completes, the effect reads the latest
  // form values rather than replaying an obsolete draft.
  useEffect(() => {
    if (!editRevision || update.isPending || !homeLocationValid) return;
    const timer = window.setTimeout(() => {
      const form = formRef.current;
      if (!form || saving.current) return;
      const values = new FormData(form);
      if (
        !form.checkValidity() ||
        String(values.get("workdayEnd")) <= String(values.get("workdayStart"))
      )
        return;
      const signature = JSON.stringify([
        Array.from(values.entries()),
        homeLocation,
        planningTimezone,
      ]);
      if (attempted.current === signature) return;
      form.requestSubmit();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [editRevision, update.isPending, homeLocationValid, homeLocation, planningTimezone]);
  const edited = () => {
    revisionRef.current += 1;
    setEditRevision(revisionRef.current);
  };
  const [firstName, lastName] = splitProfileName(user.displayName);
  return (
    <div className="flex flex-col gap-4">
      <AccountIdentity user={user} />
      <AccountOverview />
      <div className="flex flex-col gap-6">
        <FeedbackForm
          ref={formRef}
          onChange={edited}
          feedback={update.feedback}
          fieldNames={{
            displayName: "firstName",
            workdayStartMinute: "workdayStart",
            workdayEndMinute: "workdayEnd",
          }}
          validate={(form) => {
            const values = new FormData(form);
            const errors: Record<string, string> = {};
            if (String(values.get("workdayEnd")) <= String(values.get("workdayStart")))
              errors.workdayEnd = "Day end must be after day start.";
            if (!homeLocationValid)
              errors.homeLocation = "Choose a place from the results, or clear this field.";
            return errors;
          }}
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving.current) return;
            const form = new FormData(event.currentTarget);
            attempted.current = JSON.stringify([
              Array.from(form.entries()),
              homeLocation,
              planningTimezone,
            ]);
            saving.current = true;
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
          <SettingsBento>
            <SettingsSection
              title="Personal details"
              description="How you appear in nohmi and where we contact you."
            >
              <ShadcnFieldGroup>
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
              </ShadcnFieldGroup>
            </SettingsSection>
            <SettingsSection
              title="Daily defaults"
              description="Anchor your schedule to your local day."
            >
              <ShadcnFieldGroup className="form-grid">
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="profile-workday-start">Day start</ShadcnFieldLabel>
                  <ShadcnInput
                    defaultValue={minuteToTime(user.workdayStartMinute)}
                    id="profile-workday-start"
                    name="workdayStart"
                    required
                    type="time"
                  />
                </ShadcnField>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="profile-workday-end">Day end</ShadcnFieldLabel>
                  <ShadcnInput
                    defaultValue={minuteToTime(user.workdayEndMinute)}
                    id="profile-workday-end"
                    name="workdayEnd"
                    required
                    type="time"
                  />
                </ShadcnField>
                <HomeLocationField
                  savedLocation={user.homeLocation}
                  onChange={(location) => {
                    edited();
                    setHomeLocation(location);
                    if (location?.timezone) setPlanningTimezone(location.timezone);
                  }}
                  onValidityChange={setHomeLocationValid}
                />
                <ShadcnField className="profile-form__full-row">
                  <ShadcnFieldLabel htmlFor="profile-timezone">Time zone</ShadcnFieldLabel>
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
                    Home Location supplies this default. Choose a different zone when your day
                    should stay anchored elsewhere.
                  </ShadcnFieldDescription>
                </ShadcnField>
              </ShadcnFieldGroup>
            </SettingsSection>
          </SettingsBento>
          <MutationFeedback feedback={resendVerification.feedback} />
          {update.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Saving changes…
            </p>
          ) : null}
          {update.isError ? (
            <ShadcnButton type="submit" variant="secondary">
              Retry saving
            </ShadcnButton>
          ) : null}
        </FeedbackForm>
        <TextingSettings profile />
      </div>
    </div>
  );
}

function ProfileSecurity({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const passwordReset = useFeedbackMutation({
    feedback: { action: "send a password reset link", safeToRetry: true },
    mutationFn: () => api.requestPasswordReset({ email: user.email }),
    onSuccess: () => toast.success(`Password reset link sent to ${user.email}.`),
  });
  const logout = useFeedbackMutation({
    feedback: { action: "log out", safeToRetry: true },
    mutationFn: api.logout,
    onSuccess: () => {
      if (isTauri()) {
        void resetDesktopSession(queryClient);
        return;
      }
      queryClient.clear();
      window.location.assign("/");
    },
  });
  return (
    <div className="settings-stack">
      <SettingsSection title="Security" description="Manage your password and this session.">
        <ShadcnItemGroup aria-label="Account actions">
          <ShadcnItem size="sm" variant="secondary">
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
          <ShadcnItem size="sm" variant="secondary">
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
      </SettingsSection>
      <MutationFeedback feedback={passwordReset.feedback} />
      <MutationFeedback feedback={logout.feedback} />
    </div>
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
  return (
    <ShadcnField>
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
          name="homeLocation"
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
            <InlineError
              error={locations.error}
              title="Couldn’t search for places."
              retry={locations.refetch}
            />
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
  const create = useFeedbackMutation({
    feedback: { action: "create this invitation", form: true },
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
    try {
      await navigator.clipboard.writeText(latestCode);
      toast.success("Invitation copied.");
    } catch {
      toast.error("Couldn’t copy the invitation. Select and copy the code instead.", {
        duration: Number.POSITIVE_INFINITY,
      });
    }
  };
  return (
    <SettingsSection
      description="Issue single-use invitation codes for the private beta. The code is shown only once, so copy it before you leave this page."
      title="Invitations"
    >
      <QueryFeedback query={invitations} title="Couldn’t load invitations." staleOnly />
      {invitations.isError && !invitations.data ? (
        <InlineError
          error={invitations.error}
          retry={invitations.refetch}
          title="Couldn’t load invitations."
        />
      ) : (
        <>
          <FeedbackForm
            feedback={create.feedback}
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

            <ShadcnButton disabled={create.isPending} type="submit">
              {create.isPending ? "Creating invitation…" : "Create invitation"}
            </ShadcnButton>
          </FeedbackForm>
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
            <ShadcnItemGroup>
              {invitations.data.map((invitation) => (
                <InvitationRow invitation={invitation} key={invitation.id} />
              ))}
            </ShadcnItemGroup>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
  return (
    <ShadcnItem variant="secondary">
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
  const { confirm, confirmation } = useConfirmAction();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryFn: api.listSessions, queryKey: ["sessions"] });
  const revoke = useFeedbackMutation({
    feedback: { action: "revoke this session", safeToRetry: false },
    mutationFn: api.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  if (sessions.isPending) return <PageLoading />;
  if (sessions.isError && !sessions.data)
    return <InlineError error={sessions.error} retry={sessions.refetch} />;
  return (
    <SettingsSection
      description="Devices with an active sign-in to your nohmi account. Revoke access you no longer recognize."
      title="Sessions"
    >
      <QueryFeedback query={sessions} title="Couldn’t load sessions." />
      <ShadcnItemGroup>
        {sessions.data?.map((session) => (
          <SessionRow
            key={session.id}
            revoke={() =>
              confirm({
                title: "Revoke session?",
                description: "This device will need to sign in again.",
                actionLabel: "Revoke session",
                onConfirm: () => revoke.mutate(session.id),
              })
            }
            session={session}
          />
        ))}
      </ShadcnItemGroup>

      <MutationFeedback feedback={revoke.feedback} />
      {confirmation}
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
  const updateTheme = useFeedbackMutation({
    feedback: { action: "save your appearance", safeToRetry: true },
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

      <MutationFeedback feedback={updateTheme.feedback} />
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
    <SettingsRecord
      title={session.userAgent?.split(" ").slice(0, 3).join(" ") ?? "Unknown device"}
      leading={<UserIcon className="size-4" />}
      metadata={
        <>
          <ShadcnBadge variant="secondary">{session.ipAddress ?? "Local"}</ShadcnBadge>
          <span>
            Active{" "}
            <time
              dateTime={session.lastSeenAt}
              title={new Date(session.lastSeenAt).toLocaleString()}
            >
              {formatRelative(session.lastSeenAt)}
            </time>
          </span>
        </>
      }
      actions={
        <SettingsRecordAction label="Revoke session" onClick={revoke}>
          <TrashIcon />
        </SettingsRecordAction>
      }
    />
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

export function TodayEventCard({
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
            <EventCardPrimaryAction
              aria-label={`${eventLabel}. Open quick actions`}
              className="today-timeline__event-action"
            >
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

export function scheduledTaskEndsAt(task: Task): Date {
  return new Date(
    new Date(task.scheduledAt as string).getTime() +
      Math.max(15, task.estimateMinutes ?? 30) * 60_000,
  );
}

export function TodayTaskTimelineCard({
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
        <EventCardPrimaryAction
          aria-label={`Open task ${task.title}`}
          className="today-timeline__event-action"
          onClick={onEdit}
        >
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

export function TodayAllDayEventCard({
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
  const mutation = useFeedbackMutation({
    feedback: { action: "save this reminder", form: true },
    mutationFn: (input: {
      dueAt: string | null;
      notes: string | null;
      priority: "low" | "medium" | "high";
      timezone: string | null;
      title: string;
    }) =>
      reminder
        ? api.updateReminder(reminder.id, { ...input, expectedUpdatedAt: reminder.updatedAt })
        : api.createReminder(input),
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
      <FeedbackForm feedback={mutation.feedback} className="editor-form" onSubmit={submit}>
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
          pending={mutation.isPending}
          submitLabel={reminder ? "Save changes" : "Create reminder"}
        />
      </FeedbackForm>
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
  const blocksByCalendarId = new Map<string, CalendarEvent["blocks"]>();
  for (const block of blocks) {
    blocksByCalendarId.set(block.calendarId, [
      ...(blocksByCalendarId.get(block.calendarId) ?? []),
      block,
    ]);
  }
  const blockedCalendars = [...blocksByCalendarId.keys()].flatMap((calendarId) => {
    const blockedCalendar = calendars.find((record) => record.id === calendarId);
    return blockedCalendar ? [blockedCalendar] : [];
  });
  const calendarsWithDetails = blockedCalendars.filter((blockedCalendar) =>
    blocksByCalendarId.get(blockedCalendar.id)?.some((block) => block.mode === "details"),
  );
  const calendarsWithBusy = blockedCalendars.filter((blockedCalendar) =>
    blocksByCalendarId.get(blockedCalendar.id)?.some((block) => block.mode === "busy"),
  );
  const eventStartsAt = new Date(event.startsAt).getTime();
  const eventEndsAt = new Date(event.endsAt).getTime();
  const eventIsInProgress =
    currentTime.getTime() >= eventStartsAt && currentTime.getTime() < eventEndsAt;
  const remainingMinutes = Math.max(1, Math.ceil((eventEndsAt - currentTime.getTime()) / 60_000));
  const sourceCalendarIds = new Set(event.sourceCalendarIds ?? [event.calendarId]);
  const blockDestinations = calendars.filter(
    (record) => !sourceCalendarIds.has(record.id) && record.isWritable,
  );
  const remove = useFeedbackMutation({
    feedback: { action: "delete this event", safeToRetry: false },
    mutationFn: () => api.deleteEvent(event.id),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const replaceSourceBlocks = (sourceEventId: string, updatedBlocks: CalendarEvent["blocks"]) => {
    setBlocks((current) => [
      ...current.filter((block) => (block.sourceEventId ?? event.id) !== sourceEventId),
      ...updatedBlocks,
    ]);
  };
  const changeBlock = useFeedbackMutation({
    feedback: { action: "change this event’s availability", safeToRetry: true },
    mutationFn: async (input: {
      blocks: CalendarEvent["blocks"];
      calendarId: string;
      mode: "busy" | "details";
      operation: "remove" | "set";
    }) => {
      if (input.blocks.length === 0) {
        const updated = await api.createEventBlock(event.id, {
          calendarId: input.calendarId,
          mode: input.mode,
        });
        replaceSourceBlocks(event.id, updated.blocks);
        return [{ sourceEventId: event.id, updated }];
      }
      const responses: Array<{ sourceEventId: string; updated: CalendarEvent }> = [];
      for (const block of input.blocks) {
        const sourceEventId = block.sourceEventId ?? event.id;
        const updated =
          input.operation === "remove"
            ? await api.deleteEventBlock(sourceEventId, block.eventId)
            : await api.updateEventBlock(sourceEventId, block.eventId, { mode: input.mode });
        replaceSourceBlocks(sourceEventId, updated.blocks);
        responses.push({ sourceEventId, updated });
      }
      return responses;
    },
    onSuccess: async (responses) => {
      const updatedBySourceId = new Map(
        responses.map(({ sourceEventId, updated }) => [sourceEventId, updated.blocks]),
      );
      setBlocks((current) => [
        ...current.filter((block) => !updatedBySourceId.has(block.sourceEventId ?? event.id)),
        ...[...updatedBySourceId.values()].flat(),
      ]);
      await invalidateMaterial(queryClient);
    },
    onError: () => invalidateMaterial(queryClient),
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
                  onAdd={(calendarId, calendarBlocks) =>
                    changeBlock.mutate({
                      blocks: calendarBlocks,
                      calendarId,
                      mode: "details",
                      operation: "set",
                    })
                  }
                  onRemove={(calendarId, calendarBlocks) =>
                    changeBlock.mutate({
                      blocks: calendarBlocks,
                      calendarId,
                      mode: "details",
                      operation: "remove",
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
                  calendars={calendarsWithBusy}
                  destinations={blockDestinations}
                  disabled={changeBlock.isPending}
                  label="Calendars shown as busy"
                  mode="busy"
                  onAdd={(calendarId, calendarBlocks) =>
                    changeBlock.mutate({
                      blocks: calendarBlocks,
                      calendarId,
                      mode: "busy",
                      operation: "set",
                    })
                  }
                  onRemove={(calendarId, calendarBlocks) =>
                    changeBlock.mutate({
                      blocks: calendarBlocks,
                      calendarId,
                      mode: "busy",
                      operation: "remove",
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
        <MutationFeedback feedback={changeBlock.feedback} />
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
        <MutationFeedback feedback={remove.feedback} />
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
  onAdd: (calendarId: string, blocks: CalendarEvent["blocks"]) => void;
  onRemove: (calendarId: string, blocks: CalendarEvent["blocks"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const blocksForCalendar = (calendarId: string) =>
    blocks.filter((block) => block.calendarId === calendarId);
  const availableCalendars = destinations.filter((calendar) => {
    const calendarBlocks = blocksForCalendar(calendar.id);
    return calendarBlocks.length === 0 || calendarBlocks.some((block) => block.mode !== mode);
  });
  const status = mode === "details" ? "Details Included" : "Shown as Busy";
  return (
    <ul aria-label={label} className="event-details-card__calendar-list">
      {calendars.map((calendar) => {
        const calendarBlocks = blocksForCalendar(calendar.id).filter(
          (block) => block.mode === mode,
        );
        return (
          <ShadcnBadge asChild key={calendar.id} variant="secondary">
            <li
              className={mode === "details" ? "is-details-included" : "is-shown-as-busy"}
              style={{ "--badge-color": calendar.color ?? "var(--muted)" } as CSSProperties}
            >
              <i aria-hidden="true" style={{ background: calendar.color ?? "var(--muted)" }} />
              <span>{calendar.name}</span>
              {calendarBlocks.length > 0 ? (
                <button
                  aria-label={`Remove ${calendar.name} from ${status}`}
                  className="event-details-card__calendar-remove"
                  disabled={disabled}
                  onClick={() => onRemove(calendar.id, calendarBlocks)}
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
                      blocksForCalendar(calendar.id).filter((block) => block.mode !== mode),
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
  const mutation = useFeedbackMutation({
    feedback: { action: "save this event", form: true },
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
      <FeedbackForm
        feedback={mutation.feedback}
        validate={(form) => {
          const values = new FormData(form);
          return String(values.get("endsAt")) <= String(values.get("startsAt"))
            ? { endsAt: "End time must be after start time." }
            : {};
        }}
        className="editor-form"
        onSubmit={submit}
      >
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
          pending={mutation.isPending}
          submitLabel={event ? "Save changes" : "Create event"}
        />
      </FeedbackForm>
    </Modal>
  );
}

function CalendarDialog({ close, user }: { close: () => void; user: User }) {
  const queryClient = useQueryClient();
  const mutation = useFeedbackMutation({
    feedback: { action: "create this calendar", form: true },
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
      <FeedbackForm
        feedback={mutation.feedback}
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <Field autoFocus label="Calendar name" name="name" required />
        <Field defaultValue="#7c8cff" label="Color" name="color" type="color" required />
        <FormActions close={close} pending={mutation.isPending} submitLabel="Create calendar" />
      </FeedbackForm>
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
  pending,
  submitLabel,
}: {
  close: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="form-actions">
      <Button onClick={close}>Cancel</Button>
      <Button disabled={pending} tone="accent" type="submit">
        {pending ? <Spinner label="Saving" /> : submitLabel}
      </Button>
    </div>
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

export function FatalState({ error }: { error: unknown }) {
  if (error instanceof TypeError) return <OfflineState development={false} />;
  if (error instanceof ApiClientError && error.status === 403) return <ErrorPage kind="403" />;
  if (error instanceof ApiClientError && error.status === 404) return <ErrorPage kind="404" />;
  if (error instanceof ApiClientError && error.status === 503) return <ErrorPage kind="503" />;
  return <ErrorPage kind="500" />;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function workspaceOwnerName(user: User): string {
  const firstName = user.displayName.trim().split(/\s+/)[0];
  return firstName || user.email.split("@")[0] || "Your";
}
export function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
export function toDateTimeLocal(
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
export function dateTimeLocalToIso(value: string, timeZone: string): string {
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

export function weatherSkyPeriod(observedAt: string, timeZone: string) {
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
export function formatEventRange(event: CalendarEvent, timeZone: string): string {
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
export function formatMinutes(value: number) {
  if (value === 0) return "No time";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
export function minuteToTime(value: number) {
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

export function startCalendarDrag(
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

export function calendarDragGrabOffset(dataTransfer: DataTransfer, eventId: string) {
  const storedOffset = calendarDragOffsets.get(eventId);
  if (storedOffset !== undefined) return storedOffset;
  const offset = Number(dataTransfer.getData(calendarDragOffsetType));
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

export function timelineMinuteAtPointer(
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

export function createRangeMinuteAtPointer(
  pointerEvent: { clientY: number },
  timeline: HTMLElement,
) {
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
  // Only simultaneous starts share horizontal lanes. Later starts paint above
  // earlier events while retaining their actual time and duration geometry.
  const simultaneous = new Map<number, typeof intervals>();
  for (const interval of intervals) {
    const start = new Date(interval.event.startsAt).getTime();
    const group = simultaneous.get(start) ?? [];
    group.push(interval);
    simultaneous.set(start, group);
  }
  return intervals.map((interval) => {
    const group = simultaneous.get(new Date(interval.event.startsAt).getTime()) as typeof intervals;
    return { ...interval, column: group.indexOf(interval), columns: group.length };
  });
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
