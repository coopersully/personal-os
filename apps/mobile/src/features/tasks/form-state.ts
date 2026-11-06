import { useState } from "react";
/** Only explicit edits mark the form; asynchronous defaults use the third setter. */
export function useDraftField<T>(initial: T, markEdited: () => void) {
  const [value, initialize] = useState(initial);
  const edit = (next: T) => {
    markEdited();
    initialize(next);
  };
  return [value, edit, initialize] as const;
}
