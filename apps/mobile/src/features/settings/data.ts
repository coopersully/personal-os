import type { createApiClient } from "@personal-os/api-client";
import type { UpdateUserInput } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { errorMessage } from "../tasks/data";
export type SettingsApi = ReturnType<typeof createApiClient>;

/** Each captured API checks the live human session before and after transport. */
export function useSettingsResource<T>(
  key: string,
  load: (api: SettingsApi) => Promise<T>,
  enabled = true,
  scopedReadFeedback = false,
) {
  const { state, session } = useAuth();
  const owner = state.user?.id;
  const epoch = session.epoch();
  return useQuery({
    queryKey: ["settings", owner, epoch, key],
    meta: { scopedReadFeedback },
    queryFn: () => {
      if (!owner || epoch !== session.epoch()) throw new Error("Your session changed.");
      return load(session.api());
    },
    enabled: !!owner && enabled,
    retry: false,
  });
}
export function useSettingsAction() {
  const { state, session } = useAuth();
  const scope = { owner: state.user?.id, epoch: session.epoch() };
  const current = useRef(scope);
  current.current = scope;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = async <T>(
    action: (api: SettingsApi) => Promise<T>,
    success?: string | ((value: T) => string),
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (
      busy.current ||
      !scope.owner ||
      scope.owner !== current.current.owner ||
      scope.epoch !== session.epoch()
    )
      return { ok: false };
    busy.current = true;
    setPending(true);
    const captured = scope;
    const id = success ? toast.loading("Working…") : undefined;
    try {
      const result = await action(session.api());
      if (captured.owner !== current.current.owner || captured.epoch !== session.epoch()) {
        if (id) toast.dismiss(id);
        return { ok: false };
      }
      if (success) toast.success(typeof success === "function" ? success(result) : success, { id });
      return { ok: true, value: result };
    } catch (error) {
      if (captured.owner === current.current.owner && captured.epoch === session.epoch())
        toast.error(errorMessage(error), { id });
      else if (id) toast.dismiss(id);
      return { ok: false };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { pending, run };
}
const userQueues = new WeakMap<object, Promise<unknown>>();
export function useUserSettings() {
  const { state, session } = useAuth();
  const query = useQueryClient();
  const action = useSettingsAction();
  const save = (input: UpdateUserInput, success?: string) =>
    action.run(async (api) => {
      const epoch = session.epoch();
      const previous = userQueues.get(session) ?? Promise.resolve();
      const operation = previous
        .catch(() => {})
        .then(async () => {
          const user = await api.updateUser(input);
          if (!session.acceptUserUpdate(user, epoch)) throw new Error("Your session changed.");
          await query.invalidateQueries({ queryKey: ["settings", user.id] });
          return user;
        });
      userQueues.set(session, operation);
      return operation;
    }, success);
  return { user: state.user, save, pending: action.pending };
}
