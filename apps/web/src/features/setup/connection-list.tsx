import { BrandMark } from "@/components/brand-marks";
import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

export type SetupConnection = {
  description?: string;
  id: string;
  label: string;
};

type ConnectionListProps = {
  addLabel: string;
  connections: SetupConnection[];
  emptyText: string;
  mark: "apple" | "google" | "plaid";
  onAdd: () => void;
};

export function ConnectionList({
  addLabel,
  connections,
  emptyText,
  mark,
  onAdd,
}: ConnectionListProps) {
  return (
    <div className="setup-connection-list">
      {connections.length ? (
        <ItemGroup aria-label="Connected accounts">
          {connections.map((connection) => (
            <Item className="setup-connection-item" key={connection.id}>
              <ItemMedia variant="icon">
                <BrandMark brand={mark} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{connection.label}</ItemTitle>
                {connection.description ? (
                  <ItemDescription>{connection.description}</ItemDescription>
                ) : null}
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="setup-connection-empty">{emptyText}</p>
      )}
      <Button className="setup-connection-add" onClick={onAdd} variant="secondary">
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}
