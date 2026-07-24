import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

function classes(...values: Array<false | null | string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "accent" | "danger" | "ghost" | "quiet";
};

export function Button({ className, tone = "quiet", type = "button", ...props }: ButtonProps) {
  return (
    <button className={classes("button", `button--${tone}`, className)} type={type} {...props} />
  );
}

export function Badge({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={classes("badge", className)} {...props}>
      {children}
    </span>
  );
}

/**
 * Shared, shadcn-style form primitives. Keep visual rules in the consuming app's
 * token stylesheet while keeping semantics and composition consistent everywhere.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes("input", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={classes("select", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: The control is supplied by the composed call site.
  return <label className={classes("label", className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={classes("card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("card__header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={classes("card__title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={classes("card__description", className)} {...props} />;
}

export function CardAction({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("card__action", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("card__content", className)} {...props} />;
}

export function EmptyState({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__ring" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
