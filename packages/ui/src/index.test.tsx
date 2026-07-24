// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Spinner,
} from "./index.js";

describe("shared UI primitives", () => {
  it("preserves the supplied semantics, styles, and accessible content", () => {
    render(
      <>
        <Button className="extra">Default button</Button>
        <Button tone="danger" type="submit">
          Danger button
        </Button>
        <Badge className="extra">Badge</Badge>
        <Label htmlFor="field">Field label</Label>
        <Input id="field" />
        <Select aria-label="Choice">
          <option>One</option>
        </Select>
        <Card aria-label="Card">
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
            <CardAction>Action</CardAction>
          </CardHeader>
          <CardContent>Content</CardContent>
        </Card>
        <EmptyState icon={<svg />} title="Empty title">
          Empty description
        </EmptyState>
        <Spinner />
        <Spinner label="Saving" />
      </>,
    );

    expect(screen.getByRole("button", { name: "Default button" })).toHaveAttribute(
      "type",
      "button",
    );
    expect(screen.getByRole("button", { name: "Danger button" })).toHaveAttribute("type", "submit");
    expect(screen.getByText("Badge")).toHaveClass("badge", "extra");
    expect(screen.getByLabelText("Field label")).toHaveClass("input");
    expect(screen.getByRole("combobox", { name: "Choice" })).toHaveClass("select");
    expect(screen.getByRole("region", { name: "Card" })).toHaveClass("card");
    expect(screen.getByRole("heading", { name: "Title" })).toHaveClass("card__title");
    expect(screen.getByText("Empty description")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByText("Saving")).toBeInTheDocument();
  });
});
