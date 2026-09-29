import { useSearchParams } from "react-router-dom";
import { ErrorPage, type ErrorPageKind, errorPageStates } from "@/components/error-page";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Loaded only by the development-only route; no session or backend is required. */
export default function ErrorPagePreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("state") ?? "404";
  const kind: ErrorPageKind = Object.hasOwn(errorPageStates, requested)
    ? (requested as ErrorPageKind)
    : "404";

  return (
    <div className="error-preview">
      <section aria-label="Development preview controls" className="error-preview__controls">
        <Label htmlFor="error-preview-state">Error preview</Label>
        <NativeSelect
          id="error-preview-state"
          onChange={(event) => setParams({ state: event.target.value })}
          value={kind}
        >
          {Object.entries(errorPageStates).map(([value, state]) => (
            <NativeSelectOption key={value} value={value}>
              {state.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </section>
      <ErrorPage kind={kind} />
    </div>
  );
}
