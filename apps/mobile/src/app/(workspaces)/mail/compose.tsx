import { Redirect } from "expo-router";
/** Native prominent trigger opens the root modal; direct links take the same route. */
export default function Compose() {
  return <Redirect href="/mail-compose" />;
}
