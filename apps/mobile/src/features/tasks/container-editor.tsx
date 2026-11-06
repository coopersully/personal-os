import { ApiClientError } from "@personal-os/api-client";
import {
  createTaskListInputSchema,
  createTaskProjectInputSchema,
  type TaskList,
  type TaskListIcon,
  type TaskOrganizationConflict,
  type TaskProject,
  type TaskProjectMovePreview,
  taskOrganizationConflictSchema,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Toaster } from "sonner-native";
import { useTheme } from "../../theme";
import { useTaskAction, useTaskApi, useTaskResources } from "./data";
import { DateField } from "./date-field";
import { Action, Choice, confirm, Field, FormBody, Section, State } from "./ui";
export function ContainerEditorScreen() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const api = useTaskApi();
  const kind = params.kind === "project" ? "project" : "list";
  const query = useQuery<TaskList | TaskProject>({
    queryKey: ["tasks", "container", kind, params.id],
    enabled: !!params.id,
    queryFn: () =>
      kind === "list"
        ? api.getTaskList(params.id as string)
        : api.getTaskProject(params.id as string),
  });
  if (params.id && !query.data)
    return (
      <State
        loading={query.isPending}
        retry={query.isError ? () => void query.refetch() : undefined}
      />
    );
  return <ContainerForm key={`${kind}:${params.id ?? "new"}`} kind={kind} initial={query.data} />;
}
function ContainerForm({
  kind,
  initial,
}: {
  kind: "list" | "project";
  initial?: TaskList | TaskProject;
}) {
  const api = useTaskApi();
  const resources = useTaskResources();
  const action = useTaskAction();
  const t = useTheme();
  const list = kind === "list" ? (initial as TaskList | undefined) : undefined;
  const project = kind === "project" ? (initial as TaskProject | undefined) : undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(project?.notes ?? list?.description ?? "");
  const [why, setWhy] = useState(project?.why ?? "");
  const [target, setTarget] = useState(project?.targetDate ?? null);
  const [icon, setIcon] = useState<TaskListIcon>(list?.icon ?? "list");
  const [color, setColor] = useState(list?.color ?? "");
  const [listId, setListId] = useState(project?.listId ?? "");
  const [destination, setDestination] = useState("");
  const [destinationProject, setDestinationProject] = useState("");
  const [preview, setPreview] = useState<TaskProjectMovePreview | null>(null);
  const [conflict, setConflict] = useState<TaskOrganizationConflict | null>(null);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [key] = useState(randomUUID);
  const active = (resources.lists.data ?? []).filter(
    (row) => row.availability === "active" && !row.deletedAt,
  );
  const available = initial?.availability !== "archived" && !initial?.deletedAt;
  useEffect(() => {
    if (!listId && active.length)
      setListId(active.find((row) => row.kind === "inbox")?.id ?? active[0].id);
  }, [active, listId]);
  const fail = (error: unknown) => {
    if (error instanceof ApiClientError && error.status === 409) {
      const parsed = taskOrganizationConflictSchema.safeParse(error.details);
      if (parsed.success) setConflict(parsed.data);
      else setStale(true);
    } else if (
      !initial &&
      (!(error instanceof ApiClientError) || error.status >= 500) &&
      !(error instanceof Error && error.name === "ZodError")
    )
      setUncertain(true);
  };
  const save = () =>
    void action.run(
      "Saving…",
      async () => {
        if (kind === "list") {
          const values = createTaskListInputSchema.parse({
            name,
            description: notes.trim() || null,
            color: color.trim() || null,
            icon,
            idempotencyKey: key,
          });
          return list
            ? api.updateTaskList(list.id, {
                name: values.name,
                description: values.description,
                color: values.color,
                icon: values.icon,
                expectedRevision: list.revision,
              })
            : api.createTaskList(values);
        }
        const values = createTaskProjectInputSchema.parse({
          name,
          notes: notes.trim() || null,
          why: why.trim() || null,
          targetDate: target,
          listId,
          idempotencyKey: key,
        });
        return project
          ? api.updateTaskProject(project.id, {
              name: values.name,
              notes: values.notes,
              why: values.why,
              targetDate: values.targetDate,
              expectedRevision: project.revision,
            })
          : api.createTaskProject(values);
      },
      () => router.back(),
      fail,
    );
  const lifecycle = (operation: "archive" | "cancel" | "complete", resolution?: string) =>
    void action.run(
      "Updating…",
      async () => {
        if (!initial) throw new Error("Save the container first.");
        if (list)
          return api.archiveTaskList(list.id, {
            expectedRevision: list.revision,
            ...(resolution
              ? {
                  resolution: resolution as "move_active_contents" | "archive_contents_together",
                  destinationListId:
                    resolution === "move_active_contents" ? destination : undefined,
                }
              : {}),
          });
        if (operation === "archive")
          return api.archiveTaskProject(initial.id, { expectedRevision: initial.revision });
        if (operation === "cancel")
          return api.cancelTaskProject(initial.id, { expectedRevision: initial.revision });
        return api.completeTaskProject(initial.id, {
          expectedRevision: initial.revision,
          ...(resolution
            ? {
                resolution: resolution as
                  | "complete_open_tasks"
                  | "cancel_open_tasks"
                  | "move_open_tasks",
                destinationListId: resolution === "move_open_tasks" ? destination : undefined,
                destinationProjectId: destinationProject || undefined,
              }
            : {}),
        });
      },
      () => router.back(),
      fail,
    );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: `${initial ? "edit" : "new"} ${kind}`,
          gestureEnabled: false,
          headerLeft: () => (
            <Action
              label="Cancel"
              disabled={action.pending}
              onPress={() =>
                confirm(
                  "Discard draft?",
                  "Unsaved changes will be lost.",
                  () => router.back(),
                  true,
                )
              }
            />
          ),
          headerRight: () =>
            available ? (
              <Action
                label="Save"
                disabled={
                  action.pending ||
                  !name.trim() ||
                  stale ||
                  (!listId && kind === "project") ||
                  uncertain
                }
                onPress={save}
              />
            ) : null,
        }}
      />
      <FormBody>
        <View pointerEvents={available && !action.pending && !uncertain ? "auto" : "none"}>
          <Section>
            <Field label="Name" value={name} onChangeText={setName} maxLength={240} />
            <Field
              label={kind === "list" ? "Description" : "Notes"}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={10000}
            />
            {kind === "list" ? (
              <>
                <Choice
                  label="Icon"
                  value={icon}
                  options={[
                    "list",
                    "home",
                    "star",
                    "target",
                    "calendar",
                    "wallet",
                    "people",
                    "receipt",
                  ].map((value) => ({ value, label: value }))}
                  onChange={(value) => setIcon(value as TaskListIcon)}
                />
                <Field
                  label="Color (optional)"
                  value={color}
                  onChangeText={setColor}
                  autoCapitalize="none"
                  placeholder="#7928ff"
                />
              </>
            ) : (
              <>
                <Field label="Why" value={why} onChangeText={setWhy} multiline maxLength={10000} />
                <DateField label="Target date" dateOnly value={target} onChange={setTarget} />
                {!project && (
                  <Choice
                    label="List"
                    value={listId}
                    options={active.map((row) => ({ value: row.id, label: row.name }))}
                    onChange={setListId}
                  />
                )}
              </>
            )}
          </Section>
        </View>
        {initial && available && (
          <Section title="manage">
            {project && (
              <>
                <Action
                  label="Complete project"
                  disabled={action.pending || stale}
                  onPress={() => lifecycle("complete")}
                />
                <Action
                  label="Cancel project"
                  destructive
                  disabled={action.pending || stale}
                  onPress={() =>
                    confirm(
                      "Cancel project?",
                      "This changes the project lifecycle. The server will check its contents.",
                      () => lifecycle("cancel"),
                      true,
                    )
                  }
                />
                <Choice
                  label="Move to list"
                  value={destination}
                  options={active
                    .filter((row) => row.id !== project.listId)
                    .map((row) => ({ value: row.id, label: row.name }))}
                  onChange={setDestination}
                />
                <Action
                  label="Preview project move"
                  disabled={!destination || action.pending || stale}
                  onPress={() =>
                    void action.run(
                      "Checking move…",
                      () =>
                        api.previewTaskProjectMove(project.id, {
                          destinationListId: destination,
                          expectedRevision: project.revision,
                        }),
                      setPreview,
                      fail,
                      () => ({ message: "Review the move before confirming" }),
                    )
                  }
                />
              </>
            )}
            {list?.kind !== "inbox" && (
              <Action
                label="Archive"
                destructive
                disabled={action.pending || stale}
                onPress={() =>
                  confirm(
                    "Archive this container?",
                    "Its contents may become read-only. If active contents need a decision, you’ll choose how to handle them next.",
                    () => lifecycle("archive"),
                    true,
                  )
                }
              />
            )}
          </Section>
        )}
        {preview && project && (
          <Section title="move preview">
            <Text style={{ color: t.ink, padding: 12 }}>
              {preview.affectedTaskCount} tasks will move with this project.
            </Text>
            <Action
              label="Confirm move"
              disabled={action.pending}
              onPress={() =>
                void action.run(
                  "Moving…",
                  () =>
                    api.moveTaskProject(project.id, {
                      destinationListId: preview.destinationListId,
                      expectedRevision: project.revision,
                      previewToken: preview.previewToken,
                    }),
                  () => router.back(),
                  fail,
                )
              }
            />
            <Action label="Cancel move" onPress={() => setPreview(null)} />
          </Section>
        )}
        {conflict && (
          <Section title="resolve open contents">
            <Text style={{ color: t.ink, padding: 12 }}>
              {conflict.openContentCounts.tasks} open tasks · {conflict.openContentCounts.projects}{" "}
              open projects
            </Text>
            <Choice
              label="Destination list"
              value={destination}
              options={active
                .filter((row) => row.id !== initial?.id)
                .map((row) => ({ value: row.id, label: row.name }))}
              onChange={(value) => {
                setDestination(value);
                setDestinationProject("");
              }}
            />
            {project && (
              <Choice
                label="Destination project"
                value={destinationProject}
                options={[
                  { value: "", label: "None" },
                  ...(resources.projects.data ?? [])
                    .filter(
                      (row) =>
                        row.id !== project.id &&
                        row.listId === destination &&
                        row.lifecycle === "open" &&
                        row.availability === "active",
                    )
                    .map((row) => ({ value: row.id, label: row.name })),
                ]}
                onChange={setDestinationProject}
              />
            )}
            {conflict.resolutions
              .filter((value) => value !== "cancel" && value !== "keep_project_open")
              .map((value) => (
                <Action
                  key={value}
                  label={value.replaceAll("_", " ")}
                  disabled={action.pending || (value.startsWith("move_") && !destination)}
                  onPress={() =>
                    confirm(
                      "Apply to open contents?",
                      value.replaceAll("_", " "),
                      () => lifecycle(list ? "archive" : "complete", value),
                      true,
                    )
                  }
                />
              ))}
            <Action label="Keep unchanged" onPress={() => setConflict(null)} />
          </Section>
        )}
        {stale && (
          <Action label="Close and reopen to load current version" onPress={() => router.back()} />
        )}
        {uncertain && (
          <Action label="Review containers before creating again" onPress={() => router.back()} />
        )}
        {!available && (
          <Text style={{ color: t.secondary }}>This container is archived and read-only.</Text>
        )}
      </FormBody>
      <Toaster />
    </View>
  );
}
