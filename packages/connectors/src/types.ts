import type {
  CreateEventInput,
  MailAddress,
  MailAttachment,
  MailboxRole,
  UpdateEventInput,
} from "@personal-os/domain";

const conferenceHosts = [
  "meet.google.com",
  "teams.live.com",
  "teams.microsoft.com",
  "webex.com",
  "zoom.us",
];

export function extractConferenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidates = value.match(/https?:\/\/[^\s<>()]+/giu) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[.,;:!?]+$/u, ""));
      if (
        conferenceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ) {
        return url.toString();
      }
    } catch {
      // Ignore prose that only resembles a URL.
    }
  }
  return null;
}

export type GoogleCredentials = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  scope: string;
  tokenType: string;
};

export type ICloudCredentials = {
  appSpecificPassword: string;
  email: string;
};

export type XCredentials = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  scope: string;
  tokenType: string;
};

export type XProfile = {
  id: string;
  name: string | null;
  username: string;
};

export type XBookmarkFolder = {
  id: string;
  name: string;
};

export type XBookmark = {
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  postedAt: Date | null;
  raw: Record<string, unknown>;
  remotePostId: string;
  text: string;
  url: string;
};

export type ProviderProfile = {
  email: string;
  id: string;
  name: string | null;
  pictureUrl?: string | null;
};

export type RemoteCalendar = {
  accessRole: string;
  color: string | null;
  id: string;
  name: string;
  primary: boolean;
  selected: boolean;
  timezone: string;
  writable: boolean;
};

export type RemoteMailbox = {
  id: string;
  name: string;
  providerRevision?: string | null;
  role: MailboxRole;
  totalCount: number;
  unreadCount: number;
};

export type NormalizedRemoteMailThread = {
  bodyText: string;
  from: MailAddress;
  mailboxIds: string[];
  messages?: Array<{
    attachments: MailAttachment[];
    bodyText: string;
    cc: MailAddress[];
    from: MailAddress;
    mailboxIds?: string[];
    providerRevision?: string | null;
    receivedAt: Date;
    remoteMessageId: string;
    to: MailAddress[];
  }>;
  messagesComplete?: boolean;
  messageCount: number;
  receivedAt: Date;
  remoteThreadId: string;
  snippet: string;
  starred: boolean;
  subject: string;
  to: MailAddress[];
  unread: boolean;
};

export type NormalizedRemoteEvent = {
  allDay: boolean;
  conferenceUrl: string | null;
  endsAt: Date;
  etag: string | null;
  location: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
  recurrence: string[];
  remoteEventId: string;
  startsAt: Date;
  status: "confirmed" | "tentative" | "cancelled";
  timezone: string;
  title: string;
};

export type RemoteEventChange =
  | { kind: "delete"; remoteEventId: string }
  | { event: NormalizedRemoteEvent; kind: "upsert" };

export type CredentialResult<T> = {
  credentials: GoogleCredentials;
  value: T;
};

export type SyncResult = CredentialResult<{
  changes: RemoteEventChange[];
  nextSyncToken: string;
  reset: boolean;
}>;

export type MailSyncResult = CredentialResult<{
  deletedThreadIds: string[];
  mailboxes: RemoteMailbox[];
  nextSyncToken: string | null;
  reset: boolean;
  threads: NormalizedRemoteMailThread[];
}>;

export type GmailWatch = {
  expiresAt: string;
  historyId: string;
};

export type GoogleCalendarWatch = {
  expiresAt: string;
  resourceId: string;
};

export type GoogleCalendarWatchChannel = {
  address: string;
  id: string;
  token: string;
};

export type RemoteMailThreadState = {
  mailboxIds: string[];
  remoteThreadId: string;
  starred: boolean;
  unread: boolean;
};

export type UpdateRemoteMailThreadInput = {
  addMailboxIds?: string[];
  removeMailboxIds?: string[];
};

export type SendRemoteMailInput = {
  body: string;
  cc: MailAddress[];
  from: string;
  subject: string;
  threadId?: string;
  to: MailAddress[];
};

export type ProviderOperationOptions = {
  deadlineMs?: number;
  signal?: AbortSignal;
};

export function throwIfProviderOperationCancelled(operation?: ProviderOperationOptions): void {
  operation?.signal?.throwIfAborted();
  if (operation?.deadlineMs !== undefined && Date.now() >= operation.deadlineMs) {
    throw new DOMException("Provider operation deadline expired.", "TimeoutError");
  }
}

export type GoogleAuthorizationService = "calendar" | "mail";

