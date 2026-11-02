import {
  EventCard,
  EventCardBody,
  EventCardContent,
  EventCardDescription,
  EventCardIndicator,
  EventCardTime,
  EventCardTitle,
} from "@/components/event-card";
import { AgentIcon, CheckIcon, MailIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

const requests = {
  mail: [
    "draft a thank-you to the cinema. don’t send it yet.",
    "draft ready in mail. please review the recipient and wording before sending.",
  ],
  tasks: [
    "plan the remaining premiere tasks. keep my deadlines unchanged.",
    "suggested next: guest list, projection check, then final delivery. no deadlines changed.",
  ],
  calendar: [
    "find an hour for the final edit. show me before adding it.",
    "thursday, 2–3 pm is free in your selected calendars. ready for your review; no event created.",
  ],
  finances: [
    "prepare next month’s production budget. leave it for my approval.",
    "proposal ready: $2,400 across production, venue, and reserve. review the assumptions before activating.",
  ],
} as const;
export function GuideExample({
  workspace,
  kind,
}: {
  workspace: keyof typeof requests;
  kind: "manual" | "agent";
}) {
  if (kind === "agent")
    return (
      <ItemGroup aria-label="example agent conversation">
        <Item size="sm" variant="secondary" className="ml-auto max-w-[88%]">
          <ItemContent>
            <ItemTitle>you</ItemTitle>
            <ItemDescription>{requests[workspace][0]}</ItemDescription>
          </ItemContent>
        </Item>
        <Item size="sm" variant="muted" className="mr-auto max-w-[88%]">
          <ItemMedia variant="icon">
            <AgentIcon aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>nohmi</ItemTitle>
            <ItemDescription>{requests[workspace][1]}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    );
  if (workspace === "tasks")
    return (
      <ItemGroup aria-label="example premiere checklist">
        <Item size="sm" variant="muted">
          <ItemMedia>
            <Checkbox checked disabled aria-label="confirm venue booking, completed example" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>confirm venue booking</ItemTitle>
            <ItemDescription>premiere night · completed</ItemDescription>
          </ItemContent>
          <ItemActions>
            <CheckIcon aria-hidden="true" className="size-4" />
          </ItemActions>
        </Item>
        <Item size="sm" variant="muted">
          <ItemMedia>
            <Checkbox
              checked={false}
              disabled
              aria-label="send the final guest list, incomplete example"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>send the final guest list</ItemTitle>
            <ItemDescription>premiere night · due friday</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="secondary">next</Badge>
          </ItemActions>
        </Item>
      </ItemGroup>
    );
  if (workspace === "calendar")
    return (
      <EventCard aria-label="example calendar event">
        <EventCardContent>
          <EventCardTime>2–3 pm</EventCardTime>
          <EventCardIndicator />
          <EventCardBody>
            <EventCardTitle>final edit</EventCardTitle>
            <EventCardDescription>thursday, october 22 · studio</EventCardDescription>
            <EventCardDescription>personal calendar · one hour reserved</EventCardDescription>
          </EventCardBody>
        </EventCardContent>
      </EventCard>
    );
  if (workspace === "mail")
    return (
      <ItemGroup aria-label="example email draft">
        <Item variant="muted" size="sm">
          <ItemMedia variant="icon">
            <MailIcon aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>thanks for a brilliant opening night</ItemTitle>
            <ItemDescription>to: maya &lt;maya@example.com&gt;</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="secondary">draft</Badge>
          </ItemActions>
        </Item>
        <div className="guide-draft-body">
          <p>hi maya,</p>
          <p>
            thank you for hosting our premiere. the room, the projection, and your team made the
            night feel special.
          </p>
          <p>i’d love to discuss another screening.</p>
          <p>alex</p>
        </div>
        <p className="text-xs text-muted-foreground">saved as a draft · not sent</p>
      </ItemGroup>
    );
  return (
    <ItemGroup aria-label="example budget review">
      <Item variant="muted" size="sm">
        <ItemContent>
          <ItemTitle>next production</ItemTitle>
          <ItemDescription>proposed monthly budget · not active</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">needs your review</Badge>
        </ItemActions>
      </Item>
      {[
        ["production", "$1,200"],
        ["venue", "$800"],
        ["reserve", "$400"],
      ].map(([label, amount]) => (
        <Item key={label} size="sm" variant="muted">
          <ItemContent>
            <ItemTitle>{label}</ItemTitle>
          </ItemContent>
          <ItemActions>{amount}</ItemActions>
        </Item>
      ))}
      <Item size="sm">
        <ItemContent>
          <ItemTitle>total proposed</ItemTitle>
          <ItemDescription>
            assumes $2,400 available; expected reimbursements excluded.
          </ItemDescription>
        </ItemContent>
        <ItemActions>$2,400</ItemActions>
      </Item>
    </ItemGroup>
  );
}
