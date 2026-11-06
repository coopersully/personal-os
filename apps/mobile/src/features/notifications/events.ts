const listeners = new Set<() => void>();
export function refreshDueAlerts() {
  for (const listener of listeners) listener();
}
export function onDueAlertsRefresh(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
