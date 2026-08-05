import type {
  AccessScope,
  AutomationRoutine,
  AutomationRun,
  ConfirmEmailVerificationInput,
  ConnectICloudInput,
  CreateAccessTokenInput,
  CreateAutomationRoutineInput,
  CreateInvitationInput,
  DailyBrief,
  Invitation,
  LoginInput,
  PinterestPin,
  PinterestWallpaperSettings,
  RegisterInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  StartGoogleAuthorizationInput,
  UpdateAccountSetupInput,
  UpdateAutomationRoutineInput,
  UpdatePinterestWallpaperSettingsInput,
  UpdateUserInput,
  User,
  ValidateInvitationInput,
  WeatherCoordinates,
  WeatherLocationOption,
  WeatherSnapshot,
} from "@personal-os/domain";
import {
  connectedAccountHealthSchema,
  type ConnectedAccountHealth,
  type ConnectorSyncStatus,
} from "@personal-os/domain";
import { createAssistantApiClient } from "./features/assistant.js";
import { createCalendarApiClient } from "./features/calendar.js";
import { createFinanceApi } from "./features/finances.js";
import { createGoalsApiClient } from "./features/goals.js";
import { createMailApiClient } from "./features/mail.js";
import { createReminderApiClient } from "./features/reminders.js";
import { createTaskApiClient } from "./features/tasks.js";

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details: unknown;
  public readonly requestId: string | null;
  public readonly status: number;

  public constructor(options: {
    code: string;
    details?: unknown;
    message: string;
    requestId?: string;
    status: number;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId ?? null;
    this.status = options.status;
  }
}

type ClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  onSessionToken?: (token: string | null) => void;
  sessionToken?: string;
  token?: string;
};

export type AuditEvent = {
  action: string;
  actorId: string | null;
  actorType: string;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  createdAt: string;
  entityId: string;
  entityType: string;
  id: string;
  requestId: string;
};

export type CalendarAccount = {
  avatarUrl?: string | null;
  calendarEnabled: boolean;
  email: string | null;
  health: ConnectedAccountHealth;
  id: string;
  label: string;
  lastSyncAttemptAt: string | null;
  lastSyncedAt: string | null;
  mailEnabled: boolean;
  provider: string;
  nextSyncAt: string | null;
  syncError: string | null;
  syncStatus: ConnectorSyncStatus;
};

export type XBookmarkAccount = {
  displayName: string | null;
  id: string;
  lastSyncedAt: string | null;
  selectedFolderId: string | null;
  selectedFolderName: string | null;
  syncError: string | null;
  syncStatus: "idle" | "syncing" | "error";
  username: string;
};

export type XBookmarkFolder = { id: string; name: string; remoteFolderId: string };

export type XBookmark = {
  authorName: string | null;
  authorUsername: string | null;
  id: string;
  postUrl: string;
  postedAt: string | null;
  remotePostId: string;
  source: {
    accountId: string;
    provider: "x";
    remoteId: string;
    revision: null;
    sourceType: "bookmark";
  };
  syncedAt: string;
  text: string;
};

export type AccessToken = {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
  scopes: AccessScope[];
};

export type OAuthClient = {
  id: string;
  lastUsedAt: string | null;
  name: string;
  redirectUris: string[];
  scopes: AccessScope[];
};

export type Session = {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  lastSeenAt: string;
  userAgent: string | null;
};

