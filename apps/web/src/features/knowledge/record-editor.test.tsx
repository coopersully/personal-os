// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { KnowledgeRecord } from "@personal-os/domain";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { memoryClaimFields, RecordEditor } from "./record-editor";

const id = "22222222-2222-4222-8222-222222222222";

function setup(record?: KnowledgeRecord) {
  const onSave = vi.fn();
  const onInvalid = vi.fn();
  render(
    <RecordEditor
      {...(record ? { record } : {})}
      disabled={false}
      onSave={onSave}
      onInvalid={onInvalid}
      footer={<button type="button">Cancel</button>}
    />,
  );
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
  return { onSave, onInvalid, save, fill };
}

it("saves typed values as yes or no and whole numbers", () => {
  const { onSave, save, fill } = setup();
  fill("Fact", "has_car");
  fill("Value type", "boolean");
  fill("Value", "false");
  fill("Tags", "transport");
  save();
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: {
        kind: "fact",
        value: { subject: "owner", predicate: "has_car", value: { type: "boolean", value: false } },
      },
    }),
  );
  fill("Value type", "integer");
  fill("Value", "3");
  save();
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        value: expect.objectContaining({ value: { type: "integer", value: 3 } }),
      }),
    }),
  );
  fill("Value type", "date");
  expect(screen.getByLabelText("Value", { exact: true })).toHaveAttribute("type", "date");
});

it("marks invalid content fields and leaves evidence off an inference", () => {
  const { onSave, onInvalid, save, fill } = setup();
  fill("Memory type", "inference");
  save();
  expect(onInvalid).toHaveBeenCalledOnce();
  expect(screen.getAllByText("Enter a valid value.").length).toBeGreaterThan(0);
  expect(onSave).not.toHaveBeenCalled();
  fill("Subject", "owner");
  fill("Proposition", "Prefers mornings");
  fill("Uncertainty", "Only two weeks of data");
  fill("Review condition", "Ask after a month");
  fill("Tags", "routine");
  save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ evidence: [] }));
});

it("asks to shorten content over the size limit", () => {
  const { onInvalid, save, fill } = setup();
  fill("Memory type", "inference");
  for (const label of ["Subject", "Proposition", "Uncertainty", "Review condition"])
    fill(label, "x".repeat(2048));
  fill("Tags", "car");
  save();
  expect(screen.getByText("Reduce the size of this memory.")).toBeVisible();
  expect(onInvalid).toHaveBeenCalled();
});

it("lists a decision's evidence with its claim fields", () => {
  expect(
    memoryClaimFields({
      kind: "decision",
      value: { subject: "Car", option: "Sell", reason: "Unused", evidenceIds: [id] },
    }),
  ).toContainEqual(["Evidence IDs", id]);
  expect(memoryClaimFields({ kind: "goal", value: { goalId: id } })).toEqual([
    ["Type", "Goal"],
    ["Goal ID", id],
  ]);
});

it("revises a routine and keeps unchanged tags out of the revision", () => {
  const routine: KnowledgeRecord = {
    id,
    author: { actorId: id, actorType: "user" },
    requiredReadScopes: [],
    validFrom: null,
    validUntil: null,
    reviewAt: null,
    schemaVersion: 1,
    content: {
      kind: "routine",
      value: {
        subject: "Gym",
        recurrence: "Mondays",
        classification: "stated",
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-01-01T00:00:00.000Z",
      },
    },
    scope: { workspace: null },
    sensitivity: "standard",
    purposes: [],
    confidence: 0,
    status: "active",
    revision: 2,
    sources: [],
    relatedRecordIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    origin: "stated",
    acceptance: null,
    claimKey: null,
    conflictRecordIds: [],
    evidenceAvailable: true,
    ownerHeld: true,
    agentAccess: "allowed",
    core: false,
    tags: ["health"],
    lastConfirmedAt: null,
    supersededBy: null,
    trashedAt: null,
    trashGroupId: null,
  };
  const { onSave, save, fill } = setup(routine);
  expect(screen.queryByRole("checkbox", { name: "Load at session start" })).not.toBeInTheDocument();
  fill("Recurrence", "Mondays and Thursdays");
  fill("Origin", "observed");
  save();
  const [input] = onSave.mock.lastCall ?? [];
  expect(input).toMatchObject({ action: "revise", expectedRevision: 2 });
  expect(input).not.toHaveProperty("tags");
  expect(input.content.value).toMatchObject({
    recurrence: "Mondays and Thursdays",
    classification: "observed",
  });
});

it("flags a value that does not match its type", () => {
  const { onSave, save, fill } = setup();
  fill("Fact", "age");
  fill("Value type", "integer");
  fill("Value", "abc");
  fill("Tags", "profile");
  save();
  expect(screen.getByLabelText("Value", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(onSave).not.toHaveBeenCalled();
});
