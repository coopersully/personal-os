import { BrandMark, brandTitle } from "@/components/brand-marks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface ConnectedAccountProfile {
  avatarUrl?: string | null | undefined;
  email?: string | null | undefined;
  label: string;
  provider: string;
}

/** Shared provider-account identity; the service badge remains visible at every size. */
export function ConnectedAccountIdentity({
  avatarUrl,
  label,
  provider,
  size = "default",
}: ConnectedAccountProfile & { size?: "default" | "sm" }) {
  const fallback =
    label
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span aria-hidden="true" className="connected-account-visual" data-size={size}>
      <Avatar size={size === "sm" ? "default" : "lg"}>
        {avatarUrl ? <AvatarImage alt="" src={avatarUrl} /> : null}
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      <span className="connected-account-visual__service">
        <BrandMark brand={provider} decorative className="size-3" />
      </span>
    </span>
  );
}

export function ConnectedAccount({ account }: { account: ConnectedAccountProfile }) {
  const service = brandTitle(account.provider) ?? account.provider;
  const label = account.label.trim() || account.email || service;
  return (
    <span className="account-profile">
      <ConnectedAccountIdentity {...account} label={label} />
      <span className="account-profile__copy">
        <span className="account-profile__name">{label}</span>
        <span className="account-profile__details">
          {service}
          {account.email ? ` · ${account.email}` : ""}
        </span>
      </span>
    </span>
  );
}
