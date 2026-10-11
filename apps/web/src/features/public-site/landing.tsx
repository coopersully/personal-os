import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Separator } from "../../components/ui/separator.js";
import { WorkspaceIcon, workspaceIdentities } from "../../components/workspace-identity.js";
import { PublicSiteLayout, publicContainer } from "./layout.js";

const workspaces = [
  {
    id: "mail",
    headline: "One inbox for all your accounts.",
    description:
      "Read and reply across accounts. Your agent can organize messages, draft replies, and flag conversations that need you.",
    connection:
      "Turn messages into tasks and events. Use receipts to explain transactions in Finances, with links back to the email.",
  },
  {
    id: "tasks",
    headline: "Plan around the time you have.",
    description:
      "Capture commitments and break projects into next steps. Your agent helps estimate and prioritize the work around your goals and energy.",
    connection:
      "Use Calendar to find time for tasks and adjust the plan when your schedule changes.",
  },
  {
    id: "calendar",
    headline: "Work and personal schedules together.",
    description:
      "See events once and protect your availability across calendars. Your agent can identify conflicts and leave time for focused work, travel, and breaks.",
    connection:
      "Plan with invitations from Mail and priorities from Tasks, respecting your working hours and existing commitments.",
  },
  {
    id: "finances",
    headline: "Accounts, spending, and a budget.",
    description:
      "Your agent categorizes transactions and proposes a budget based on your income, obligations, and goals. Get guidance grounded in financial planning and bookkeeping.",
    connection:
      "With your permission, check receipts in Mail to resolve unclear charges. Track your budget and get optional texts when something needs attention.",
  },
] as const;

export function ProductLanding() {
  return (
    <PublicSiteLayout contentId="product-content">
      <main id="product-content" tabIndex={-1} className={publicContainer}>
        <section className="flex max-w-3xl flex-col items-start gap-6 py-12 sm:py-16">
          <h1 className="text-5xl font-medium tracking-tight sm:text-7xl">
            Mail, tasks, calendar, and money.
          </h1>
          <p className="max-w-2xl text-xl leading-relaxed text-muted-foreground">
            Manage them in nohmi, with help from agents you choose.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button asChild size="lg">
              <Link to="/signup">Sign up</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="/about/">About nohmi</a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Have an invitation code? Enter it when signing up.
          </p>
        </section>
        <section
          aria-labelledby="workspaces-heading"
          className="flex flex-col gap-6 pb-12 sm:pb-16"
        >
          <h2 id="workspaces-heading" className="text-3xl font-medium tracking-tight">
            Four connected workspaces.
          </h2>
          <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
            We’re building connected workspaces for you and your agents to use the same records.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {workspaces.map(({ id, headline, description, connection }) => (
              <Card key={id}>
                <CardHeader className="gap-4">
                  <WorkspaceIcon workspace={id} size="lg" />
                  <CardTitle>
                    <h3>{workspaceIdentities[id].label}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-xl font-medium tracking-tight">{headline}</p>
                  <p className="leading-relaxed text-muted-foreground">{description}</p>
                  <p className="leading-relaxed text-muted-foreground">{connection}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 rounded-xl bg-secondary p-6 sm:p-8 md:grid-cols-[1fr_1.5fr] md:gap-8">
            <h3 className="text-2xl font-medium tracking-tight">Run a routine.</h3>
            <div className="flex flex-col gap-4 leading-relaxed text-muted-foreground">
              <p>
                Schedule recurring work in your agent app. Review mail and plan your day each
                morning, or reconcile transactions and check your budget each week.
              </p>
              <p>
                Your agent follows the rules you approve and asks when it needs your judgment.
                Answer in nohmi or by optional text, then resume the work. Changes stay recorded.
              </p>
            </div>
          </div>
        </section>
        <section
          aria-labelledby="agency-heading"
          className="grid gap-8 pb-12 sm:pb-16 lg:grid-cols-[1fr_1.4fr] lg:gap-12"
        >
          <div className="flex flex-col items-start gap-6">
            <h2 id="agency-heading" className="max-w-sm text-4xl font-medium tracking-tight">
              Choose what agents can do.
            </h2>
            <Button asChild variant="secondary">
              <a href="/data-use/">Your data and agent access</a>
            </Button>
          </div>
          <Card>
            <CardHeader className="gap-4">
              <CardTitle>
                <h3>Set access.</h3>
              </CardTitle>
              <p className="leading-relaxed text-muted-foreground">
                Choose which services to connect and what each agent can access. Revoke access at
                any time.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Separator />
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Review changes.</h3>
                <p className="leading-relaxed text-muted-foreground">
                  See what your agents changed and what still needs you. Available actions depend on
                  the workflow and connected services.
                </p>
              </div>
              <Separator />
              <div className="flex flex-col items-start gap-3">
                <h3 className="font-medium">Optional texts.</h3>
                <p className="leading-relaxed text-muted-foreground">
                  Opt in to updates and questions at your verified number. Text STOP to opt out.
                </p>
                <Button asChild variant="link">
                  <a href="/sms/">How texting works</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </PublicSiteLayout>
  );
}
