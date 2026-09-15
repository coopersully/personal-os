import { createOpenApiDocument } from "./openapi.js";

type OpenApiOperation = {
  deprecated?: boolean;
  description?: string;
  requestBody?: {
    content?: { "application/json"?: { schema?: { $ref?: string } } };
    required?: boolean;
  };
  parameters?: Array<{
    in: string;
    name: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }>;
  responses?: Record<
    number,
    {
      content?: { "application/json"?: { schema?: { $ref?: string } } };
      description?: string;
    }
  >;
  "x-required-scopes"?: string[];
  "x-successor-operation"?: string;
};

type JsonSchema = {
  additionalProperties?: boolean;
  anyOf?: JsonSchema[];
  const?: unknown;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string;
  $ref?: string;
};

function taskOperation(path: string, method: string): OpenApiOperation {
  const document = createOpenApiDocument("https://api.example.com");
  const paths = document.paths as unknown as Record<string, Record<string, unknown>>;
  const operation = paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
  return operation as OpenApiOperation;
}

describe("canonical Tasks OpenAPI surface", () => {
  it("describes the read-only shared projection with all query axes and scope variants", () => {
    const operation = taskOperation("/v1/task-workspace", "get");
    expect(operation["x-required-scopes"]).toEqual(["tasks:read", "reminders:read"]);
    expect(operation.parameters?.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "cursor",
        "limit",
        "kind",
        "view",
        "status",
        "listId",
        "projectId",
        "query",
        "priority",
        "tag",
        "due",
        "reserved",
        "dueAfter",
        "dueBefore",
        "scheduledAfter",
        "scheduledBefore",
        "sort",
        "group",
      ]),
    );
    expect(operation.description).toContain("kind=reminder");
    expect(operation.responses?.[200]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/TaskWorkspacePage" } },
      },
    });
  });
  it("publishes every shipped Task List, Project, and Task route with the correct verb", () => {
    const document = createOpenApiDocument("https://api.example.com");
    const paths = document.paths as unknown as Record<string, Record<string, unknown>>;
    expect(
      Object.fromEntries(
        Object.entries(paths)
          .filter(([path]) => /^\/v1\/task(?:-lists|-projects|s)(?:\/|$)/u.test(path))
          .map(([path, operations]) => [path, Object.keys(operations).toSorted()]),
      ),
    ).toEqual({
      "/v1/task-lists": ["get", "post"],
      "/v1/task-lists/{id}": ["get", "patch"],
      "/v1/task-lists/{id}/archive": ["post"],
      "/v1/task-projects": ["get", "post"],
      "/v1/task-projects/{id}": ["get", "patch"],
      "/v1/task-projects/{id}/archive": ["post"],
      "/v1/task-projects/{id}/cancel": ["post"],
      "/v1/task-projects/{id}/complete": ["post"],
      "/v1/task-projects/{id}/move": ["post"],
      "/v1/task-projects/{id}/move/preview": ["post"],
      "/v1/tasks": ["get", "post"],
      "/v1/tasks/{id}": ["delete", "get", "patch"],
      "/v1/tasks/{id}/cancel": ["post"],
      "/v1/tasks/{id}/complete": ["post"],
      "/v1/tasks/{id}/move": ["post"],
      "/v1/tasks/{id}/move/preview": ["post"],
      "/v1/tasks/{id}/reopen": ["post"],
      "/v1/tasks/{id}/restore": ["post"],
      "/v1/tasks/{id}/trash": ["post"],
    });
  });

  it("documents focused Task transitions, previews, and deprecated DELETE-as-trash", () => {
    const focusedTransitions = [
      ["complete", "Task completed"],
      ["cancel", "Task cancelled"],
      ["reopen", "Task reopened"],
      ["trash", "Task moved to recoverable Trash"],
      ["restore", "Task restored"],
    ] as const;
    for (const [transition, description] of focusedTransitions) {
      const operation = taskOperation(`/v1/tasks/{id}/${transition}`, "post");
      expect(operation["x-required-scopes"]).toEqual(["tasks:write"]);
      expect(operation.responses?.[200]?.description).toBe(description);
      expect(operation.requestBody).toEqual({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/TaskRevisionInput" } },
        },
        required: true,
      });
    }

    const preview = taskOperation("/v1/tasks/{id}/move/preview", "post");
    expect(preview["x-required-scopes"]).toEqual(["tasks:read"]);
    expect(preview.requestBody?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/TaskMovePreviewInput",
    );

    const move = taskOperation("/v1/tasks/{id}/move", "post");
    expect(move["x-required-scopes"]).toEqual(["tasks:write"]);
    expect(move.requestBody?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/TaskMoveInput",
    );

    const legacyDelete = taskOperation("/v1/tasks/{id}", "delete");
    expect(legacyDelete).toMatchObject({
      deprecated: true,
      description: expect.stringContaining("recoverable Trash"),
      responses: { 204: { description: expect.stringContaining("moved to Trash") } },
      "x-required-scopes": ["tasks:write"],
      "x-successor-operation": "POST /v1/tasks/{id}/trash",
    });
  });

  it("assigns read scope to reads and previews and write scope to canonical mutations", () => {
    const readOperations = [
      ["/v1/task-lists", "get"],
      ["/v1/task-lists/{id}", "get"],
      ["/v1/task-projects", "get"],
      ["/v1/task-projects/{id}", "get"],
      ["/v1/task-projects/{id}/move/preview", "post"],
      ["/v1/tasks", "get"],
      ["/v1/tasks/{id}", "get"],
      ["/v1/tasks/{id}/move/preview", "post"],
    ] as const;
    for (const [path, method] of readOperations) {
      expect(taskOperation(path, method)["x-required-scopes"]).toEqual(["tasks:read"]);
    }

    const writeOperations = [
      ["/v1/task-lists", "post"],
      ["/v1/task-lists/{id}", "patch"],
      ["/v1/task-lists/{id}/archive", "post"],
      ["/v1/task-projects", "post"],
      ["/v1/task-projects/{id}", "patch"],
      ["/v1/task-projects/{id}/complete", "post"],
      ["/v1/task-projects/{id}/cancel", "post"],
      ["/v1/task-projects/{id}/archive", "post"],
      ["/v1/task-projects/{id}/move", "post"],
      ["/v1/tasks", "post"],
      ["/v1/tasks/{id}", "patch"],
      ["/v1/tasks/{id}", "delete"],
      ["/v1/tasks/{id}/complete", "post"],
      ["/v1/tasks/{id}/cancel", "post"],
      ["/v1/tasks/{id}/reopen", "post"],
      ["/v1/tasks/{id}/trash", "post"],
      ["/v1/tasks/{id}/restore", "post"],
      ["/v1/tasks/{id}/move", "post"],
    ] as const;
    for (const [path, method] of writeOperations) {
      expect(taskOperation(path, method)["x-required-scopes"]).toEqual(["tasks:write"]);
    }
  });

  it("documents the canonical query parameters for Task collection reads", () => {
    expect(taskOperation("/v1/task-lists", "get").parameters?.map(({ name }) => name)).toEqual([
      "cursor",
      "limit",
    ]);
    expect(taskOperation("/v1/task-projects", "get").parameters?.map(({ name }) => name)).toEqual([
      "cursor",
      "limit",
    ]);
    expect(taskOperation("/v1/tasks", "get").parameters?.map(({ name }) => name)).toEqual([
      "cursor",
      "limit",
      "lifecycle",
      "listId",
      "projectId",
      "view",
      "query",
      "dueAfter",
      "dueBefore",
      "scheduledAfter",
      "scheduledBefore",
    ]);
    expect(
      taskOperation("/v1/tasks", "get").parameters?.find(({ name }) => name === "query")?.schema,
    ).toMatchObject({ maxLength: 200, minLength: 1, type: "string" });
  });
});

