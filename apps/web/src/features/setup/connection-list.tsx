import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-marks";
import { ConnectedAccount, type ConnectedAccountProfile } from "@/components/connected-account";
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
  account?: ConnectedAccountProfile;
  identity?: ReactNode;
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
              {connection.identity ??
                (connection.account ? (
                  <ItemContent>
                    <ConnectedAccount account={connection.account} />
                    {connection.description ? (
                      <ItemDescription>{connection.description}</ItemDescription>
                    ) : null}
                  </ItemContent>
                ) : (
                  <>
                    <ItemMedia variant="icon">
                      <BrandMark brand={mark} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{connection.label}</ItemTitle>
                      {connection.description ? (
                        <ItemDescription>{connection.description}</ItemDescription>
                      ) : null}
                    </ItemContent>
                  </>
                ))}
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
