// git archive substitutes this marker in the existing Mac production build path.
// Ordinary checkouts deliberately report no deployment provenance.
const archivedRevision = "$Format:%H$";

export function readinessPayload(revision = archivedRevision) {
  return {
    status: "ready",
    ...(/^[a-f0-9]{40}$/.test(revision) ? { revision } : {}),
  };
}
