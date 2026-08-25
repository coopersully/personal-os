export function createOpenApiDocument(apiBaseUrl: string) {
  const security = [{ bearerAuth: [] }, { cookieAuth: [] }, { sessionAuth: [] }];
  return {
    components: {
      schemas: {
        FinanceMaintenanceRequest: {
          properties: {
            scope: { $ref: "#/components/schemas/MaintenanceScope" },
          },
          type: "object",
        },
        FinanceMaintenanceResult: {
          properties: {
            applied: {
              properties: {
                categorizations: { minimum: 0, type: "integer" },
                transfers: { minimum: 0, type: "integer" },
              },
              required: ["categorizations", "transfers"],
              type: "object",
            },
            asOf: { format: "date-time", type: "string" },
            health: {
              properties: {
                applicability: { enum: ["not_run", "applied", "skipped_scoped"], type: "string" },
                confidence: {
                  enum: ["insufficient", "provisional", "reliable"],
                  type: "string",
                },
                refreshed: { type: "boolean" },
              },
              required: ["applicability", "confidence", "refreshed"],
              type: "object",
            },
            questions: {
              properties: {
                created: { minimum: 0, type: "integer" },
                total: { minimum: 0, type: "integer" },
              },
              required: ["created", "total"],
              type: "object",
            },
            verification: {
              properties: {
                duplicateActions: { minimum: 0, type: "integer" },
                freshness: {
                  enum: ["current", "stale", "partial", "unavailable"],
                  type: "string",
                },
                state: {
                  enum: ["clean", "needs_work", "needs_input", "blocked"],
                  type: "string",
                },
              },
              required: ["duplicateActions", "freshness", "state"],
              type: "object",
            },
          },
          required: ["applied", "asOf", "health", "questions", "verification"],
          type: "object",
        },
        FinanceMaintenanceRunResponse: {
          properties: { run: { $ref: "#/components/schemas/MaintenanceRun" } },
          required: ["run"],
          type: "object",
        },
        MaintenanceFailureResult: {
          properties: {
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
        MaintenanceRun: {
          properties: {
            id: { format: "uuid", type: "string" },
            rulebookVersion: { type: "string" },
            scope: { $ref: "#/components/schemas/MaintenanceScope" },
            settledResult: {
              anyOf: [
                { $ref: "#/components/schemas/FinanceMaintenanceResult" },
                { $ref: "#/components/schemas/MaintenanceFailureResult" },
                { type: "null" },
              ],
            },
            status: {
              enum: [
                "queued",
                "running",
                "completed",
                "completed_with_questions",
                "awaiting_approval",
                "blocked",
                "failed_recoverable",
                "failed_terminal",
              ],
              type: "string",
            },
          },
          required: ["id", "rulebookVersion", "scope", "settledResult", "status"],
          type: "object",
        },
        MaintenanceScope: {
          discriminator: { propertyName: "type" },
          oneOf: [
            {
              properties: { type: { const: "all_outstanding" } },
              required: ["type"],
              type: "object",
            },
            {
              properties: {
                end: { format: "date", type: "string" },
                start: { format: "date", type: "string" },
                type: { const: "window" },
              },
              required: ["type", "start", "end"],
              type: "object",
            },
            {
              properties: {
                entityType: { type: "string" },
                id: { format: "uuid", type: "string" },
                type: { const: "target" },
              },
              required: ["type", "entityType", "id"],
              type: "object",
            },
          ],
        },
      },
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
      "/v1/finances/status": {
        get: {
          parameters: [
            {
              in: "query",
              name: "start",
              required: false,
              schema: { format: "date", type: "string" },
            },
            {
              in: "query",
              name: "end",
              required: false,
              schema: { format: "date", type: "string" },
            },
            { in: "query", name: "entityType", required: false, schema: { type: "string" } },
            {
              in: "query",
              name: "targetId",
              required: false,
              schema: { format: "uuid", type: "string" },
            },
          ],
          security,
          responses: { 200: { description: "Authoritative Finance status" } },
        },
      },
      "/v1/finances/maintenance": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                examples: {
                  allOutstanding: { value: { scope: { type: "all_outstanding" } } },
                  target: {
                    value: {
                      scope: {
                        entityType: "finance_transaction",
                        id: "11111111-1111-4111-8111-111111111111",
                        type: "target",
                      },
                    },
                  },
                  window: {
                    value: {
                      scope: { end: "2026-08-15", start: "2026-08-01", type: "window" },
                    },
                  },
                },
                schema: { $ref: "#/components/schemas/FinanceMaintenanceRequest" },
              },
            },
            required: false,
          },
          responses: {
            202: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FinanceMaintenanceRunResponse" },
                },
              },
              description: "Finance maintenance run durably accepted for background work",
            },
            403: { description: "The caller lacks finances:maintain" },
            409: { description: "A conflicting Finance maintenance run or rulebook is active" },
          },
          security,
        },
      },
      "/v1/finances/maintenance/{id}": {
        get: {
          parameters: [
            { in: "path", name: "id", required: true, schema: { format: "uuid", type: "string" } },
          ],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FinanceMaintenanceRunResponse" },
                },
              },
              description: "Owned Finance maintenance run",
            },
            403: { description: "The caller lacks finances:read" },
            404: { description: "Finance maintenance run not found for this user" },
          },
          security,
        },
      },
      "/v1/mail/status": {
        get: {
          security,
          responses: { 200: { description: "Authoritative Mail stewardship status" } },
        },
      },
      "/v1/mail/maintenance": {
        post: {
          security,
          responses: {
            200: { description: "Durable Mail maintenance result with honest settlement" },
            403: { description: "The caller lacks mail:write" },
            409: { description: "A conflicting Mail maintenance run is active" },
          },
        },
      },
      "/v1/mail/maintenance/{id}": {
        get: {
          security,
          responses: { 200: { description: "Owned Mail maintenance run" } },
        },
      },
      "/v1/mail/reviews/{id}": {
        get: { security, responses: { 200: { description: "Immutable Mail review artifact" } } },
      },
      "/v1/mail/threads/{id}/stewardship": {
        get: { security, responses: { 200: { description: "Exact-thread stewardship ledger" } } },
      },
      "/v1/mail/threads/{id}/disposition": {
        put: { security, responses: { 200: { description: "Revision-checked disposition" } } },
      },
      "/v1/mail/threads/{id}/obligations": {
        post: { security, responses: { 201: { description: "Revision-bound Mail obligation" } } },
      },
      "/v1/mail/threads/{id}/response-brief/preview": {
        post: {
          security,
          responses: { 200: { description: "Private non-transmittable response checklist" } },
        },
      },
      "/v1/mail/obligations/{id}": {
        patch: { security, responses: { 200: { description: "Version-checked obligation" } } },
      },
      "/v1/mail/questions/{id}/answer": {
        post: { security, responses: { 200: { description: "Version-checked Mail answer" } } },
      },
      "/v1/mail/feedback": {
        post: {
          security,
          responses: { 201: { description: "Immutable Mail stewardship feedback" } },
        },
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
      "/v1/reminders/{id}/attention": {
        put: {
          security,
          responses: {
            200: { description: "Reminder attention item created or refreshed" },
          },
        },
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
      "/v1/calendars/reviews": {
        post: {
          security,
          responses: { 201: { description: "Immutable Calendar review created" } },
        },
      },
      "/v1/calendars/status": {
        get: { security, responses: { 200: { description: "Calendar stewardship status" } } },
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
        get: { responses: { 303: { description: "Safe Google authorization outcome redirect" } } },
      },
      "/v1/connectors/google/gmail/notifications": {
        post: {
          responses: {
            204: { description: "Authenticated Gmail change signal durably accepted" },
            401: { description: "Pub/Sub identity rejected" },
            404: { description: "Notification route or subscription unavailable" },
            503: { description: "Durable acknowledgement unavailable; provider should retry" },
          },
        },
      },
      "/v1/connectors/google/calendar/notifications": {
        post: {
          responses: {
            204: { description: "Verified Calendar change signal durably accepted" },
            400: { description: "Malformed notification headers" },
            404: { description: "Notification route or channel unavailable" },
            503: { description: "Durable acknowledgement unavailable; provider should retry" },
          },
        },
      },
      "/v1/connectors/authorization-attempts/{id}": {
        get: {
          security,
          responses: { 200: { description: "Safe connector authorization outcome" } },
        },
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
        get: { responses: { 303: { description: "Safe X authorization outcome redirect" } } },
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
        get: { security, responses: { 200: { description: "Historical Mail drafts" } } },
        post: {
          deprecated: true,
          security,
          responses: { 410: { description: "Mail sending is permanently unavailable" } },
        },
      },
      "/v1/mail/drafts/{id}": {
        delete: { security, responses: { 204: { description: "Historical Mail draft deleted" } } },
      },
      "/v1/mail/drafts/{id}/reconcile": {
        post: {
          deprecated: true,
          security,
          responses: { 410: { description: "Mail sending is permanently unavailable" } },
        },
      },
      "/v1/mail/send": {
        post: {
          deprecated: true,
          security,
          responses: { 410: { description: "Mail sending is permanently unavailable" } },
        },
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
      "/v1/assistant/context": {
        get: {
          security,
          responses: { 200: { description: "Authenticated Ilo agent context" } },
        },
      },
      "/v1/assistant/setup-plan": {
        get: {
          security,
          responses: { 200: { description: "Current server-owned agent setup plan" } },
        },
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
