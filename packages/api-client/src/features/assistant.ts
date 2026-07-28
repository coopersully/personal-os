import type {
  AssistantDomain,
  AssistantSetupStatus,
  AttentionItem,
  AttentionItemQuery,
  CreateAttentionItemInput,
  DomainProfile,
  UpdateAttentionItemInput,
  UpsertDomainProfileInput,
} from "@personal-os/domain";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type ToQuery = (query: object) => string;

/** Shared agent-setup operations; domain services still own executable behavior. */
export function createAssistantApiClient(request: Request, toQuery: ToQuery) {
  return {
    async createAttentionItem(input: CreateAttentionItemInput): Promise<AttentionItem> {
      const response = await request<{ item: AttentionItem }>("/v1/assistant/attention", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.item;
    },
    async getAssistantSetupStatus(): Promise<AssistantSetupStatus> {
      const response = await request<{ setup: AssistantSetupStatus }>("/v1/assistant/setup-status");
      return response.setup;
    },
    async getDomainProfile(domain: AssistantDomain): Promise<DomainProfile | null> {
      const response = await request<{ profile: DomainProfile | null }>(
        `/v1/assistant/profiles/${domain}`,
      );
      return response.profile;
    },
    async listAttentionItems(query: AttentionItemQuery): Promise<AttentionItem[]> {
      const response = await request<{ items: AttentionItem[] }>(
        `/v1/assistant/attention?${toQuery(query)}`,
      );
      return response.items;
    },
    async updateAttentionItem(
      domain: AssistantDomain,
      id: string,
      input: UpdateAttentionItemInput,
    ): Promise<AttentionItem> {
      const response = await request<{ item: AttentionItem }>(
        `/v1/assistant/attention/${domain}/${id}`,
        { body: JSON.stringify(input), method: "PATCH" },
      );
      return response.item;
    },
    async upsertDomainProfile(input: UpsertDomainProfileInput): Promise<DomainProfile> {
      const response = await request<{ profile: DomainProfile }>(
        `/v1/assistant/profiles/${input.domain}`,
        { body: JSON.stringify(input), method: "PUT" },
      );
      return response.profile;
    },
  };
}
