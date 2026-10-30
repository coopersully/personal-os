import type { ReactNode } from "react";
import { BRAND_PROMISE } from "../../brand.js";
import { PersonalOsBrandMark } from "../../components/brand-marks.js";
import { Button } from "../../components/ui/button.js";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../components/ui/navigation-menu.js";

export const publicDocuments = [
  { slug: "about", label: "about" },
  { slug: "docs", label: "guide" },
  { slug: "privacy", label: "privacy" },
  { slug: "terms", label: "terms" },
  { slug: "data-use", label: "data use" },
  { slug: "sms", label: "texting terms" },
  { slug: "support", label: "support" },
] as const;

const footerGroups = [
  {
    title: "product",
    links: [
      { href: "/about/", label: "about" },
      { href: "/docs/", label: "guide" },
      { href: "/support/", label: "support" },
    ],
  },
  {
    title: "account",
    links: [
      { href: "/login", label: "sign in" },
      { href: "/signup", label: "create account" },
    ],
  },
  {
    title: "legal",
    links: [
      { href: "/privacy/", label: "privacy" },
      { href: "/terms/", label: "terms" },
      { href: "/data-use/", label: "data use" },
      { href: "/sms/", label: "texting terms" },
    ],
  },
];

/** One spacing grid for all public headers, sections, documents, and footers. */
export const publicContainer = "mx-auto w-full max-w-6xl px-6 sm:px-8";

export function PublicSiteLayout({
  children,
  contentId = "content",
}: {
  children: ReactNode;
  contentId?: string;
}) {
  return (
    <div className="public-site flex min-h-svh flex-col bg-background text-foreground">
      <a className="skip-link" href={`#${contentId}`}>
        skip to content
      </a>
      <header className="public-header">
        <div className={publicContainer}>
          <div className="public-nav">
            <a href="/" aria-label="nohmi home">
              <PersonalOsBrandMark />
            </a>
            <NavigationMenu aria-label="product navigation" viewport={false}>
              <NavigationMenuList className="flex-wrap gap-1">
                <NavigationMenuItem>
                  <NavigationMenuLink href="/docs/">guide</NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <Button asChild>
                    <a href="/login">sign in</a>
                  </Button>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="public-footer relative isolate overflow-hidden text-foreground">
        <span aria-hidden="true" className="public-footer-wordmark">
          nohmi
        </span>
        <div className={`${publicContainer} relative flex flex-col gap-8 py-12`}>
          <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
            <div className="flex flex-col items-start gap-4">
              <a href="/" aria-label="nohmi home">
                <PersonalOsBrandMark />
              </a>
              <p className="max-w-sm text-sm leading-relaxed">{BRAND_PROMISE}</p>
            </div>
            <nav
              aria-label="public documentation"
              className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3"
            >
              {footerGroups.map(({ title, links }) => (
                <section key={title} className="flex flex-col items-start gap-4">
                  <h2 className="text-sm font-medium">{title}</h2>
                  <ul className="flex flex-col gap-3">
                    {links.map(({ href, label }) => (
                      <li key={href}>
                        <a
                          className="text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
                          href={href}
                        >
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          </div>
        </div>
        <p className="public-footer-copyright relative text-sm">
          © Cooper Sullivan {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
