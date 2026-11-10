/** iOS 27 exposes a real prominent tab surface; older systems keep the sibling button. */
export function supportsProminentCompose(os: string, version: string | number) {
  return os === "ios" && Number.parseInt(String(version), 10) >= 27;
}
