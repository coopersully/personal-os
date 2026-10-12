import { useContext } from "react";
import type { MutationFeedbackState } from "../lib/feedback.js";
import { SettingsFeedbackContext } from "../lib/settings-feedback.js";
import { Alert, AlertDescription } from "./ui/alert.js";

export function MutationFeedback({ feedback }: { feedback: MutationFeedbackState | null }) {
  const settingsFeedback = useContext(SettingsFeedbackContext);
  if (settingsFeedback || !feedback?.persistent) return null;
  return (
    <Alert variant="destructive" role="status">
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  );
}
