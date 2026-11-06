import { router } from "expo-router";
import { Body, Button, Facts, Heading } from "../components/detail-content";
import { Screen } from "../components/screen";
import { usePreview } from "../features/briefing/context";

export default function Monitoring() {
  const { scenario } = usePreview();
  return (
    <Screen>
      <Heading>what’s being checked</Heading>
      <Body>Example status only. This build is not monitoring your accounts.</Body>
      <Facts
        facts={[
          {
            label: "mail",
            value:
              scenario === "interrupted"
                ? "Paused · example connection expired. Last checked yesterday at 6:42 pm."
                : "Example check · 9:39 am",
          },
          { label: "calendar", value: "Example check · 9:39 am" },
          { label: "tasks", value: "Example check · 9:39 am" },
          { label: "finances", value: "Example check · 9:39 am. Source data as of 8:15 am." },
        ]}
      />
      <Body>
        In the connected app, check time and source freshness will be reported separately.
      </Body>
      <Button onPress={() => router.back()}>back to briefing</Button>
    </Screen>
  );
}
