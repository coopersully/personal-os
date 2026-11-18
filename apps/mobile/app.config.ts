import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.PERSONAL_OS_APNS_ENVIRONMENT;
  if (environment !== undefined && environment !== "sandbox" && environment !== "production")
    throw new Error("PERSONAL_OS_APNS_ENVIRONMENT must be sandbox or production.");
  // Universal Links: a signed build claims record links on its HTTPS web origin. Development
  // builds without that origin keep no associated-domains entitlement.
  const appUrl = process.env.EXPO_PUBLIC_APP_URL;
  const linkHost = appUrl?.startsWith("https://") ? new URL(appUrl).host : null;
  return {
    ...config,
    name: config.name ?? "nohmi",
    slug: config.slug ?? "personal-os",
    extra: { ...config.extra, apnsEnvironment: environment ?? null },
    ios: {
      ...config.ios,
      ...(linkHost ? { associatedDomains: [`applinks:${linkHost}`] } : {}),
      entitlements: {
        ...config.ios?.entitlements,
        ...(environment
          ? { "aps-environment": environment === "sandbox" ? "development" : "production" }
          : {}),
      },
    },
  };
};
