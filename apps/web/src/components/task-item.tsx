import type * as React from "react";
import {
  CommitmentItem,
  CommitmentItemActions,
  CommitmentItemCompletion,
  CommitmentItemContent,
  CommitmentItemDescription,
  CommitmentItemMetadata,
  CommitmentItemPrimaryAction,
  CommitmentItemTags,
  CommitmentItemTitle,
} from "./commitment-item";

function TaskItem(props: React.ComponentProps<typeof CommitmentItem>) {
  return <CommitmentItem data-slot="task-item" {...props} />;
}

function TaskItemCompletion(props: React.ComponentProps<typeof CommitmentItemCompletion>) {
  return <CommitmentItemCompletion data-slot="task-item-completion" {...props} />;
}

function TaskItemPrimaryAction(props: React.ComponentProps<typeof CommitmentItemPrimaryAction>) {
  return <CommitmentItemPrimaryAction data-slot="task-item-primary-action" {...props} />;
}

function TaskItemContent(props: React.ComponentProps<typeof CommitmentItemContent>) {
  return <CommitmentItemContent data-slot="task-item-content" {...props} />;
}

function TaskItemTitle(props: React.ComponentProps<typeof CommitmentItemTitle>) {
  return <CommitmentItemTitle data-slot="task-item-title" {...props} />;
}

function TaskItemDescription(props: React.ComponentProps<typeof CommitmentItemDescription>) {
  return <CommitmentItemDescription data-slot="task-item-description" {...props} />;
}

function TaskItemMetadata(props: React.ComponentProps<typeof CommitmentItemMetadata>) {
  return <CommitmentItemMetadata data-slot="task-item-metadata" {...props} />;
}

function TaskItemTags(props: React.ComponentProps<typeof CommitmentItemTags>) {
  return <CommitmentItemTags data-slot="task-item-tags" {...props} />;
}

function TaskItemActions(props: React.ComponentProps<typeof CommitmentItemActions>) {
  return <CommitmentItemActions data-slot="task-item-actions" {...props} />;
}

export {
  TaskItem,
  TaskItemActions,
  TaskItemCompletion,
  TaskItemContent,
  TaskItemDescription,
  TaskItemMetadata,
  TaskItemPrimaryAction,
  TaskItemTags,
  TaskItemTitle,
};
