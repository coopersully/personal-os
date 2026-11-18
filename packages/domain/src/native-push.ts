import { z } from "zod";

export const nativePushDeviceInputSchema = z
  .object({
    installationId: z.uuid(),
    token: z.string().regex(/^[a-fA-F0-9]{64,512}$/),
    environment: z.enum(["sandbox", "production"]),
    financeEnabled: z.boolean(),
  })
  .strict();
export type NativePushDeviceInput = z.infer<typeof nativePushDeviceInputSchema>;
export type NativePushDeviceRegistration = {
  installationId: string;
  financeEnabled: boolean;
  revision: number;
  status: "registered" | "disabled";
  audience: string;
};
export type NativePushEventDetail = {
  title: string;
  summary: string;
  status: string;
  webPath: string;
  webUrl: string;
};
export type NativePushEventDestination = {
  destination: "finance_chat" | "finance_attention" | "finance_activity";
  detail?: NativePushEventDetail;
  audience: string;
};
