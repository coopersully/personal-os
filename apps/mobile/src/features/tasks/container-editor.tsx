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
import { Icon } from "../../components/icons";
import { RowActions } from "../../components/row-actions";
import { useTheme } from "../../theme";
import { useTaskAction, useTaskApi, useTaskResources } from "./data";
import { DateField } from "./date-field";
import { FormSave } from "./form-save";
import { useDraftField } from "./form-state";
import { ListAppearance } from "./list-appearance";
import { RecordIdentity } from "./record-identity";
import { SearchableChoice } from "./searchable-choice";
import { Action, confirm, Field, FormBody, Section, State, styles } from "./ui";
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
  const [edited, setEdited] = useState(false);
  const markEdited = () => setEdited(true);
  const [name, setName] = useDraftField(initial?.name ?? "", markEdited);
  const [notes, setNotes] = useDraftField(project?.notes ?? list?.description ?? "", markEdited);
  const [why, setWhy] = useDraftField(project?.why ?? "", markEdited);
  const [target, setTarget] = useDraftField(project?.targetDate ?? null, markEdited);
  const [icon, setIcon] = useDraftField<TaskListIcon>(list?.icon ?? "list", markEdited);
  const [color, setColor] = useDraftField(list?.color ?? "", markEdited);
  const [listId, setListId, initializeListId] = useDraftField(project?.listId ?? "", markEdited);
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
      initializeListId(active.find((row) => row.kind === "inbox")?.id ?? active[0].id);
  }, [active, listId, initializeListId]);
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
              label={edited ? "Cancel" : "Close"}
              disabled={action.pending}
              onPress={() =>
                edited
                  ? confirm(
                      "Discard draft?",
                      "Unsaved changes will be lost.",
                      () => router.back(),
                      true,
                    )
                  : router.back()
              }
            />
          ),
          headerRight: () => (
            <View style={styles.toolbar}>
              {initial && available && (
                <RowActions
                  label="Record actions"
                  placement="header"
                  actions={[
                    ...(project
                      ? [
                          {
                            id: "complete",
                            label: "Complete project",
                            icon: "check" as const,
                            disabled: action.pending || stale,
                            onPress: () => lifecycle("complete"),
                          },
                          {
                            id: "cancel",
                            label: "Cancel project",
                            icon: "disconnected" as const,
                            destructive: true,
                            disabled: action.pending || stale,
                            onPress: () =>
                              confirm(
                                "Cancel project?",
                                "This changes the project lifecycle. The server will check its contents.",
                                () => lifecycle("cancel"),
                                true,
                              ),
                          },
                        ]
                      : []),
                    ...(list?.kind !== "inbox"
                      ? [
                          {
                            id: "archive",
                            label: "Archive",
                            icon: "archive" as const,
                            destructive: true,
                            disabled: action.pending || stale,
                            onPress: () =>
                              confirm(
                                "Archive this container?",
                                "Its contents may become read-only. You’ll choose how to handle active contents next.",
                                () => lifecycle("archive"),
                                true,
                              ),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </View>
          ),
        }}
      />
      <FormBody>
        <View pointerEvents={available && !action.pending && !uncertain ? "auto" : "none"}>
          <RecordIdentity
            title={name}
            onTitleChange={setName}
            description={notes}
            onDescriptionChange={setNotes}
            placeholder={kind === "list" ? "Home & errands" : "Plant a balcony garden"}
            descriptionPlaceholder={
              kind === "list"
                ? "Repairs, shopping, and small jobs around the house."
                : "Choose herbs, buy pots, and plant before spring."
            }
            icon={
              kind === "list" ? (
                <ListAppearance
                  icon={icon}
                  color={color}
                  onChange={(nextIcon, nextColor) => {
                    setIcon(nextIcon);
                    setColor(nextColor);
                  }}
                />
              ) : (
                <Icon name="target" color={t.ink} size={28} />
              )
            }
          />
          {kind === "project" && (
            <Section>
              {!project && (
                <SearchableChoice
                  entity="list"
                  label="List"
                  value={listId}
                  options={active.map((row) => ({ value: row.id, label: row.name }))}
                  onChange={setListId}
                />
              )}
              <DateField label="Target date" dateOnly value={target} onChange={setTarget} />
            </Section>
          )}

          {kind === "project" && (
            <Section title="Purpose">
              <Field
                label="Why it matters"
                placeholder="Grow fresh herbs for cooking"
                value={why}
                onChangeText={setWhy}
                multiline
                maxLength={10000}
              />
            </Section>
          )}
        </View>
        {project && available && (
          <Section title="Move project">
            {project && (
              <>
                <SearchableChoice
                  entity="list"
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
            <SearchableChoice
              entity="list"
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
              <SearchableChoice
                entity="project"
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
      {available && (
        <FormSave
          disabled={
            !edited ||
            action.pending ||
            !name.trim() ||
            stale ||
            (!listId && kind === "project") ||
            uncertain
          }
          onPress={save}
        />
      )}
      <Toaster />
    </View>
  );
}
