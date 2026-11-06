import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, Facts, Heading } from "../../components/detail-content";
import { Screen } from "../../components/screen";
import { itemById } from "../../features/briefing/sample";

export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = itemById(id);
  if (id === "draft")
    return (
      <Screen>
        <Heading>suggest 3:30 pm</Heading>
        <Body>sample draft · nothing will be sent</Body>
        <Facts
          facts={[
            { label: "to", value: "Alex · Design review thread" },
            {
              label: "draft",
              value: "I have an appointment at 2. Would 3:30 pm work for the review?",
            },
          ]}
        />
        <Body>Editing and sending will be available when Mail is connected.</Body>
      </Screen>
    );
  if (!item)
    return (
      <Screen>
        <Heading>item not found</Heading>
        <Body>This sample item is not available.</Body>
        <Button onPress={() => router.replace("/")}>back to today</Button>
      </Screen>
    );
  return (
    <Screen>
      <Heading>{item.heading}</Heading>
      <Body>sample {item.workspace} · no live account data</Body>
      <Body>{item.description}</Body>
      <Facts facts={item.facts} />
      {id === "conflict" && (
        <Button onPress={() => router.push({ pathname: "/detail/[id]", params: { id: "draft" } })}>
          preview a reply to Alex
        </Button>
      )}
    </Screen>
  );
}
