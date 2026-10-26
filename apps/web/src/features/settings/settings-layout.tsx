import { type ReactNode, useId } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@/components/icons";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { SettingsDataStateNotice } from "./dev/data-state-preview";
import { SettingsFieldFocus } from "./settings-field-focus.js";

/** Settings uses the shared workspace header and keeps task-sized groups in the page. */
export function SettingsPageLayout({
  title,
  description,
  section,
  search,
  actions,
  children,
  back,
}: {
  back?: { to: string; label: string } | undefined;
  title: string;
  description: string;
  section: string;
  search: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-page">
      <SettingsFieldFocus />
      {import.meta.env.DEV ? <SettingsDataStateNotice /> : null}
      <WorkspaceHeaderControls placement="title" label="Settings page">
        <Breadcrumb aria-label="Settings breadcrumbs">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/settings">settings</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            {back ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={back.to}>{back.label.replace(/^back to /i, "")}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator>/</BreadcrumbSeparator>
              </>
            ) : null}
            <BreadcrumbItem>
              <BreadcrumbPage>
                <h1 className="workspace-app-bar__title" tabIndex={-1} id="settings-page-title">
                  {title}
                </h1>
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </WorkspaceHeaderControls>
      <WorkspaceHeaderControls label="Settings actions">
        {back ? (
          <Button asChild variant="ghost" size="icon" aria-label={back.label}>
            <Link to={back.to}>
              <ArrowLeftIcon aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
        {search}
        {actions}
      </WorkspaceHeaderControls>
      <p className="settings-page__description" data-settings-section={section}>
        {description}
      </p>
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
  const hasHeader = Boolean(icon || headerAside);
  return (
    <section className="settings-subsection" aria-labelledby={headingId}>
      {!hasHeader ? (
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
        {hasHeader ? (
          <CardHeader className="settings-subsection__header flex flex-row items-start gap-3 p-4">
            {icon ? (
              <span className="settings-subsection__icon" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1 space-y-1">
              <h2 id={headingId} className="text-sm font-semibold">
                {title}
              </h2>
              {description ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              ) : null}
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
