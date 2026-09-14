import type { FinanceInboxCase, FinanceToolResult } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { formatMoney } from "./format.js";
import { ReviewQuestion } from "./review-page.js";

export function FinanceInboxList({ result }: { result: FinanceToolResult<FinanceInboxCase[]> }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const items = result.data.filter((item) => item.status !== "resolved");
  const selected = items.find((item) => item.id === selectedId);
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <section aria-label="Outstanding finance items" className="flex flex-col gap-3">
      <h2 className="text-base font-medium">Outstanding ({items.length})</h2>
      {items.length ? (
        <p className="text-sm text-muted-foreground">
          Leave a note for the next maintenance pass, or resolve an item yourself.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No outstanding Inbox items.</p>
      )}
      <ItemGroup>
        {visible.map((item) => (
          <Item key={item.id}>
            <ItemContent>
              <ItemTitle>
                {item.context?.merchant ?? item.prompt ?? "Review financial activity"}
              </ItemTitle>
              <ItemDescription>
                {item.context
                  ? `${item.context.date} · ${item.context.institution} ${item.context.accountName} · ${item.context.direction === "income" ? "Money in" : item.context.direction === "transfer" ? "Transfer" : "Money out"} · ${item.context.pending ? "Pending" : "Posted"}`
                  : "Open for available source details"}
              </ItemDescription>
              <ItemDescription>{item.reason?.replaceAll("_", " ")}</ItemDescription>
              {item.resolution?.type === "clarify" ? (
                <Badge variant="secondary">Note saved · awaiting maintenance</Badge>
              ) : item.status === "deferred" ? (
                <Badge variant="outline">Deferred</Badge>
              ) : null}
            </ItemContent>
            <ItemActions>
              <span className="text-sm">
                {item.context?.currencyCode
                  ? new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: item.context.currencyCode,
                    }).format(item.context.amount)
                  : item.context
                    ? `${item.context.amount} (currency unavailable)`
                    : formatMoney(item.impactAmount)}
              </span>
              <Button size="sm" variant="outline" onClick={() => setSelectedId(item.id)}>
                Review<span className="sr-only"> {item.context?.merchant ?? "item"}</span>
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {items.length > 5 ? (
        <Button variant="ghost" className="self-start" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review financial activity</DialogTitle>
            <DialogDescription>Add context or apply a correction now.</DialogDescription>
          </DialogHeader>
          {selected ? (
            <ReviewQuestion
              key={selected.id}
              review={selected}
              prompt={selected.prompt ?? "What should we know about this item?"}
              headline=""
              onResponse={(response) => {
                client.setQueryData(["finance-inbox"], response);
                void client.invalidateQueries({
                  predicate: (query) =>
                    typeof query.queryKey[0] === "string" &&
                    query.queryKey[0].startsWith("finance-") &&
                    query.queryKey[0] !== "finance-inbox",
                });
                setSelectedId(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
