import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.PERSONAL_OS_APNS_ENVIRONMENT;
  if (environment !== undefined && environment !== "sandbox" && environment !== "production")
    throw new Error("PERSONAL_OS_APNS_ENVIRONMENT must be sandbox or production.");
  return {
    ...config,
    name: config.name ?? "nohmi",
    slug: config.slug ?? "personal-os",
    extra: { ...config.extra, apnsEnvironment: environment ?? null },
    ios: {
      ...config.ios,
      entitlements: {
        ...config.ios?.entitlements,
        ...(environment
          ? { "aps-environment": environment === "sandbox" ? "development" : "production" }
          : {}),
      },
    },
  };
};
