import { type ReactNode, useId } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@/components/icons";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { SettingsFieldFocus } from "./settings-field-focus.js";

/** Settings composition: a page introduction, then task-sized groups. No workspace app bar. */
export function SettingsPageLayout({
  title,
  description,
  icon,
  section,
  search,
  actions,
  children,
  showHeader = true,
  back,
}: {
  back?: { to: string; label: string } | undefined;
  title: string;
  description: string;
  icon?: ReactNode;
  showHeader?: boolean;
  section: string;
  search: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-page">
      <SettingsFieldFocus />
      {showHeader ? (
        <Card className="settings-page__heading relative" data-settings-section={section}>
          {back ? (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="absolute left-3 top-3"
              aria-label={back.label}
            >
              <Link to={back.to}>
                <ArrowLeftIcon aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
          <CardHeader className="flex flex-col items-center gap-4 text-center">
            <div className="flex min-w-0 flex-col items-center gap-3">
              {icon ? (
                <span className="settings-page__icon" aria-hidden="true">
                  {icon}
                </span>
              ) : null}
              <div className="min-w-0">
                <h1 tabIndex={-1} id="settings-page-title">
                  {title}
                </h1>
                <p>{description}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 empty:hidden">
              {actions}
              <div className="settings-page__mobile-search">{search}</div>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <>
          <h1 id="settings-page-title" className="sr-only" tabIndex={-1}>
            {title}
          </h1>
          <div className="settings-page__tools" data-has-actions={Boolean(actions)}>
            {actions}
            <div className="settings-page__mobile-search">{search}</div>
          </div>
        </>
      )}
      <section className="settings-panel" aria-labelledby="settings-page-title">
        <SettingsControlsContext.Provider value={true}>{children}</SettingsControlsContext.Provider>
      </section>
    </div>
  );
}

/** A shared shadcn Card composition; feature modules still own fields and mutations. */
export function SettingsSection({
  action,
  children,
  title,
  layout = "content",
  headerContent,
  headerAside,
  icon,
  description,
}: {
  layout?: "rows" | "content";
  headerContent?: ReactNode;
  headerAside?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  const headingId = useId();
  return (
    <section className="settings-subsection" aria-labelledby={headingId}>
      {!icon ? (
      <div className="settings-subsection__label">
        <h2 id={headingId}>{title}</h2>
        {action ? <CardAction>{action}</CardAction> : null}
      </div>
      ) : null}
      <Card
        className={
          layout === "rows"
            ? "settings-section settings-section--rows gap-0 py-0"
            : "settings-section"
        }
      >
        {icon ? (
          <CardHeader className="settings-subsection__header flex flex-row items-start gap-3 p-4">
            <span className="settings-subsection__icon" aria-hidden="true">{icon}</span>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 id={headingId} className="text-sm font-semibold">{title}</h2>
              {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
              {headerContent}
            </div>
            {headerAside}
            {action ? <CardAction>{action}</CardAction> : null}
          </CardHeader>
        ) : null}
        <CardContent
          className={
            layout === "rows"
              ? "settings-section__body settings-section__body--rows p-0"
              : "settings-section__body"
          }
        >
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

/** Adapt to the content width, including a collapsed/expanded application sidebar. */
export function SettingsBento({
  children,
  primaryFirst = false,
}: {
  children: ReactNode;
  primaryFirst?: boolean;
}) {
  return (
    <div className="settings-stack" data-primary-first={primaryFirst}>
      {children}
    </div>
  );
}
