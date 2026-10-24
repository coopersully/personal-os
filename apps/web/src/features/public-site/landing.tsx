import { type CSSProperties, useState } from "react";
import { Link } from "react-router-dom";
import { PauseIcon, PlayIcon } from "../../components/icons.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { WorkspaceIcon } from "../../components/workspace-identity.js";
import { PublicSiteLayout, publicContainer } from "./layout.js";
import { ProductPreviews } from "./product-previews.js";

const mirrorTiles = Array.from({ length: 15 }, (_, tile) => ({
  id: `tile-${tile % 3}-${Math.floor(tile / 3)}`,
  x: tile % 3 === 1 ? 1 : -1,
  y: Math.floor(tile / 3) % 2 === 0 ? 1 : -1,
}));

const scenery = [
  "01-wildflowers",
  "02-forest-canopy",
  "03-clouds",
  "04-lily-pond",
  "05-koi-pond",
  "06-autumn-leaves",
  "07-windblown-grass",
  "08-cherry-blossoms",
  "09-snowfall",
] as const;

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
  const [sceneryPaused, setSceneryPaused] = useState(false);
  return (
    <PublicSiteLayout contentId="product-content">
      <main id="product-content" tabIndex={-1} className="public-landing">
        <section
          className="public-hero"
          aria-labelledby="product-heading"
          data-scenery-paused={sceneryPaused}
        >
          <div className="public-hero__scenery" aria-hidden="true">
            {scenery.map((scene, index) => (
              <div
                key={scene}
                className="public-hero__scene"
                style={
                  {
                    "--scene-image": `image-set(url("/brand/scenery/nature-${scene}-960.webp") 1x, url("/brand/scenery/nature-${scene}-1920.webp") 2x)`,
                    animationDelay: `${index * 0.5 - 4.5}s`,
                  } as CSSProperties
                }
              >
                <div className="public-hero__tiles">
                  {mirrorTiles.map(({ id, x, y }) => (
                    <span
                      key={id}
                      style={{
                        transform: `scale(${x}, ${y})`,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="public-hero__copy">
            <p className="public-eyebrow">an agent harness. built for people.</p>
            <h1 id="product-heading">your digital exoskeleton.</h1>
            <p className="public-hero__intro">
              your mail, tasks, calendar, and finances. connected with ai, on your terms.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="ghost">
                <a href="/about/">meet nohmi</a>
              </Button>
              <Button asChild size="lg">
                <Link to="/signup">get started</Link>
              </Button>
            </div>
            <p className="public-hero__availability">invite-only alpha.</p>
          </div>
          <Button
            className="public-hero__motion"
            variant="ghost"
            size="icon"
            aria-label={sceneryPaused ? "resume scenery" : "pause scenery"}
            title={sceneryPaused ? "resume scenery" : "pause scenery"}
            aria-pressed={sceneryPaused}
            onClick={() => setSceneryPaused(!sceneryPaused)}
          >
            {sceneryPaused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
          </Button>
          <img
            className="public-hero__figure"
            src="/brand/nohmi-chest-angle.webp"
            alt=""
            width={1024}
            height={1536}
            fetchPriority="high"
          />
        </section>
        <div className={publicContainer}>
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
        </div>
        <ProductPreviews />
        <div className={publicContainer}>
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
                  <p>
                    connect the services and agents you choose. grant only the access they need.
                  </p>
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
        </div>
      </main>
    </PublicSiteLayout>
  );
}
