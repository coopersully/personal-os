export function queryWindowFocusPolicy(desktop: boolean, hash: string = "") {
  return !(desktop && hash === "#ritual");
}
