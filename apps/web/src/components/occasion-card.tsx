import type { CSSProperties, ReactNode } from "react";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item";

function OccasionCard({
  accentColor,
  aside,
  endDateTime,
  endLabel,
  onOpen,
  startDateTime,
  startLabel,
  title,
}: {
  accentColor: string;
  aside?: ReactNode;
  endDateTime: string;
  endLabel: string;
  onOpen: () => void;
  startDateTime: string;
  startLabel: string;
  title: string;
}) {
  const singleDay = startDateTime === endDateTime;
  return (
    <Item
      asChild
      className="occasion-card"
      size="sm"
      style={{ "--occasion-color": accentColor } as CSSProperties}
      variant="muted"
    >
      <button
        aria-label={
          singleDay
            ? `All day ${title}. ${startLabel}, all day. Open details`
            : `All day ${title}. Starts ${startLabel}. Ends ${endLabel}. Open details`
        }
        onClick={onOpen}
        type="button"
      >
        <ItemContent>
          <ItemHeader>
            <ItemTitle>
              <span className="truncate">{title}</span>
            </ItemTitle>
            {aside ? <ItemActions>{aside}</ItemActions> : null}
          </ItemHeader>
          <ItemDescription
            aria-label={
              singleDay ? `${startLabel}, all day` : `Starts ${startLabel}, ends ${endLabel}`
            }
            className="occasion-card__span"
            data-single-day={singleDay}
          >
            {singleDay ? (
              <time dateTime={startDateTime}>{startLabel} · All day</time>
            ) : (
              <>
                <time dateTime={startDateTime}>Starts {startLabel}</time>
                <span aria-hidden="true" className="occasion-card__rail" />
                <time dateTime={endDateTime}>Ends {endLabel}</time>
              </>
            )}
          </ItemDescription>
        </ItemContent>
      </button>
    </Item>
  );
}

export { OccasionCard };
