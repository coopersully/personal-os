import { ApiClientError } from "@personal-os/api-client";
import {
  type DefaultOptions,
  MutationCache,
  type Query,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";

export function createAppQueryClient(defaultOptions: DefaultOptions = {}) {
  let sessionGeneration = 0;
  let sessionIdentity: unknown;
  const mutationSessions = new WeakMap<object, number>();
  const handleAccessDenial = (error: Error, deniedQuery?: Query<unknown, unknown>) => {
    if (!(error instanceof ApiClientError) || (error.status !== 401 && error.status !== 403))
      return;
    // A failed refresh may retain stale data for a network outage, but never
    // for an authoritative access denial. Cancel old-session requests too.
    const deniedQueries =
      error.status === 401 ? client.getQueryCache().getAll() : deniedQuery ? [deniedQuery] : [];
    if (error.status === 401) void client.cancelQueries();
    for (const query of deniedQueries) {
      query.setState({
        data: undefined,
        dataUpdatedAt: 0,
        error,
        errorUpdatedAt: Date.now(),
        fetchStatus: "idle",
        status: "error",
      });
    }
  };
  const client = new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({ onError: handleAccessDenial }),
    mutationCache: new MutationCache({
      onMutate: (_variables, mutation) => {
        mutationSessions.set(mutation, sessionGeneration);
      },
      onError: (error, _variables, _context, mutation) => {
        if (mutationSessions.get(mutation) === sessionGeneration) handleAccessDenial(error);
      },
    }),
  });
  client.getQueryCache().subscribe((event) => {
    if (event.query.queryKey.length !== 1 || event.query.queryKey[0] !== "me") return;
    const data = event.type === "removed" ? undefined : event.query.state.data;
    const identity = data && typeof data === "object" && "id" in data ? data.id : undefined;
    // Profile edits keep the session; logout, expiry, and a new identity replace it.
    if (identity !== sessionIdentity) {
      sessionIdentity = identity;
      sessionGeneration += 1;
    }
  });
  return client;
}