export function createApiClient(options: ClientOptions) {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let sessionToken = options.sessionToken;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
    if (options.token) headers.set("authorization", `Bearer ${options.token}`);
    else if (sessionToken) headers.set("authorization", `Session ${sessionToken}`);
    if (init.body) headers.set("content-type", "application/json");
    const response = await requestFetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers,
    });
    if (!response.ok) {
      const value = (await response.json().catch(() => null)) as {
        error?: { code?: string; details?: unknown; message?: string; requestId?: string };
      } | null;
      throw new ApiClientError({
        code: value?.error?.code ?? "http_error",
        ...(value?.error?.details === undefined ? {} : { details: value.error.details }),
        message: value?.error?.message ?? `Request failed with status ${response.status}.`,
        ...(value?.error?.requestId === undefined ? {} : { requestId: value.error.requestId }),
        status: response.status,
      });
    }
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return body.length === 0 ? (undefined as T) : (JSON.parse(body) as T);
  }

  return {
    ...createAssistantApiClient(request, toQuery),
    ...createFinanceApi(request),
    ...createCalendarApiClient(request),
    ...createGoalsApiClient(request),
    ...createMailApiClient(request, toQuery),
    ...createReminderApiClient(request, toQuery),
    ...createTaskApiClient(request, toQuery),
    async connectICloud(
      input: ConnectICloudInput,
    ): Promise<{ accountId: string; email: string | null }> {
      const response = await request<{
        account: { accountId: string; email: string | null };
      }>("/v1/connectors/icloud", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.account;
    },

    async confirmEmailVerification(input: ConfirmEmailVerificationInput): Promise<User> {
      const response = await request<{ user: User }>("/v1/auth/email-verification/confirm", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.user;
    },

    async createAccessToken(
      input: CreateAccessTokenInput,
    ): Promise<AccessToken & { token: string }> {
      const response = await request<{ token: AccessToken & { token: string } }>(
        "/v1/access-tokens",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.token;
    },

    async createInvitation(input: CreateInvitationInput): Promise<Invitation & { code: string }> {
      const response = await request<{ invitation: Invitation & { code: string } }>(
        "/v1/invitations",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.invitation;
    },

    async createAutomation(input: CreateAutomationRoutineInput): Promise<AutomationRoutine> {
      const response = await request<{ routine: AutomationRoutine }>("/v1/automations", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.routine;
    },

    async deleteAccessToken(id: string): Promise<void> {
      await request<void>(`/v1/access-tokens/${id}`, { method: "DELETE" });
    },

    async revokeOAuthClient(id: string): Promise<void> {
      await request<void>(`/v1/oauth/clients/${id}`, { method: "DELETE" });
    },

    async deleteConnector(id: string): Promise<void> {
      await request<void>(`/v1/connectors/${id}`, { method: "DELETE" });
    },

    async deleteXBookmarkAccount(): Promise<void> {
      await request<void>("/v1/x-bookmarks/account", { method: "DELETE" });
    },

    async getGoogleAuthorizationUrl(
      input: Partial<StartGoogleAuthorizationInput> = {},
    ): Promise<string> {
      const query = new URLSearchParams();
      if (input.accountId) query.set("accountId", input.accountId);
      if (input.returnTo) query.set("returnTo", input.returnTo);
      if (input.services) query.set("services", input.services.join(","));
      const response = await request<{ url: string }>(
        `/v1/connectors/google/start${query.size ? `?${query}` : ""}`,
        {
          method: "POST",
        },
      );
      return response.url;
    },

    async getXBookmarkAuthorizationUrl(): Promise<string> {
      const response = await request<{ url: string }>("/v1/x-bookmarks/connect/start", {
        method: "POST",
      });
      return response.url;
    },

    async getMe(): Promise<User> {
      const response = await request<{ user: User }>("/v1/me");
      return response.user;
    },

    async getDailyBrief(): Promise<DailyBrief> {
      const response = await request<{ brief: DailyBrief }>("/v1/daily-brief");
      return response.brief;
    },

    async getWeather(coordinates?: WeatherCoordinates): Promise<WeatherSnapshot> {
      const query = coordinates ? `?${toQuery(coordinates)}` : "";
      const response = await request<{ weather: WeatherSnapshot }>(`/v1/weather${query}`);
      return response.weather;
    },

    async searchWeatherLocations(query: string): Promise<WeatherLocationOption[]> {
      const response = await request<{ locations: WeatherLocationOption[] }>(
        `/v1/weather/locations?query=${encodeURIComponent(query)}`,
      );
      return response.locations;
    },

    async listAccessTokens(): Promise<AccessToken[]> {
      const response = await request<{ tokens: AccessToken[] }>("/v1/access-tokens");
      return response.tokens;
    },

    async listOAuthClients(): Promise<OAuthClient[]> {
      const response = await request<{ clients: OAuthClient[] }>("/v1/oauth/clients");
      return response.clients;
    },

    async listActivity(limit = 50): Promise<AuditEvent[]> {
      const response = await request<{ events: AuditEvent[] }>(`/v1/audit?limit=${limit}`);
      return response.events;
    },

    async listAutomations(): Promise<AutomationRoutine[]> {
      const response = await request<{ routines: AutomationRoutine[] }>("/v1/automations");
      return response.routines;
    },

    async listAutomationRuns(routineId?: string): Promise<AutomationRun[]> {
      const query = routineId ? `?routineId=${encodeURIComponent(routineId)}` : "";
      const response = await request<{ runs: AutomationRun[] }>(`/v1/automations/runs${query}`);
      return response.runs;
    },

    async listInvitations(): Promise<Invitation[]> {
      const response = await request<{ invitations: Invitation[] }>("/v1/invitations");
      return response.invitations;
    },

    async listConnectors(): Promise<CalendarAccount[]> {
      const response = await request<{ accounts: CalendarAccount[] }>("/v1/connectors");
      return response.accounts.map((account) => ({
        ...account,
        health: connectedAccountHealthSchema.parse(account.health),
      }));
    },

    async listXBookmarkFolders(): Promise<XBookmarkFolder[]> {
      const response = await request<{ folders: XBookmarkFolder[] }>("/v1/x-bookmarks/folders");
      return response.folders;
    },

    async listXBookmarks(limit = 50): Promise<XBookmark[]> {
      const response = await request<{ bookmarks: XBookmark[] }>(`/v1/x-bookmarks?limit=${limit}`);
      return response.bookmarks;
    },

    async getXBookmarkAccount(): Promise<XBookmarkAccount | null> {
      const response = await request<{ account: XBookmarkAccount | null }>(
        "/v1/x-bookmarks/account",
      );
      return response.account;
    },

    async getPinterestWallpaperSettings(): Promise<PinterestWallpaperSettings> {
      const response = await request<{ settings: PinterestWallpaperSettings }>("/v1/pinterest");
      return response.settings;
    },

    async listPinterestPins(limit = 12): Promise<PinterestPin[]> {
      const response = await request<{ pins: PinterestPin[] }>(`/v1/pinterest/pins?limit=${limit}`);
      return response.pins;
    },

    async updatePinterestWallpaperSettings(
      input: UpdatePinterestWallpaperSettingsInput,
    ): Promise<PinterestWallpaperSettings> {
      const response = await request<{ settings: PinterestWallpaperSettings }>("/v1/pinterest", {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.settings;
    },

    async recordPinterestWallpaperApplied(): Promise<void> {
      await request<void>("/v1/pinterest/applied", { method: "POST" });
    },

    async listSessions(): Promise<Session[]> {
      const response = await request<{ sessions: Session[] }>("/v1/sessions");
      return response.sessions;
    },

    async login(input: LoginInput): Promise<User> {
      const response = await request<{ sessionToken: string; user: User }>("/v1/auth/login", {
        body: JSON.stringify(input),
        method: "POST",
      });
      sessionToken = response.sessionToken;
      options.onSessionToken?.(sessionToken);
      return response.user;
    },

    async logout(): Promise<void> {
      await request<void>("/v1/auth/logout", { method: "POST" });
      sessionToken = undefined;
      options.onSessionToken?.(null);
    },

    async register(input: RegisterInput): Promise<User> {
      const response = await request<{ sessionToken: string; user: User }>("/v1/auth/register", {
        body: JSON.stringify(input),
        method: "POST",
      });
      sessionToken = response.sessionToken;
      options.onSessionToken?.(sessionToken);
      return response.user;
    },

    async validateInvitation(input: ValidateInvitationInput): Promise<boolean> {
      const response = await request<{ valid: boolean }>("/v1/auth/invitations/validate", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.valid;
    },

    async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
      await request<void>("/v1/auth/recovery", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },

    async resetPassword(input: ResetPasswordInput): Promise<void> {
      await request<void>("/v1/auth/password-reset", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },

    async resendEmailVerification(): Promise<void> {
      await request<void>("/v1/auth/email-verification", { method: "POST" });
    },

    async runAutomation(id: string, dryRun = false): Promise<AutomationRun> {
      const response = await request<{ run: AutomationRun }>(`/v1/automations/${id}/runs`, {
        body: JSON.stringify({ dryRun }),
        method: "POST",
      });
      return response.run;
    },

    async revokeSession(id: string): Promise<void> {
      await request<void>(`/v1/sessions/${id}`, { method: "DELETE" });
    },

    async syncConnector(id: string): Promise<number> {
      const response = await request<{ result: { changed: number } }>(`/v1/connectors/${id}/sync`, {
        method: "POST",
      });
      return response.result.changed;
    },

    async selectXBookmarkFolder(folderId: string): Promise<number> {
      const response = await request<{ result: { changed: number } }>("/v1/x-bookmarks/folder", {
        body: JSON.stringify({ folderId }),
        method: "PUT",
      });
      return response.result.changed;
    },

    async syncXBookmarks(): Promise<number> {
      const response = await request<{ result: { changed: number } }>("/v1/x-bookmarks/sync", {
        method: "POST",
      });
      return response.result.changed;
    },

    async updateAutomation(
      id: string,
      input: UpdateAutomationRoutineInput,
    ): Promise<AutomationRoutine> {
      const response = await request<{ routine: AutomationRoutine }>(`/v1/automations/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.routine;
    },

    async updateUser(input: UpdateUserInput): Promise<User> {
      const response = await request<{ user: User }>("/v1/me", {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.user;
    },

    async updateAccountSetup(input: UpdateAccountSetupInput): Promise<User> {
      const response = await request<{ user: User }>("/v1/setup", {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.user;
    },
  };
}

function toQuery(value: object): string {
  const parameters = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") continue;
    parameters.set(key, Array.isArray(item) ? item.join(",") : String(item));
  }
  return parameters.toString();
}

export type PersonalOsApiClient = ReturnType<typeof createApiClient>;
