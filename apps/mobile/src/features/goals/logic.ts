import type { Goal, Motive, UpdateGoalInput, UpdateMotiveInput } from "@personal-os/domain";
export type PersonalDraft = {
  title: string;
  detail: string;
  targetDate: string;
  progress: string;
  active: boolean;
};
export function personalDraft(record?: Goal | Motive): PersonalDraft {
  return {
    title: record?.title ?? "",
    detail: record ? (("progress" in record ? record.description : record.detail) ?? "") : "",
    targetDate: record && "progress" in record ? (record.targetDate ?? "") : "",
    progress: record && "progress" in record ? String(record.progress) : "0",
    active: record ? ("progress" in record ? record.status !== "paused" : record.isActive) : true,
  };
}
export function goalChanges(draft: PersonalDraft, initial?: Goal): UpdateGoalInput {
  const next = {
    title: draft.title.trim(),
    description: draft.detail.trim() || null,
    targetDate: draft.targetDate || null,
    progress: Number(draft.progress),
    status:
      initial &&
      Number(draft.progress) === initial.progress &&
      draft.active === (initial.status !== "paused")
        ? initial.status
        : Number(draft.progress) === 100
          ? ("completed" as const)
          : draft.active
            ? ("active" as const)
            : ("paused" as const),
  };
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => !initial || initial[key as keyof Goal] !== value),
  );
}
export function motiveChanges(draft: PersonalDraft, initial?: Motive): UpdateMotiveInput {
  const next = {
    title: draft.title.trim(),
    detail: draft.detail.trim() || null,
    isActive: draft.active,
  };
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => !initial || initial[key as keyof Motive] !== value,
    ),
  );
}