describe("Finance maintenance OpenAPI surface", () => {
  const document = createOpenApiDocument("https://api.example.com");
  const paths = document.paths as unknown as Record<string, Record<string, OpenApiOperation>>;
  const schemas = document.components.schemas as unknown as Record<string, JsonSchema>;

  it("documents the required start and resume maintenance inputs", () => {
    const operation = paths["/v1/finances/maintenance"]?.post;
    expect(operation?.requestBody).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FinanceMaintenanceInput" },
        },
      },
      required: true,
    });
    expect(operation?.requestBody?.content?.["application/json"]).toMatchObject({
      examples: {
        allOutstanding: {
          value: { operation: "start", scope: { type: "all_outstanding" } },
        },
        resume: {
          value: {
            operation: "resume",
            runId: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    });

    const [start, resume] = schemas.FinanceMaintenanceInput?.oneOf ?? [];
    expect(start).toMatchObject({
      additionalProperties: false,
      properties: {
        operation: { const: "start", type: "string" },
        scope: { default: { type: "all_outstanding" } },
      },
      required: ["operation"],
      type: "object",
    });
    expect(start?.properties?.scope?.oneOf?.map((scope) => scope.properties?.type?.const)).toEqual([
      "all_outstanding",
      "window",
      "target",
    ]);
    expect(resume).toMatchObject({
      additionalProperties: false,
      properties: {
        operation: { const: "resume", type: "string" },
        runId: { format: "uuid", type: "string" },
      },
      required: ["operation", "runId"],
      type: "object",
    });
  });

  it("documents the synchronous POST tool result envelope", () => {
    const operation = paths["/v1/finances/maintenance"]?.post;
    expect(Object.keys(operation?.responses ?? {}).toSorted()).toEqual([
      "200",
      "403",
      "404",
      "409",
    ]);
    expect(operation?.responses?.[200]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FinanceMaintenanceResult" },
        },
      },
      description: "Finance maintenance result with current durable run state",
    });
    expect(operation?.responses?.[404]).toEqual({
      description: "Finance maintenance run not found for this user",
    });
    expect(schemas.FinanceMaintenanceResult).toMatchObject({
      properties: {
        data: { $ref: "#/components/schemas/FinanceMaintenancePayload" },
        outcome: {
          enum: [
            "completed",
            "work_remaining",
            "user_input_required",
            "external_action_required",
            "failed",
          ],
        },
        schemaVersion: { const: 1 },
      },
      required: ["changes", "communication", "data", "outcome", "remainingWork", "schemaVersion"],
      type: "object",
    });
  });

  it("documents paginated history separately from the exact-run payload", () => {
    const collection = paths["/v1/finances/maintenance"]?.get;
    expect(collection?.parameters?.map(({ name }) => name)).toEqual(["cursor", "limit", "status"]);
    expect(collection?.parameters?.find(({ name }) => name === "cursor")?.schema).toEqual({
      format: "uuid",
      type: "string",
    });
    expect(collection?.parameters?.find(({ name }) => name === "limit")?.schema).toEqual({
      default: 20,
      maximum: 100,
      minimum: 1,
      type: "integer",
    });
    expect(collection?.parameters?.find(({ name }) => name === "status")?.schema).toMatchObject({
      enum: expect.arrayContaining(["awaiting_agent_challenge", "failed_terminal"]),
      type: "string",
    });
    expect(collection?.responses?.[200]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/FinanceMaintenanceHistoryPage",
    );
    expect(schemas.FinanceMaintenanceHistoryPage).toMatchObject({
      properties: {
        items: {
          items: { $ref: "#/components/schemas/FinanceMaintenancePayload" },
          type: "array",
        },
        nextCursor: {
          anyOf: expect.arrayContaining([
            expect.objectContaining({ format: "uuid", type: "string" }),
            { type: "null" },
          ]),
        },
      },
      required: ["items", "nextCursor"],
      type: "object",
    });

    const exact = paths["/v1/finances/maintenance/{id}"]?.get;
    expect(exact?.parameters).toContainEqual({
      in: "path",
      name: "id",
      required: true,
      schema: { format: "uuid", type: "string" },
    });
    expect(exact?.responses?.[200]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/FinanceMaintenancePayload",
    );
    expect(schemas.FinanceMaintenancePayload).toMatchObject({
      properties: {
        challengeId: { anyOf: expect.arrayContaining([{ type: "null" }]) },
        nextAction: { anyOf: expect.arrayContaining([{ type: "null" }]) },
        recovery: { anyOf: expect.arrayContaining([{ type: "null" }]) },
        run: { anyOf: expect.arrayContaining([{ type: "null" }]) },
      },
      required: ["run", "challengeId", "nextAction", "recovery"],
      type: "object",
    });
  });
});

describe("Mail OpenAPI surface", () => {
  it("declares the required identifier for every parameterized Mail operation", () => {
    const document = createOpenApiDocument("https://api.example.com");
    const paths = document.paths as unknown as Record<string, Record<string, OpenApiOperation>>;
    const operations = [
      ["/v1/mail/maintenance/{id}", "get"],
      ["/v1/mail/reviews/{id}", "get"],
      ["/v1/mail/threads/{id}/stewardship", "get"],
      ["/v1/mail/threads/{id}/disposition", "put"],
      ["/v1/mail/threads/{id}/obligations", "post"],
      ["/v1/mail/threads/{id}/response-brief/preview", "post"],
      ["/v1/mail/obligations/{id}", "patch"],
      ["/v1/mail/questions/{id}/answer", "post"],
    ] as const;

    for (const [path, method] of operations) {
      expect(paths[path]?.[method]?.parameters).toContainEqual({
        in: "path",
        name: "id",
        required: true,
        schema: { format: "uuid", type: "string" },
      });
    }
  });
});
