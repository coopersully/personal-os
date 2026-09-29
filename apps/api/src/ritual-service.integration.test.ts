import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  ritualOccurrences,
  ritualRequests,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createRitualService } from "./ritual-service.js";
import type { Principal } from "./types.js";

describe.sequential("ritual account lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let service: ReturnType<typeof createRitualService>;
  let clock = new Date("2026-09-29T12:00:00Z");
  const context = () => ({
    principal: {
      actorId: userId,
      actorType: "user",
      scopes: new Set(["tracking:read", "tracking:write"]),
      userId,
    } satisfies Principal,
    requestId: crypto.randomUUID(),
  });
  const mutation = (revision: number) => ({
    requestId: crypto.randomUUID(),
    deviceId: "test",
    expectedRevision: revision,
    observedAt: clock.toISOString(),
  });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({ displayName: "Ritual", email: "ritual@example.com", passwordHash: "unused" })
      .returning();
    userId = user!.id;
    service = createRitualService({ db: database.db, now: () => clock });
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("saves definitions, records every escape, enforces confirmation and preserves partial history", async () => {
    const morning = await service.saveDefinition(
      "morning",
      {
        ...mutation(0),
        kind: "morning",
        title: "Good morning",
        enabled: true,
        time: "06:00",
        timeZone: "America/New_York",
        steps: [
          { id: "teeth", label: "Teeth", kind: "checkbox" },
          { id: "journal", label: "Journal", kind: "short_text" },
        ],
      },
      context(),
    );
    expect(morning.revision).toBe(1);
    let state = await service.current(context());
    expect(state.current?.definition.title).toBe("Good morning");
    const id = state.current!.id;
    state = await service.saveResponse(
      id,
      "teeth",
      { ...mutation(state.current!.revision), value: true, submitted: true },
      context(),
    );
    for (let count = 0; count < 2; count++) {
      const result = await service.act(
        id,
        { ...mutation(state.current!.revision), kind: "snooze" },
        context(),
      );
      expect(result.outcome).toBe("applied");
      state = result.state;
      clock = new Date(clock.getTime() + 600001);
    }
    const attempt = { ...mutation(state.current!.revision), kind: "snooze" as const };
    const challenge = await service.act(id, attempt, context());
    expect(challenge.outcome).toBe("confirmation_required");
    if (challenge.outcome !== "confirmation_required") throw new Error("missing challenge");
    expect(challenge.count).toBe(2);
    expect(await service.act(id, attempt, context())).toEqual(challenge);
    const cancelled = await service.act(
      id,
      {
        ...mutation(challenge.state.current!.revision),
        kind: "cancel_snooze",
        challengeId: challenge.challengeId,
      },
      context(),
    );
    expect(cancelled.state.snoozeCount).toBe(2);
    state = await service.saveResponse(
      id,
      "journal",
      { ...mutation(cancelled.state.current!.revision), value: "Private draft", submitted: false },
      context(),
    );
    expect(state.current?.status).toBe("pending");
    state = await service.saveResponse(
      id,
      "journal",
      { ...mutation(state.current!.revision), value: "Private answer", submitted: true },
      context(),
    );
    expect(state.current?.status).toBe("pending");
    const completed = await service.act(
      id,
      { ...mutation(state.current!.revision), kind: "complete" },
      context(),
    );
    expect(completed).toMatchObject({
      outcome: "applied",
      state: { current: { status: "completed" } },
    });
    const foreign = {
      ...context(),
      principal: { ...context().principal, userId: crypto.randomUUID() },
    };
    await expect(
      service.saveResponse(id, "teeth", { ...mutation(1), value: true, submitted: true }, foreign),
    ).rejects.toThrow();
    const logs = await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId));
    expect(JSON.stringify(logs)).not.toContain("Private answer");
    expect(logs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "ritual.definition_saved",
        "ritual.response_saved",
        "ritual.snooze",
        "ritual.complete",
      ]),
    );
    expect(logs.find((log) => log.action === "ritual.complete")?.after).toMatchObject({
      occurrenceId: id,
      outcome: "applied",
    });
    const history = await service.history(context(), { limit: 50 });
    expect(history.items[0]?.actions.map((a) => a.kind)).toEqual([
      "snooze_pressed",
      "snooze_confirmed",
      "snooze_pressed",
      "snooze_confirmed",
      "snooze_pressed",
      "snooze_cancelled",
      "complete_applied",
    ]);
  });
  it("expires unfinished work and skips only the current occurrence", async () => {
    clock = new Date("2026-09-30T12:00:00Z");
    let state = await service.current(context());
    expect(state.current?.status).toBe("pending");
    clock = new Date("2026-10-01T12:00:00Z");
    state = await service.current(context());
    expect(
      (await service.history(context(), { limit: 50 })).items.some((o) => o.status === "missed"),
    ).toBe(true);
    const result = await service.act(
      state.current!.id,
      { ...mutation(state.current!.revision), kind: "skip" },
      context(),
    );
    expect(result.state.current?.status).toBe("skipped");
    await service.deleteData("morning", context());
    expect((await service.history(context(), { limit: 50 })).items).toEqual([]);
  });
  it("keeps an open snapshot after rescheduling and counts earlier same-millisecond actions", async () => {
    clock = new Date("2026-10-03T12:00:00Z");
    const def = await service.saveDefinition(
      "morning",
      {
        ...mutation(0),
        kind: "morning",
        title: "Start",
        enabled: true,
        time: "06:00",
        timeZone: "America/New_York",
        steps: [{ id: "teeth", label: "Teeth", kind: "checkbox" }],
      },
      context(),
    );
    const original = (await service.current(context())).current;
    await service.saveDefinition(
      "morning",
      {
        ...mutation(def.revision),
        kind: "morning",
        title: "Later",
        enabled: true,
        time: "18:00",
        timeZone: "America/New_York",
        steps: [{ id: "new", label: "New step", kind: "checkbox" }],
      },
      context(),
    );
    let state = await service.current(context());
    expect(state.current?.id).toBe(original?.id);
    expect(state.current?.definition.title).toBe("Start");
    for (let n = 0; n < 2; n++) {
      const result = await service.act(
        state.current!.id,
        { ...mutation(state.current!.revision), kind: "snooze" },
        context(),
      );
      state = result.state;
    }
    const result = await service.act(
      state.current!.id,
      { ...mutation(state.current!.revision), kind: "snooze" },
      context(),
    );
    expect(result.outcome).toBe("confirmation_required");
  });
  it("replays a durable snooze challenge and cancellation without applying a snooze", async () => {
    const state = await service.current(context());
    const input = {
      ...mutation(state.current!.revision),
      kind: "snooze" as const,
      requireConfirmation: true,
    };
    const result = await service.act(state.current!.id, input, context());
    expect(result.outcome).toBe("confirmation_required");
    if (result.outcome !== "confirmation_required") throw new Error("missing challenge");
    expect(result.challengeId).toBe(input.requestId);
    const cancel = await service.act(
      state.current!.id,
      {
        ...mutation(result.state.current!.revision),
        kind: "cancel_snooze",
        challengeId: input.requestId,
      },
      context(),
    );
    expect(cancel.outcome).toBe("applied");
    expect(cancel.state.snoozeCount).toBe(state.snoozeCount);
  });
  it("filters history by ritual and local dates", async () => {
    expect((await service.history(context(), { limit: 10, kind: "night" })).items).toEqual([]);
    expect((await service.history(context(), { limit: 10, dateFrom: "2027-01-01" })).items).toEqual(
      [],
    );
    const page = await service.history(context(), {
      limit: 10,
      kind: "morning",
      dateTo: "2026-10-03",
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.every(
        (o) => o.definition.kind === "morning" && o.scheduledLocalDate <= "2026-10-03",
      ),
    ).toBe(true);
  });
  it("keeps today's open occurrence when its edited time is also already past", async () => {
    const current = (await service.current(context())).current!;
    const def = (await service.list(context()))[0]!;
    await service.saveDefinition(
      "morning",
      { ...def, ...mutation(def.revision), time: "07:00" },
      context(),
    );
    const after = (await service.current(context())).current!;
    expect(after.id).toBe(current.id);
    expect(after.status).toBe("pending");
    expect(after.definition).toEqual(current.definition);
  });
  it("deletion removes legacy private snapshots while preserving compact retries for the other ritual", async () => {
    const morning = (await service.list(context()))[0]!;
    await service.saveDefinition(
      "morning",
      { ...morning, ...mutation(morning.revision), title: "Private morning detail" },
      context(),
    );
    await service.saveDefinition(
      "night",
      {
        ...mutation(0),
        kind: "night",
        title: "Night",
        time: "21:00",
        enabled: true,
        timeZone: "America/New_York",
        steps: [{ id: "sleep", label: "Sleep", kind: "checkbox" }],
      },
      context(),
    );
    clock = new Date("2026-10-04T02:00:00Z");
    const state = await service.current(context());
    const input = { ...mutation(state.current!.revision), kind: "snooze" as const };
    await service.act(state.current!.id, input, context());
    await database.db.insert(ritualRequests).values({
      userId,
      ritualId: state.current!.ritualId,
      requestId: crypto.randomUUID(),
      fingerprint: "legacy",
      result: state,
    });
    await service.deleteData("morning", context());
    const saved = await database.db
      .select()
      .from(ritualRequests)
      .where(eq(ritualRequests.userId, userId));
    expect(JSON.stringify(saved)).not.toContain("Private morning detail");
    const replay = await service.act(state.current!.id, input, context());
    expect(replay.outcome).toBe("applied");
    expect(replay.state.definitions.some((d) => d.kind === "morning")).toBe(false);
    expect(replay.state.current?.actions.filter((a) => a.kind === "snooze_pressed")).toHaveLength(
      1,
    );
  });
  it("serializes competing completion and skip without reopening terminal history", async () => {
    for (const definition of await service.list(context())) {
      await service.deleteData(definition.kind, context());
    }
    await service.saveDefinition(
      "morning",
      {
        ...mutation(0),
        kind: "morning",
        title: "Concurrent ritual",
        enabled: true,
        time: "06:00",
        timeZone: "America/New_York",
        steps: [{ id: "one", label: "One", kind: "checkbox" }],
      },
      context(),
    );
    let current = (await service.current(context())).current!;
    const saved = await service.saveResponse(
      current.id,
      "one",
      { ...mutation(current.revision), value: true, submitted: true },
      context(),
    );
    current = saved.current!;
    expect(current.status).toBe("pending");
    const completion = { ...mutation(current.revision), kind: "complete" as const };
    const skip = { ...mutation(current.revision), kind: "skip" as const };
    const outcomes = await Promise.all([
      service.act(current.id, completion, context()),
      service.act(current.id, skip, context()),
    ]);
    const final = (await service.current(context())).current!;
    expect(["completed", "skipped"]).toContain(final.status);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["applied", "conflict"]);
    expect(final.actions.filter((a) => a.kind === "skip_pressed")).toHaveLength(1);
    expect(final.responses).toHaveLength(1);
    const completionReplay = await service.act(current.id, completion, context());
    const skipReplay = await service.act(current.id, skip, context());
    expect(completionReplay.outcome).toBe(outcomes[0]!.outcome);
    expect(skipReplay.outcome).toBe(outcomes[1]!.outcome);
    expect(completionReplay.state.current).toEqual(final);
    expect(skipReplay.state.current).toEqual(final);
    await expect(
      service.saveResponse(
        current.id,
        "one",
        { ...mutation(final.revision), value: true, submitted: true },
        context(),
      ),
    ).rejects.toThrow(/changed/);
  });
  it("rejects incompatible settings and invalid responses without changing the snapshot", async () => {
    for (const d of await service.list(context())) await service.deleteData(d.kind, context());
    clock = new Date("2026-10-07T12:00:00Z");
    const input = {
      ...mutation(0),
      kind: "morning" as const,
      title: "Validate",
      enabled: true,
      time: "06:00",
      timeZone: "America/New_York",
      steps: [
        { id: "check", label: "Check", kind: "checkbox" as const },
        { id: "text", label: "Text", kind: "short_text" as const },
        { id: "time", label: "Wake up", kind: "time" as const },
        { id: "date", label: "Date", kind: "date" as const },
        { id: "number", label: "Minutes", kind: "number" as const },
        { id: "mood", label: "Mood", kind: "multiple_choice" as const, options: ["Good", "Okay"] },
      ],
    };
    await expect(service.saveDefinition("night", input, context())).rejects.toThrow(/match/);
    const definition = await service.saveDefinition("morning", input, context());
    expect(await service.saveDefinition("morning", input, context())).toEqual(definition);
    await expect(
      service.saveDefinition("morning", { ...input, title: "Changed payload" }, context()),
    ).rejects.toThrow();
    await expect(
      service.saveDefinition("morning", { ...input, requestId: crypto.randomUUID() }, context()),
    ).rejects.toThrow(/changed/);
    await expect(
      service.saveDefinition(
        "night",
        { ...input, requestId: crypto.randomUUID(), kind: "night" },
        context(),
      ),
    ).rejects.toThrow(/different times/);
    await expect(
      service.saveDefinition(
        "night",
        {
          ...input,
          requestId: crypto.randomUUID(),
          kind: "night",
          time: "21:00",
          timeZone: "Europe/London",
        },
        context(),
      ),
    ).rejects.toThrow(/same time zone/);
    const current = (await service.current(context())).current!;
    for (const [stepId, value, submitted] of [
      ["absent", true, true],
      ["check", "bad", true],
      ["text", true, true],
      ["text", "  ", true],
      ["time", "25:00", true],
      ["date", "2026-02-30", true],
      ["number", "Infinity", true],
      ["mood", "Not an option", true],
    ] as const) {
      await expect(
        service.saveResponse(
          current.id,
          stepId,
          { ...mutation(current.revision), value, submitted },
          context(),
        ),
      ).rejects.toThrow();
    }
    expect((await service.current(context())).current?.responses).toEqual([]);
    const incomplete = await service.act(
      current.id,
      { ...mutation(current.revision), kind: "complete" },
      context(),
    );
    expect(incomplete).toMatchObject({
      outcome: "conflict",
      state: { current: { status: "pending" } },
    });
    let answered = incomplete.state;
    for (const [stepId, value] of [
      ["check", true],
      ["text", "Reflection"],
      ["time", "06:30"],
      ["date", "2026-10-07"],
      ["number", "15.5"],
      ["mood", "Good"],
    ] as const) {
      answered = await service.saveResponse(
        current.id,
        stepId,
        { ...mutation(answered.current!.revision), value, submitted: true },
        context(),
      );
      expect(answered.current?.status).toBe("pending");
    }
    expect(answered.current?.responses).toHaveLength(6);
    expect((await service.export(context())).definitions).toHaveLength(1);
    await service.saveDefinition(
      "morning",
      { ...input, ...mutation(definition.revision), enabled: false },
      context(),
    );
    expect((await service.history(context(), { limit: 1 })).items[0]?.status).toBe(
      "cancelled_configuration",
    );
    await service.saveDefinition(
      "morning",
      { ...input, ...mutation(definition.revision + 1), enabled: true },
      context(),
    );
    expect((await service.list(context()))[0]?.enabledAt).toBe(clock.toISOString());
  });

  it("refreshes changed snooze counts and rejects another device or a reused challenge", async () => {
    clock = new Date("2026-10-08T12:00:00Z");
    let current = (await service.current(context())).current!;
    const challenge = await service.act(
      current.id,
      { ...mutation(current.revision), kind: "snooze", requireConfirmation: true },
      context(),
    );
    if (challenge.outcome !== "confirmation_required") throw Error("Expected challenge");
    const other = await service.act(
      current.id,
      { ...mutation(challenge.state.current!.revision), deviceId: "other", kind: "snooze" },
      context(),
    );
    const refresh = await service.act(
      current.id,
      {
        ...mutation(other.state.current!.revision),
        kind: "confirm_snooze",
        challengeId: challenge.challengeId,
        displayedCount: 0,
      },
      context(),
    );
    expect(refresh).toMatchObject({ outcome: "confirmation_required", count: 1 });
    const wrong = await service.act(
      current.id,
      {
        ...mutation(refresh.state.current!.revision),
        deviceId: "other",
        kind: "confirm_snooze",
        challengeId: challenge.challengeId,
        displayedCount: 1,
      },
      context(),
    );
    expect(wrong.outcome).toBe("conflict");
    const confirmed = await service.act(
      current.id,
      {
        ...mutation(wrong.state.current!.revision),
        kind: "confirm_snooze",
        challengeId: challenge.challengeId,
        displayedCount: 1,
      },
      context(),
    );
    expect(confirmed).toMatchObject({ outcome: "applied", state: { snoozeCount: 2 } });
    const reused = await service.act(
      current.id,
      {
        ...mutation(confirmed.state.current!.revision),
        kind: "confirm_snooze",
        challengeId: challenge.challengeId,
        displayedCount: 2,
      },
      context(),
    );
    expect(reused).toMatchObject({ outcome: "conflict", state: { snoozeCount: 2 } });
    current = reused.state.current!;
    const offline = await service.act(
      current.id,
      { ...mutation(current.revision), kind: "snooze", requireConfirmation: true },
      context(),
    );
    if (offline.outcome !== "confirmation_required") throw Error("Expected offline challenge");
    const result = await service.act(
      current.id,
      {
        ...mutation(offline.state.current!.revision),
        kind: "confirm_snooze",
        challengeId: offline.challengeId,
        displayedCount: 0,
        historyUnavailable: true,
      },
      context(),
    );
    expect(result).toMatchObject({ outcome: "applied", state: { snoozeCount: 3 } });
  });
  it("settles expired occurrences when history or export is the only reader", async () => {
    for (const read of [
      () => service.history(context(), { limit: 50 }).then((r) => r.items),
      () => service.export(context()).then((r) => r.occurrences),
    ]) {
      clock = new Date(clock.getTime() + 86400000);
      const current = (await service.current(context())).current!;
      expect(current.status).toBe("pending");
      clock = new Date(Date.parse(current.expiresAt) + 1);
      const rows = await read();
      expect(rows.find((r) => r.id === current.id)?.status).toBe("missed");
    }
  });
  it("paginates equal-time occurrences without losing the tie", async () => {
    const [row] = await database.db
      .select()
      .from(ritualOccurrences)
      .where(eq(ritualOccurrences.userId, userId));
    const id = crypto.randomUUID();
    await database.db.insert(ritualOccurrences).values({
      ...row!,
      id,
      localDate: "2025-01-01",
      data: { ...row!.data, id, scheduledLocalDate: "2025-01-01", status: "completed" },
    });
    const expected = (await service.history(context(), { limit: 50 })).items.map((o) => o.id);
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.history(context(), { limit: 1, ...(cursor ? { cursor } : {}) });
      actual.push(...page.items.map((o) => o.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(actual).toEqual(expected);
    expect(actual).toContain(id);
  });
  it("stores bounded retry receipts without duplicating private answers", async () => {
    const rows = await database.db
      .select()
      .from(ritualRequests)
      .where(eq(ritualRequests.userId, userId));
    const receipts = rows.map((r) => r.result).filter((r) => r !== null);
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt).toMatchObject({ receiptVersion: 1 });
      expect(JSON.stringify(receipt).length).toBeLessThan(400);
      expect(receipt).not.toHaveProperty("state");
      expect(receipt).not.toHaveProperty("responses");
    }
  });
  it("replays definition receipts from immutable versions and answer receipts with fresh state", async () => {
    const definition = (await service.list(context()))[0]!;
    const input = {
      ...definition,
      ...mutation(definition.revision),
      title: "Original receipt title",
      steps: [{ id: "receipt", label: "Receipt", kind: "checkbox" as const }],
    };
    const saved = await service.saveDefinition(definition.kind, input, context());
    await service.saveDefinition(
      definition.kind,
      { ...saved, ...mutation(saved.revision), title: "Latest title" },
      context(),
    );
    expect(await service.saveDefinition(definition.kind, input, context())).toEqual(saved);
    expect((await service.list(context())).find((d) => d.id === definition.id)?.title).toBe(
      "Latest title",
    );
    clock = new Date(clock.getTime() + 86400000);
    const current = (await service.current(context())).current!;
    const answer = { ...mutation(current.revision), value: true, submitted: true };
    const answered = await service.saveResponse(current.id, "receipt", answer, context());
    const corrected = await service.saveResponse(
      current.id,
      "receipt",
      { ...mutation(answered.current!.revision), value: false, submitted: false },
      context(),
    );
    const replay = await service.saveResponse(current.id, "receipt", answer, context());
    expect(replay.current).toEqual(corrected.current);
    expect(replay.current?.responses).toHaveLength(2);
    expect(replay.current?.responses.at(-1)?.value).toBe(false);
  });
  it("ages accepted delayed snoozes from observation rather than replay time", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Delayed",
        email: "delayed-ritual@example.com",
        passwordHash: "unused",
      })
      .returning();
    const ownerContext = {
      ...context(),
      principal: { ...context().principal, userId: owner!.id, actorId: owner!.id },
    };
    clock = new Date("2026-11-01T12:00:00Z");
    await service.saveDefinition(
      "morning",
      {
        ...mutation(0),
        kind: "morning",
        enabled: true,
        title: "Morning",
        time: "06:00",
        timeZone: "UTC",
        steps: [{ id: "one", label: "One", kind: "checkbox" }],
      },
      ownerContext,
    );
    let state = await service.current(ownerContext);
    for (const observedAt of ["2026-11-01T08:00:00Z", "2026-11-01T08:20:00Z"]) {
      const result = await service.act(
        state.current!.id,
        { ...mutation(state.current!.revision), observedAt, kind: "snooze" },
        ownerContext,
      );
      expect(result.outcome).toBe("applied");
      state = result.state;
      clock = new Date(clock.getTime() + 60000);
    }
    clock = new Date("2026-11-04T09:00:00Z");
    state = await service.current(ownerContext);
    expect(state.snoozeCount).toBe(0);
    expect(
      (
        await service.act(
          state.current!.id,
          { ...mutation(state.current!.revision), kind: "snooze" },
          ownerContext,
        )
      ).outcome,
    ).toBe("applied");
  });
  it.each([
    "11:00",
    "12:00",
    "23:00",
  ])("rescheduling evening to %s only affects future boundaries", async (time) => {
    for (const definition of await service.list(context()))
      await service.deleteData(definition.kind, context());
    clock = new Date("2026-11-10T17:00:00Z"); // noon New York
    for (const kind of ["morning", "night"] as const) {
      await service.saveDefinition(
        kind,
        {
          ...mutation(0),
          kind,
          title: kind,
          time: kind === "morning" ? "06:00" : "21:00",
          timeZone: "America/New_York",
          enabled: true,
          steps: [{ id: "one", label: "Original step", kind: "checkbox" }],
        },
        context(),
      );
    }
    let state = await service.current(context());
    const original = state.current!;
    const evening = state.definitions.find((definition) => definition.kind === "night")!;
    await service.saveDefinition(
      "night",
      {
        ...evening,
        ...mutation(evening.revision),
        time,
        steps: [{ id: "changed", label: "Changed future step", kind: "checkbox" }],
      },
      context(),
    );
    state = await service.current(context());
    expect(state.current?.id).toBe(original.id);
    expect(state.current?.status).toBe("pending");
    expect(state.current?.definition).toEqual(original.definition);
    const next = time !== "23:00" ? "2026-11-11T11:00:00.000Z" : "2026-11-11T04:00:00.000Z";
    expect(state.current?.expiresAt).toBe(next);
    expect(state.upcoming?.every((window) => window.dueAt > clock.toISOString())).toBe(true);
    clock = new Date("2026-11-11T03:00:00Z"); // past the original evening boundary
    expect((await service.current(context())).current?.id).toBe(original.id);
    clock = new Date(next);
    const after = (await service.current(context())).current!;
    expect(after.id).not.toBe(original.id);
    expect(after.definition.kind).toBe(time !== "23:00" ? "morning" : "night");
    const history = await service.history(context(), { limit: 100 });
    expect(
      history.items.filter(
        (entry) => entry.definition.kind === "night" && entry.scheduledLocalDate === "2026-11-10",
      ),
    ).toHaveLength(time !== "23:00" ? 0 : 1);
  });
});
