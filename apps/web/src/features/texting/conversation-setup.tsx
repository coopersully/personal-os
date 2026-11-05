import type { TextingAgentStatus, TextingConnection } from "@personal-os/domain";
import { Link } from "react-router-dom";
import { CheckIcon, LockIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

export function ConversationSetup({
  status,
  connection,
}: {
  status: TextingAgentStatus;
  connection?: TextingConnection | undefined;
}) {
  const phoneReady = connection?.state === "active";
  const routineReady = status.readiness === "ready";
  const steps = [
    {
      title: "Verify your phone",
      description: phoneReady
        ? `Connected to ${connection.maskedPhoneNumber}.`
        : "Connect the number you’ll text from and allow SMS replies.",
      complete: phoneReady,
    },
    {
      title: "Connect your agent",
      description: routineReady
        ? "Your Claude routine is connected."
        : status.readiness === "permission_required"
          ? "Allow your connected agent to read, write and execute Texting."
          : "Choose a Claude routine and enable automatic replies in Texting settings.",
      complete: routineReady,
    },
    {
      title: "Receive your first reply",
      description:
        routineReady && connection?.senderPhoneNumber
          ? `Text “Hello nohmi” to ${connection.senderPhoneNumber}. Messages unlock when your agent replies and delivery is confirmed.`
          : "A real reply from your agent confirms the connection works from end to end.",
      complete: false,
    },
  ];
  return (
    <section
      aria-label="Messages setup"
      className="mx-auto flex w-full max-w-lg flex-col gap-6 py-6 sm:py-10"
    >
      <Empty className="p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Connect your agent to unlock Messages</EmptyTitle>
          <EmptyDescription>
            Your conversation stays private and saved. First, let’s confirm your agent can reply to
            your phone.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <ItemGroup aria-label="Setup steps">
        {steps.map((step, index) => (
          <Item key={step.title} className="items-start" variant="muted">
            <ItemMedia className="pt-0.5">
              <span
                className="flex size-6 items-center justify-center rounded-full bg-background text-xs text-muted-foreground"
                role="img"
                aria-label={step.complete ? "Complete" : `Step ${index + 1}`}
              >
                {step.complete ? <CheckIcon className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{step.title}</ItemTitle>
              <ItemDescription>{step.description}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <Button asChild>
        <Link to="/settings?page=texting">Open Texting settings</Link>
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        A system notice or a started session won’t unlock your chats.
      </p>
    </section>
  );
}
