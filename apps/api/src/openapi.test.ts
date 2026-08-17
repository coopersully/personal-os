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
  responses?: Record<number, { description?: string }>;
  "x-required-scopes"?: string[];
  "x-successor-operation"?: string;
};

function taskOperation(path: string, method: string): OpenApiOperation {
  const document = createOpenApiDocument("https://api.example.com");
  const paths = document.paths as unknown as Record<string, Record<string, unknown>>;
  const operation = paths[path]?.[method];
  expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
  return operation as OpenApiOperation;
}

describe("canonical Tasks OpenAPI surface", () => {
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
