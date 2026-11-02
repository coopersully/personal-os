import { useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import type { MutationFeedbackState } from "../lib/feedback.js";

/** Legacy/custom mutation callers also announce feedback without adding layout content. */
export function MutationFeedback({ feedback }: { feedback: MutationFeedbackState | null }) {
  const id = useId();
  const last = useRef<MutationFeedbackState | null>(null);
  useEffect(() => {
    if (feedback && !feedback.toastId && last.current !== feedback)
      toast.error(feedback.message, { id, duration: Number.POSITIVE_INFINITY });
    if (!feedback || feedback.toastId) toast.dismiss(id);
    last.current = feedback;
  }, [feedback, id]);
  useEffect(
    () => () => {
      toast.dismiss(id);
      last.current = null;
    },
    [id],
  );
  return null;
}
