import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card.js";
import { guideSlugs } from "./guide-pages.js";
import { GuideContent, GuideNavigation } from "./guide-visuals.js";
import { PublicSiteLayout, publicContainer, publicDocuments } from "./layout.js";

export function PublicDocument({
  slug,
  title,
  intro,
  eyebrow,
  content,
}: {
  slug: string;
  title: string;
  intro: string;
  eyebrow: string;
  content: string;
}) {
  const guide = guideSlugs.includes(slug as (typeof guideSlugs)[number]);
  const editorial = guide || ["about", "support"].includes(slug);
  if (editorial) {
    return (
      <PublicSiteLayout>
        <main id="content" tabIndex={-1} className="public-editorial">
          <header className="public-editorial-hero">
            <div className={publicContainer}>
              <div className="public-editorial-heading">
                <p className="public-eyebrow">{eyebrow}</p>
                <h1>{title}</h1>
                <p>{intro}</p>
              </div>
              <div className="public-editorial-figure" aria-hidden="true">
                <img
                  src="/brand/nohmi-standing-icon.webp"
                  width={1024}
                  height={1536}
                  alt=""
                  className="public-editorial-person"
                />
                <img
                  src="/icon.svg"
                  width={512}
                  height={512}
                  alt=""
                  className="public-editorial-tablet-mark"
                />
                <img
                  src="/brand/nohmi-standing-icon.webp"
                  width={1024}
                  height={1536}
                  alt=""
                  className="public-editorial-hand public-editorial-hand--left"
                />
                <img
                  src="/brand/nohmi-standing-icon.webp"
                  width={1024}
                  height={1536}
                  alt=""
                  className="public-editorial-hand public-editorial-hand--right"
                />
              </div>
            </div>
          </header>
          <div className={`${publicContainer} public-editorial-body`}>
            {guide ? (
              <GuideNavigation slug={slug} />
            ) : (
              <nav aria-label="document navigation" className="public-editorial-nav">
                {publicDocuments
                  .filter(({ slug: path }) => ["about", "docs", "support"].includes(path))
                  .map(({ slug: path, label }) => (
                    <a
                      key={path}
                      href={`/${path}/`}
                      aria-current={slug === path ? "page" : undefined}
                    >
                      {label}
                    </a>
                  ))}
              </nav>
            )}
            <div className="min-w-0">
              <GuideContent slug={slug} content={content} />
            </div>
          </div>
        </main>
      </PublicSiteLayout>
    );
  }
  return (
    <PublicSiteLayout>
      <div
        className={`${publicContainer} grid items-start gap-6 py-12 sm:py-16 lg:grid-cols-[13rem_minmax(0,1fr)]`}
      >
        <aside>
          <Card>
            <CardHeader>
              <p className="font-medium">explore nohmi</p>
            </CardHeader>
            <CardContent>
              <nav
                aria-label="document navigation"
                className="grid grid-cols-2 gap-1 lg:flex lg:flex-col"
              >
                {publicDocuments.map(({ slug: path, label }) => (
                  <a
                    key={path}
                    href={`/${path}/`}
                    aria-current={slug === path ? "page" : undefined}
                    className="rounded-lg px-3 py-2 text-sm hover:bg-accent focus-visible:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </CardContent>
          </Card>
        </aside>
        <main id="content" tabIndex={-1} className="min-w-0">
          <Card className="[--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
            <CardHeader className="gap-4">
              <p className="text-sm text-muted-foreground">{eyebrow}</p>
              <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
              <CardDescription>{intro}</CardDescription>
            </CardHeader>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: reviewed repository-owned HTML, rendered only by the build script. */}
            <CardContent className="public-prose" dangerouslySetInnerHTML={{ __html: content }} />
          </Card>
        </main>
      </div>
    </PublicSiteLayout>
  );
}