export type GoogleConnector = {
  authorizationUrl: (
    state: string,
    codeChallenge: string,
    loginHint?: string,
    services?: GoogleAuthorizationService[],
  ) => string;
  createEvent: (
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    input: CreateEventInput,
  ) => Promise<CredentialResult<NormalizedRemoteEvent>>;
  deleteEvent: (
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    remoteEventId: string,
    etag: string | null,
  ) => Promise<GoogleCredentials>;
  exchangeCode: (code: string, codeVerifier: string) => Promise<GoogleCredentials>;
  getProfile: (credentials: GoogleCredentials) => Promise<CredentialResult<ProviderProfile>>;
  getMailThreadState?: (
    credentials: GoogleCredentials,
    remoteThreadId: string,
  ) => Promise<CredentialResult<RemoteMailThreadState>>;
  listCalendars: (
    credentials: GoogleCredentials,
    operation?: ProviderOperationOptions,
  ) => Promise<CredentialResult<RemoteCalendar[]>>;
  sendMail?: (
    credentials: GoogleCredentials,
    input: SendRemoteMailInput,
  ) => Promise<GoogleCredentials>;
  updateMailThread?: (
    credentials: GoogleCredentials,
    remoteThreadId: string,
    input: UpdateRemoteMailThreadInput,
  ) => Promise<GoogleCredentials>;
  syncMail?: (
    credentials: GoogleCredentials,
    syncToken: string | null,
    operation?: ProviderOperationOptions,
  ) => Promise<MailSyncResult>;
  trashMailThread?: (
    credentials: GoogleCredentials,
    remoteThreadId: string,
  ) => Promise<GoogleCredentials>;
  stopCalendarWatch?: (
    credentials: GoogleCredentials,
    channelId: string,
    resourceId: string,
    operation?: ProviderOperationOptions,
  ) => Promise<GoogleCredentials>;
  syncCalendar: (
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    syncToken: string | null,
    operation?: ProviderOperationOptions,
  ) => Promise<SyncResult>;
  updateEvent: (
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    remoteEventId: string,
    etag: string | null,
    input: UpdateEventInput,
  ) => Promise<CredentialResult<NormalizedRemoteEvent>>;
  watchCalendarEvents?: (
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    channel: GoogleCalendarWatchChannel,
    operation?: ProviderOperationOptions,
  ) => Promise<CredentialResult<GoogleCalendarWatch>>;
  watchCalendarList?: (
    credentials: GoogleCredentials,
    channel: GoogleCalendarWatchChannel,
    operation?: ProviderOperationOptions,
  ) => Promise<CredentialResult<GoogleCalendarWatch>>;
  watchGmail?: (
    credentials: GoogleCredentials,
    topicName: string,
    operation?: ProviderOperationOptions,
  ) => Promise<CredentialResult<GmailWatch>>;
};

export type ICloudConnector = {
  createEvent: (
    credentials: ICloudCredentials,
    remoteCalendarId: string,
    input: CreateEventInput,
  ) => Promise<NormalizedRemoteEvent>;
  deleteEvent: (
    credentials: ICloudCredentials,
    remoteEventId: string,
    etag: string | null,
  ) => Promise<void>;
  listCalendars: (
    credentials: ICloudCredentials,
    operation?: ProviderOperationOptions,
  ) => Promise<RemoteCalendar[]>;
  listenForMailChanges?: (
    credentials: ICloudCredentials,
    onChange: () => Promise<void> | void,
    operation?: ProviderOperationOptions,
  ) => Promise<void>;
  sendMail?: (credentials: ICloudCredentials, input: SendRemoteMailInput) => Promise<void>;
  updateMailThread?: (
    credentials: ICloudCredentials,
    remoteThreadId: string,
    input: UpdateRemoteMailThreadInput,
  ) => Promise<void>;
  syncCalendar: (
    credentials: ICloudCredentials,
    remoteCalendarId: string,
    syncToken: string | null,
    operation?: ProviderOperationOptions,
  ) => Promise<SyncResult["value"]>;
  syncMail: (
    credentials: ICloudCredentials,
    syncToken: string | null,
    operation?: ProviderOperationOptions,
  ) => Promise<MailSyncResult["value"]>;
  updateEvent: (
    credentials: ICloudCredentials,
    remoteCalendarId: string,
    remoteEventId: string,
    etag: string | null,
    input: UpdateEventInput,
  ) => Promise<NormalizedRemoteEvent>;
};

export type XConnector = {
  authorizationUrl: (state: string, codeVerifier: string) => string;
  exchangeCode: (code: string, codeVerifier: string) => Promise<XCredentials>;
  getProfile: (credentials: XCredentials) => Promise<CredentialResult<XProfile>>;
  listBookmarkFolders: (
    credentials: XCredentials,
    userId: string,
  ) => Promise<CredentialResult<XBookmarkFolder[]>>;
  listFolderBookmarks: (
    credentials: XCredentials,
    userId: string,
    folderId: string,
  ) => Promise<CredentialResult<XBookmark[]>>;
};
