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

function ReminderItem(props: React.ComponentProps<typeof CommitmentItem>) {
  return <CommitmentItem data-slot="reminder-item" {...props} />;
}

function ReminderItemCompletion(props: React.ComponentProps<typeof CommitmentItemCompletion>) {
  return <CommitmentItemCompletion data-slot="reminder-item-completion" {...props} />;
}

function ReminderItemPrimaryAction(
  props: React.ComponentProps<typeof CommitmentItemPrimaryAction>,
) {
  return <CommitmentItemPrimaryAction data-slot="reminder-item-primary-action" {...props} />;
}

function ReminderItemContent(props: React.ComponentProps<typeof CommitmentItemContent>) {
  return <CommitmentItemContent data-slot="reminder-item-content" {...props} />;
}

function ReminderItemTitle(props: React.ComponentProps<typeof CommitmentItemTitle>) {
  return <CommitmentItemTitle data-slot="reminder-item-title" {...props} />;
}

function ReminderItemDescription(props: React.ComponentProps<typeof CommitmentItemDescription>) {
  return <CommitmentItemDescription data-slot="reminder-item-description" {...props} />;
}

function ReminderItemMetadata(props: React.ComponentProps<typeof CommitmentItemMetadata>) {
  return <CommitmentItemMetadata data-slot="reminder-item-metadata" {...props} />;
}

function ReminderItemTags(props: React.ComponentProps<typeof CommitmentItemTags>) {
  return <CommitmentItemTags data-slot="reminder-item-tags" {...props} />;
}

function ReminderItemActions(props: React.ComponentProps<typeof CommitmentItemActions>) {
  return <CommitmentItemActions data-slot="reminder-item-actions" {...props} />;
}

export {
  ReminderItem,
  ReminderItemActions,
  ReminderItemCompletion,
  ReminderItemContent,
  ReminderItemDescription,
  ReminderItemMetadata,
  ReminderItemPrimaryAction,
  ReminderItemTags,
  ReminderItemTitle,
};
