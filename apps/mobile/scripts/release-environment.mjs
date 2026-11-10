export const productionAppOrigin = "https://nohmi.coopersully.me";
export const productionApiOrigin = "https://nohmi-api.coopersully.me";

export function releaseEnvironment(env) {
  if (env.EXPO_PUBLIC_API_URL && env.EXPO_PUBLIC_API_URL !== productionApiOrigin) {
    throw new Error(
      "Archive requires the production nohmi API; remove the development API override.",
    );
  }
  // Expo dotenv loading must not import a worktree's local preview configuration.
  return {
    ...env,
    NODE_ENV: "production",
    PERSONAL_OS_APNS_ENVIRONMENT: "production",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_URL: productionApiOrigin,
    EXPO_PUBLIC_APP_URL: productionAppOrigin,
  };
}
