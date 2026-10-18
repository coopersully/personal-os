import {
  type FinanceCashflowScheduleItem,
  type FinanceCashflowScheduleView,
  formatDateOnly,
} from "@personal-os/domain";
import type { ReactNode } from "react";
import { ItemGroup } from "@/components/ui/item";

export type FinanceCashflowViewProps = {
  schedule: FinanceCashflowScheduleView;
  renderItem: (item: FinanceCashflowScheduleItem) => ReactNode;
};

export function FinanceCashflowAgenda({ schedule, renderItem }: FinanceCashflowViewProps) {
  const dates = [...new Set(schedule.dated.map((item) => item.date as string))];
  return (
    <section aria-label="Upcoming money agenda" className="flex min-w-0 flex-col gap-5">
      {dates.length ? (
        dates.map((date) => (
          <section
            key={date}
            aria-label={formatDateOnly(date, { dateStyle: "full" })}
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 className="text-sm font-medium">{formatDateOnly(date, { dateStyle: "full" })}</h3>
            <ItemGroup>
              {schedule.dated.filter((item) => item.date === date).map(renderItem)}
            </ItemGroup>
          </section>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No next expected items recorded in this date range.
        </p>
      )}
    </section>
  );
}
