import { Link } from "react-router-dom";
import { BRAND_PROMISE } from "../../brand.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { WorkspaceIcon } from "../../components/workspace-identity.js";
import { PublicSiteLayout, publicContainer } from "./layout.js";

const workspaces = [
  { id: "mail", title: "mail", description: "read, reply, and organize across connected inboxes." },
  {
    id: "tasks",
    title: "tasks",
    description: "keep commitments, projects, and next steps together.",
  },
  {
    id: "calendar",
    title: "calendar",
    description: "see your time across work and personal calendars.",
  },
  {
    id: "finances",
    title: "finances",
    description: "understand your accounts, spending, and budget.",
  },
] as const;

export function ProductLanding() {
  return (
    <PublicSiteLayout contentId="product-content">
      <main id="product-content" tabIndex={-1} className={publicContainer}>
        <section className="public-hero" aria-labelledby="product-heading">
          <div className="public-hero__copy">
            <p className="public-eyebrow">nohmi / built around you</p>
            <h1 id="product-heading">{BRAND_PROMISE}</h1>
            <p className="public-hero__intro">
              your mail, tasks, calendar, and money. connected for you and the agents you choose.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">get started</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <a href="/about/">meet nohmi</a>
              </Button>
            </div>
            <p className="public-hero__availability">invite-only alpha.</p>
          </div>
          <section className="public-harness" aria-label="what a personal harness holds">
            <div className="public-harness__header">
              <span>nohmi</span>
              <span>personal harness</span>
            </div>
            <dl>
              <div>
                <dt>your context</dt>
                <dd>goals, preferences, and commitments.</dd>
              </div>
              <div>
                <dt>your tools</dt>
                <dd>mail, tasks, calendar, and finances.</dd>
              </div>
              <div>
                <dt>your controls</dt>
                <dd>access, reviews, and activity.</dd>
              </div>
            </dl>
            <p>you act directly. agents work with your permission.</p>
          </section>
        </section>
        <section className="public-section" aria-labelledby="workspaces-heading">
          <div className="public-section__heading">
            <h2 id="workspaces-heading">one harness. familiar tools.</h2>
            <p>work directly in each workspace. connect an agent when you want help.</p>
          </div>
          <div className="public-workspaces">
            {workspaces.map(({ id, title, description }) => (
              <Card key={id}>
                <CardHeader className="flex flex-row items-center gap-3">
                  <WorkspaceIcon workspace={id} size="sm" />
                  <CardTitle>
                    <h3>{title}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p>{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <section className="public-section public-agency" aria-labelledby="agency-heading">
          <div className="public-section__heading">
            <h2 id="agency-heading">you set the rules.</h2>
            <p>
              we’re building a harness around a person: the context, tools, and controls that make
              working with agents useful in everyday life.
            </p>
            <Button asChild variant="link">
              <a href="/docs/">set up your harness</a>
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                <h3>choose what to delegate.</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="public-control-list">
              <div>
                <h4>set access.</h4>
                <p>connect the services and agents you choose. grant only the access they need.</p>
              </div>
              <div>
                <h4>review the work.</h4>
                <p>inspect changes, answer questions, and keep a record of what happened.</p>
              </div>
              <div>
                <h4>stay in control.</h4>
                <p>work directly and revoke agent access when you need to.</p>
              </div>
              <a href="/data-use/">data and agent access</a>
            </CardContent>
          </Card>
        </section>
        <section className="public-start" aria-label="start using nohmi">
          <div>
            <h2>make it yours.</h2>
            <p>start with an invitation.</p>
          </div>
          <Button asChild size="lg">
            <Link to="/signup">get started</Link>
          </Button>
        </section>
      </main>
    </PublicSiteLayout>
  );
}
