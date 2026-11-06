import type { IconName } from "../../components/icons";

// Isolated preview fixtures, not provider records, live monitoring or a client-side priority engine.
export type Scenario = "attention" | "quiet" | "interrupted";
export type BriefingItem = {
  id: string;
  workspace: "mail" | "calendar" | "tasks";
  icon: IconName;
  title: string;
  summary: string;
  heading: string;
  description: string;
  facts: { label: string; value: string }[];
};
export const sampleItems: BriefingItem[] = [
  {
    id: "conflict",
    workspace: "calendar",
    icon: "calendar",
    title: "two plans at 2 pm",
    summary: "review overlaps your appointment",
    heading: "two places at once.",
    description: "Alex moved the review to 2 pm. It now overlaps your dentist appointment.",
    facts: [
      { label: "work · 2:00–2:30 pm", value: "Design review · updated by Alex at 9:33 am" },
      { label: "personal · 2:00–3:00 pm", value: "Dentist appointment · unchanged" },
      {
        label: "possible alternative",
        value: "3:30 pm is free on your calendar. Alex’s availability hasn’t been checked.",
      },
    ],
  },
  {
    id: "reply",
    workspace: "mail",
    icon: "mail",
    title: "Maya needs a reply",
    summary: "reservation closes at noon",
    heading: "Friday reservation",
    description: "Maya is waiting for your decision.",
    facts: [
      {
        label: "message · 9:12 am",
        value: "The venue can hold our Friday reservation until noon. Shall I confirm for six?",
      },
      { label: "why it’s here", value: "A direct question with a deadline today." },
    ],
  },
  {
    id: "event",
    workspace: "calendar",
    icon: "calendar",
    title: "Product check-in",
    summary: "10:00–10:30 am · video call",
    heading: "Product check-in",
    description: "Your next commitment in this sample day.",
    facts: [
      { label: "when", value: "Thursday, November 5 · 10:00–10:30 am" },
      { label: "where", value: "Video call" },
      { label: "attendees", value: "You, Alex and Maya" },
    ],
  },
  {
    id: "receipts",
    workspace: "mail",
    icon: "receipt",
    title: "2 receipts filed",
    summary: "mail · receipt filing rule",
    heading: "receipts, sorted.",
    description: "Two example receipts were filed under an existing rule.",
    facts: [
      {
        label: "completed · 9:30 am",
        value: "Sample bookstore receipt and sample train receipt moved to Receipts.",
      },
      {
        label: "authority",
        value: "Receipt filing rule · files receipts without deleting messages.",
      },
      {
        label: "recovery",
        value: "In the connected app, you can inspect the original messages and move them back.",
      },
    ],
  },
  {
    id: "archive",
    workspace: "tasks",
    icon: "archive",
    title: "1 finished task archived",
    summary: "tasks · daily cleanup rule",
    heading: "one less loose end.",
    description: "A completed example task was archived.",
    facts: [
      { label: "completed · 9:25 am", value: "Book dentist appointment" },
      { label: "authority", value: "Daily cleanup rule · archives completed tasks." },
      { label: "recovery", value: "Archived tasks remain available in their workspace." },
    ],
  },
  {
    id: "connection",
    workspace: "mail",
    icon: "disconnected",
    title: "mail checks are paused",
    summary: "reconnect to see new messages",
    heading: "mail needs reconnecting",
    description: "This sample shows an expired connection. New messages may need attention.",
    facts: [
      { label: "last checked", value: "Yesterday at 6:42 pm" },
      {
        label: "next step",
        value:
          "The connected app will offer a secure provider sign-in. This preview does not access your accounts.",
      },
    ],
  },
];
export function itemById(id: string | undefined) {
  return sampleItems.find((item) => item.id === id);
}
export function attentionItems(scenario: Scenario) {
  return sampleItems.filter((item) =>
    scenario === "attention"
      ? ["conflict", "reply"].includes(item.id)
      : scenario === "interrupted" && item.id === "connection",
  );
}
