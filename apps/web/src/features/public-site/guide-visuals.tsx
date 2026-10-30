import {
  AgentIcon,
  BanknoteIcon,
  CalendarIcon,
  CheckSquareIcon,
  FileTextIcon,
  HouseIcon,
  MailIcon,
} from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { WorkspaceIcon, workspaceIds } from "@/components/workspace-identity";
import { GuideExample } from "./guide-examples.js";
import { guidePages } from "./guide-pages.js";

const icons = [
  FileTextIcon,
  HouseIcon,
  MailIcon,
  CheckSquareIcon,
  CalendarIcon,
  BanknoteIcon,
  AgentIcon,
];
export function GuideNavigation({ slug }: { slug: string }) {
  return (
    <nav aria-label="document navigation" className="public-guide-sidebar">
      <ItemGroup>
        {guidePages.map((page, index) => {
          const Icon = icons[index] ?? FileTextIcon;
          const workspace = workspaceIds.find((id) => page.slug === `docs/${id}`);
          return (
            <Item
              key={page.slug}
              asChild
              size="sm"
              variant={page.slug === slug ? "secondary" : "default"}
            >
              <a href={`/${page.slug}/`} aria-current={page.slug === slug ? "page" : undefined}>
                <ItemMedia variant="icon">
                  {workspace ? (
                    <WorkspaceIcon workspace={workspace} size="sm" />
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{page.label}</ItemTitle>
                </ItemContent>
              </a>
            </Item>
          );
        })}
      </ItemGroup>
    </nav>
  );
}
const examples = {
  mail: {
    image: "mail-premiere.jpg",
    caption: "a confirmed venue booking, its conversation, and your reply in one view.",
    title: "the venue is confirmed",
    manual: "open the conversation, check the booking details, and write your reply.",
    agent: "prepare a thank-you draft. leave the recipient and final wording for review.",
  },
  tasks: {
    image: "tasks-premiere.jpg",
    caption: "a premiere checklist keeps completed work and the remaining next steps together.",
    title: "send the final guest list",
    manual: "add the task to the premiere project and complete it after sending the list.",
    agent: "identify remaining tasks and suggest a sequence without changing existing deadlines.",
  },
  calendar: {
    image: "calendar-premiere.jpg",
    caption: "production sessions, opening night, and time with the crew share the same week.",
    title: "make time for the final edit",
    manual: "inspect the week and create an event in a writable calendar.",
    agent: "compare free time with existing events and preview a focus block before creating it.",
  },
  finances: {
    image: "finances-premiere.jpg",
    caption: "inspect the grant, production costs, and settled expenses as individual records.",
    title: "review the production budget",
    manual: "check transaction categories and review the exact proposed plan before approval.",
    agent: "flag ambiguous expenses and prepare a budget proposal with its assumptions.",
  },
} as const;
export function GuideVisuals({
  slug,
  kind,
}: {
  slug: string;
  kind: "screenshot" | "manual" | "agent";
}) {
  const key = slug.replace("docs/", "") as keyof typeof examples;
  const example = examples[key];
  if (!example) return null;
  if (kind === "screenshot")
    return (
      <figure className={`public-guide-screenshot public-guide-screenshot--${key}`}>
        <a
          href={`/brand/devices/${example.image}`}
          aria-label={`open full-size ${key} product screenshot`}
        >
          <img src={`/brand/devices/${example.image}`} alt={example.caption} loading="lazy" />
        </a>
        <figcaption>
          {example.caption} <span>select to view full size.</span>
        </figcaption>
      </figure>
    );
  return (
    <Card className="public-guide-example">
      <CardHeader>
        <CardDescription>
          example workflow · {kind === "manual" ? "you, directly" : "with an agent"}
        </CardDescription>
        <CardTitle>{example.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <GuideExample workspace={key} kind={kind} />
      </CardContent>
    </Card>
  );
}

/** Explicit placements in repository-owned guide HTML keep examples beside the instructions they explain. */
export function GuideContent({ slug, content }: { slug: string; content: string }) {
  return (
    <div className="public-guide-walkthrough">
      {content.split(/<!-- guide:(screenshot|manual|agent) -->/).map((part, index) => {
        if (index % 2)
          return (
            <GuideVisuals key={part} slug={slug} kind={part as "screenshot" | "manual" | "agent"} />
          );
        if (!part.trim()) return null;
        return (
          <div
            key={part}
            className="public-prose public-editorial-prose"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time repository-owned guide content only.
            dangerouslySetInnerHTML={{ __html: part }}
          />
        );
      })}
    </div>
  );
}
