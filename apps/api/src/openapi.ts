export function createOpenApiDocument(apiBaseUrl: string) {
  const security = [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }];
  return {
    components: {
      securitySchemes: {
        bearerAuth: { bearerFormat: "PersonalAccessToken", scheme: "bearer", type: "http" },
        cookieAuth: { in: "cookie", name: "personal_os_session", type: "apiKey" },
        sessionAuth: {
          description: "Desktop human session: `Session sess_…`",
          in: "header",
          name: "Authorization",
          type: "apiKey",
        },
      },
    },
    info: {
      description:
        "The shared reminders, calendar, mail, finance, and assistant data plane for people and agents.",
      title: "ilo API",
      version: "0.1.0",
    },
    openapi: "3.1.0",
    paths: {
      "/health/live": { get: { responses: { 200: { description: "Process is alive" } } } },
      "/health/ready": { get: { responses: { 200: { description: "Dependencies are ready" } } } },
      "/v1/auth/register": { post: { responses: { 201: { description: "Account created" } } } },
      "/v1/auth/invitations/validate": {
        post: { responses: { 200: { description: "Invitation validity checked" } } },
      },
      "/v1/auth/login": { post: { responses: { 200: { description: "Session created" } } } },
      "/v1/auth/recovery": {
        post: { responses: { 204: { description: "Password recovery requested" } } },
      },
      "/v1/auth/password-reset": {
        post: { responses: { 204: { description: "Password reset" } } },
      },
      "/v1/auth/email-verification": {
        post: { security, responses: { 204: { description: "Confirmation email requested" } } },
      },
      "/v1/auth/email-verification/confirm": {
        post: { responses: { 200: { description: "Email confirmed" } } },
      },
      "/v1/auth/logout": {
        post: { security, responses: { 204: { description: "Session revoked" } } },
      },
      "/v1/me": {
        get: { security, responses: { 200: { description: "Current user" } } },
        patch: { security, responses: { 200: { description: "Current user updated" } } },
      },
      "/v1/setup": {
        patch: { security, responses: { 200: { description: "Account setup progress saved" } } },
      },
      "/v1/invitations": {
        get: { security, responses: { 200: { description: "Workspace invitations" } } },
        post: { security, responses: { 201: { description: "Invitation created" } } },
      },
      "/v1/sessions": {
        get: { security, responses: { 200: { description: "Active human sessions" } } },
      },
      "/v1/sessions/{id}": {
        delete: { security, responses: { 204: { description: "Session revoked" } } },
      },
      "/v1/access-tokens": {
        get: { security, responses: { 200: { description: "Agent tokens" } } },
        post: { security, responses: { 201: { description: "Agent token created" } } },
      },
      "/v1/access-tokens/{id}": {
        delete: { security, responses: { 204: { description: "Agent token revoked" } } },
      },
      "/v1/daily-brief": {
        get: { security, responses: { 200: { description: "Time-aware daily brief" } } },
      },
      "/v1/weather": {
        get: { security, responses: { 200: { description: "Current weather for Today" } } },
      },
      "/v1/goals": {
        get: { security, responses: { 200: { description: "Goals" } } },
        post: { security, responses: { 201: { description: "Goal created" } } },
      },
      "/v1/goals/{id}": {
        delete: { security, responses: { 204: { description: "Goal deleted" } } },
        patch: { security, responses: { 200: { description: "Goal updated" } } },
      },
      "/v1/motives": {
        get: { security, responses: { 200: { description: "Motives" } } },
        post: { security, responses: { 201: { description: "Motive created" } } },
      },
      "/v1/motives/{id}": {
        delete: { security, responses: { 204: { description: "Motive deleted" } } },
        patch: { security, responses: { 200: { description: "Motive updated" } } },
      },
      "/v1/automations": {
        get: { security, responses: { 200: { description: "Installed automation routines" } } },
        post: { security, responses: { 201: { description: "Automation routine installed" } } },
      },
      "/v1/automations/runs": {
        get: { security, responses: { 200: { description: "Automation run history" } } },
      },
      "/v1/automations/{id}": {
        patch: { security, responses: { 200: { description: "Automation routine updated" } } },
      },
      "/v1/automations/{id}/runs": {
        post: { security, responses: { 201: { description: "Automation routine run" } } },
      },
      "/v1/reminders": {
        get: { security, responses: { 200: { description: "Reminder page" } } },
        post: { security, responses: { 201: { description: "Reminder created" } } },
      },
      "/v1/reminders/overdue-deferral-preview": {
        get: {
          security,
          responses: { 200: { description: "Exact read-only overdue deferral preview" } },
        },
      },
      "/v1/reminders/{id}": {
        delete: { security, responses: { 204: { description: "Reminder moved to trash" } } },
        get: { security, responses: { 200: { description: "Reminder" } } },
        patch: { security, responses: { 200: { description: "Reminder updated" } } },
      },
      "/v1/reminders/{id}/trash": {
        post: {
          security,
          responses: { 200: { description: "Guarded recoverable Reminder trash revision" } },
        },
      },
      "/v1/reminders/{id}/complete": {
        post: { security, responses: { 200: { description: "Reminder completed or reopened" } } },
      },
      "/v1/reminders/{id}/restore": {
        post: { security, responses: { 200: { description: "Reminder restored" } } },
      },
      "/v1/tasks": {
        get: { security, responses: { 200: { description: "Task page" } } },
        post: { security, responses: { 201: { description: "Task created" } } },
      },
      "/v1/tasks/{id}": {
        delete: { security, responses: { 204: { description: "Task deleted" } } },
        get: { security, responses: { 200: { description: "Task" } } },
        patch: { security, responses: { 200: { description: "Task updated" } } },
      },
      "/v1/tasks/{id}/complete": {
        post: { security, responses: { 200: { description: "Task completed or reopened" } } },
      },
      "/v1/tasks/{id}/restore": {
        post: { security, responses: { 200: { description: "Task restored" } } },
      },
      "/v1/calendars": {
        get: { security, responses: { 200: { description: "Calendars" } } },
        post: { security, responses: { 201: { description: "Local calendar created" } } },
      },
      "/v1/calendars/commitments/preview": {
        post: {
          security,
          responses: { 200: { description: "Calendar commitment proposal preview" } },
        },
      },
      "/v1/calendars/{id}": {
        delete: { security, responses: { 204: { description: "Local calendar deleted" } } },
        patch: { security, responses: { 200: { description: "Local calendar updated" } } },
      },
      "/v1/calendars/{id}/selected": {
        patch: { security, responses: { 200: { description: "Calendar visibility changed" } } },
      },
      "/v1/events": {
        get: { security, responses: { 200: { description: "Unified events" } } },
        post: { security, responses: { 201: { description: "Event created" } } },
      },
      "/v1/events/{id}": {
        delete: { security, responses: { 204: { description: "Event deleted" } } },
        get: { security, responses: { 200: { description: "Event" } } },
        patch: { security, responses: { 200: { description: "Event updated" } } },
      },
      "/v1/events/{id}/blocks": {
        post: { security, responses: { 201: { description: "Linked calendar block created" } } },
      },
      "/v1/events/{id}/blocks/{blockId}": {
        delete: { security, responses: { 200: { description: "Linked calendar block removed" } } },
        patch: {
          security,
          responses: { 200: { description: "Linked calendar block privacy changed" } },
        },
      },
      "/v1/events/{id}/blocks/{blockId}/trash": {
        post: {
          security,
          responses: { 200: { description: "Linked calendar block removed with revision guards" } },
        },
      },
      "/v1/events/{id}/attention": {
        put: {
          security,
          responses: { 200: { description: "Calendar event attention item created or refreshed" } },
        },
      },
      "/v1/events/{id}/restore": {
        post: { security, responses: { 200: { description: "Event restored" } } },
      },
      "/v1/events/{id}/trash": {
        post: {
          security,
          responses: { 200: { description: "Event trashed with restorable revisions" } },
        },
      },
      "/v1/connectors": {
        get: { security, responses: { 200: { description: "Calendar connections" } } },
      },
      "/v1/connectors/google/start": {
        post: { security, responses: { 200: { description: "Google authorization URL" } } },
      },
      "/v1/connectors/google/callback": {
        get: { responses: { 302: { description: "Google authorization completed" } } },
      },
      "/v1/connectors/icloud": {
        post: { security, responses: { 201: { description: "iCloud connected" } } },
      },
      "/v1/connectors/{id}/sync": {
        post: { security, responses: { 200: { description: "Connection synchronized" } } },
      },
      "/v1/connectors/{id}": {
        delete: { security, responses: { 204: { description: "Connection removed" } } },
      },
      "/v1/x-bookmarks/connect/start": {
        post: { security, responses: { 200: { description: "X authorization URL" } } },
      },
      "/v1/x-bookmarks/callback": {
        get: { responses: { 302: { description: "X authorization completed" } } },
      },
      "/v1/x-bookmarks/account": {
        delete: { security, responses: { 204: { description: "X connection removed" } } },
        get: { security, responses: { 200: { description: "X connection" } } },
      },
      "/v1/x-bookmarks/folders": {
        get: { security, responses: { 200: { description: "X bookmark folders" } } },
      },
      "/v1/x-bookmarks/folder": {
        put: { security, responses: { 200: { description: "X bookmark folder selected" } } },
      },
      "/v1/x-bookmarks/sync": {
        post: { security, responses: { 200: { description: "X bookmarks synchronized" } } },
      },
      "/v1/x-bookmarks": {
        get: { security, responses: { 200: { description: "Synchronized X bookmarks" } } },
      },
      "/v1/mailboxes": {
        get: { security, responses: { 200: { description: "Connected mailboxes" } } },
      },
      "/v1/mail/setup-context": {
        get: { security, responses: { 200: { description: "Source-aware Mail setup context" } } },
      },
      "/v1/mail/drafts": {
        get: { security, responses: { 200: { description: "Mail drafts" } } },
        post: { security, responses: { 201: { description: "Mail draft created" } } },
      },
      "/v1/mail/drafts/{id}/reconcile": {
        post: {
          security,
          responses: { 200: { description: "Uncertain Mail draft reconciled by its owner" } },
        },
      },
      "/v1/mail/send": {
        post: { security, responses: { 202: { description: "Mail send accepted" } } },
      },
      "/v1/mail/threads": {
        get: { security, responses: { 200: { description: "Unified mail conversations" } } },
      },
      "/v1/mail/threads/bulk": {
        post: { security, responses: { 200: { description: "Bounded Mail batch result" } } },
      },
      "/v1/mail/threads/{id}": {
        get: { security, responses: { 200: { description: "Mail conversation" } } },
        patch: { security, responses: { 200: { description: "Mail conversation updated" } } },
      },
      "/v1/mail/threads/{id}/attention": {
        put: {
          security,
          responses: { 200: { description: "Source-derived Mail attention item saved" } },
        },
      },
      "/v1/mail/threads/{id}/messages": {
        get: { security, responses: { 200: { description: "Mail conversation messages" } } },
      },
      "/v1/mail/threads/{id}/snooze": {
        post: { security, responses: { 204: { description: "Mail conversation snoozed" } } },
      },
      "/v1/mail/rules": {
        get: { security, responses: { 200: { description: "Mail rules" } } },
        post: { security, responses: { 201: { description: "Mail rule created" } } },
      },
      "/v1/mail/rules/preview": {
        post: { security, responses: { 200: { description: "Mail rule preview" } } },
      },
      "/v1/mail/rules/{id}": {
        patch: { security, responses: { 200: { description: "Mail rule updated" } } },
      },
      "/v1/mail/rules/{id}/preview": {
        get: { security, responses: { 200: { description: "Saved Mail rule reviewed" } } },
      },
      "/v1/mail/rules/{id}/activate": {
        post: { security, responses: { 200: { description: "Reviewed Mail rule activated" } } },
      },
      "/v1/assistant/setup-status": {
        get: { security, responses: { 200: { description: "Agent setup status" } } },
      },
      "/v1/assistant/connection-guide": {
        get: { security, responses: { 200: { description: "Agent connection guide" } } },
      },
      "/v1/assistant/profiles/{domain}": {
        get: { security, responses: { 200: { description: "Domain preference profile" } } },
        put: { security, responses: { 200: { description: "Domain preference profile saved" } } },
      },
      "/v1/assistant/attention": {
        get: { security, responses: { 200: { description: "Domain attention items" } } },
        post: { security, responses: { 201: { description: "Attention item created" } } },
      },
      "/v1/assistant/attention/{domain}/{id}": {
        patch: { security, responses: { 200: { description: "Attention item updated" } } },
      },
      "/v1/audit": { get: { security, responses: { 200: { description: "Activity history" } } } },
    },
    servers: [{ url: apiBaseUrl }],
  } as const;
}
