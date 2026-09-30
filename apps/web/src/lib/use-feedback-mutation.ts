import { type QueryClient, type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { useId, useMemo, useRef } from "react";
import { toast } from "sonner";
import { classifyMutationError, type FeedbackOptions } from "./feedback.js";

export function useFeedbackMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  {
    feedback: options,
    ...mutationOptions
  }: UseMutationOptions<TData, TError, TVariables, TOnMutateResult> & { feedback: FeedbackOptions },
  queryClient?: QueryClient,
) {
  const operationId = useId();
  const attempt = useRef(0);
  const toastId = useRef(`${operationId}-0`);
  const mutation = useMutation(
    {
      ...mutationOptions,
      // Uncertain writes must never be retried automatically.
      ...(options.safeToRetry ? {} : { retry: false }),
      onMutate: (...args) => {
        // Sonner dismisses on the next animation frame. A new attempt needs a
        // fresh ID so that dismissal cannot remove its fast success result.
        toast.dismiss(toastId.current);
        toastId.current = `${operationId}-${++attempt.current}`;
        // Match TanStack’s optional onMutate contract: without a callback it
        // supplies undefined context even when a caller specifies a result type.
        return mutationOptions.onMutate?.(...args) as TOnMutateResult | Promise<TOnMutateResult>;
      },
      onError: (...args) => {
        const failure = classifyMutationError(args[0], options);
        if (!failure.persistent)
          toast.error(failure.message, { id: toastId.current, duration: Number.POSITIVE_INFINITY });
        return mutationOptions.onError?.(...args);
      },
      onSuccess: async (...args) => {
        try {
          await mutationOptions.onSuccess?.(...args);
          if (options.success) toast.success(options.success, { id: toastId.current });
          else toast.dismiss(toastId.current);
        } catch {
          toast.error(
            "The change was saved, but the view couldn’t refresh. Refresh the page to see the latest state.",
            { id: toastId.current, duration: Number.POSITIVE_INFINITY },
          );
        }
      },
    },
    queryClient,
  );
  const feedback = useMemo(
    () =>
      mutation.isError
        ? classifyMutationError(mutation.error, {
            action: options.action,
            form: Boolean(options.form),
            safeToRetry: Boolean(options.safeToRetry),
          })
        : null,
    [mutation.isError, mutation.error, options.action, options.form, options.safeToRetry],
  );
  return { ...mutation, feedback };
}
