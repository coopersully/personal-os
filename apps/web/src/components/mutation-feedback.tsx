import type { MutationFeedbackState } from "../lib/feedback.js";
import { Alert, AlertDescription } from "./ui/alert.js";

export function MutationFeedback({ feedback }: { feedback: MutationFeedbackState | null }) {
  if (!feedback?.persistent) return null;
  return (
    <Alert variant="destructive" role="status">
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  );
}
