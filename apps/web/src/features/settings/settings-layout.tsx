import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsFieldFocus } from "./settings-field-focus.js";

/** Settings composition: a page introduction, then task-sized groups. No workspace app bar. */
export function SettingsPageLayout({
  title,
  description,
  search,
  children,
}: {
  title: string;
  description: string;
  search: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-page">
      <SettingsFieldFocus />
      <header className="settings-page__heading">
        <div className="min-w-0">
          <h1 tabIndex={-1} id="settings-page-title">
            {title}
          </h1>
          <p>{description}</p>
        </div>
        <div className="settings-page__mobile-search">{search}</div>
      </header>
      <section className="settings-panel" aria-labelledby="settings-page-title">
        {children}
      </section>
    </div>
  );
}

/** A shared shadcn Card composition; feature modules still own fields and mutations. */
export function SettingsSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <Card className="settings-section">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="settings-section__body">{children}</CardContent>
    </Card>
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
    <div className="settings-bento" data-primary-first={primaryFirst}>
      {children}
    </div>
  );
}
