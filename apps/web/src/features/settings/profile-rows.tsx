import { type ReactNode, useId } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon, ChevronRightIcon } from "@/components/icons";
import { SettingsIconSlot } from "@/components/settings-icon-slot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h2 id={id} className="px-1 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      <Card className="gap-0 py-0">
        <CardContent className="p-0">{children}</CardContent>
      </Card>
    </section>
  );
}

export function ProfileRow({
  label,
  icon,
  value,
  description,
  to,
  onClick,
  disabled = false,
  ariaLabel,
  truncateDescription = false,
  variant = "default",
}: {
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  value?: ReactNode;
  description?: ReactNode;
  truncateDescription?: boolean;
  variant?: "default" | "inactive" | "danger";
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const TrailingIcon = to ? ArrowRightIcon : ChevronRightIcon;
  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {icon ? <SettingsIconSlot>{icon}</SettingsIconSlot> : null}
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {description ? (
            <span
              className={
                truncateDescription
                  ? "block max-w-[52ch] truncate text-xs font-normal text-muted-foreground"
                  : "block text-xs font-normal text-muted-foreground"
              }
            >
              {description}
            </span>
          ) : null}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 min-w-0 max-w-[60%] items-center justify-end gap-3">
        <span className="truncate font-normal text-muted-foreground">{value}</span>
        <TrailingIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </span>
    </>
  );
  return (
    <Button
      data-settings-variant={variant}
      asChild={Boolean(to)}
      aria-label={ariaLabel ?? (to ? label : `Edit ${label}`)}
      variant="ghost"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="settings-navigation-row h-auto min-h-12 w-full justify-between gap-8 rounded-none border-0 border-b border-border/40 last:border-b-0 px-4 py-2 whitespace-normal"
    >
      {to ? <Link to={to}>{content}</Link> : content}
    </Button>
  );
}
