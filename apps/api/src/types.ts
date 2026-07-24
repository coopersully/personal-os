import type { GoogleConnector, ICloudConnector, XConnector } from "@personal-os/connectors";
import type { Database } from "@personal-os/database";
import type { AccessScope, ActorType } from "@personal-os/domain";
import type { AppConfig } from "./config.js";
import type { EmailDelivery } from "./email-delivery.js";

export type Principal = {
  actorId: string;
  actorType: Extract<ActorType, "agent" | "user">;
  scopes: ReadonlySet<AccessScope>;
  userId: string;
};

export type AppDependencies = {
  config: AppConfig;
  db: Database;
  fetch?: typeof globalThis.fetch;
  email?: EmailDelivery;
  google?: GoogleConnector;
  icloud?: ICloudConnector;
  log?: (entry: RequestLog) => void;
  now?: () => Date;
  x?: XConnector;
};

export type RequestLog = {
  durationMs: number;
  method: string;
  path: string;
  requestId: string;
  status: number;
};

export type AppVariables = {
  principal: Principal;
  requestId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
