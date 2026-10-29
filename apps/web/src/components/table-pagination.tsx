import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

/** Footer for bounded pages, including cursor APIs without a known total. */
export function TablePagination({
  pageIndex,
  pageSize,
  count,
  hasNext,
  pending = false,
  onPrevious,
  onNext,
  onPageSizeChange,
}: {
  pageIndex: number;
  pageSize: number;
  count: number;
  hasNext: boolean;
  pending?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const start = pageIndex * pageSize;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 pb-16 text-xs sm:pb-2 text-muted-foreground">
      <span>{count ? `${start + 1}–${start + count}` : "0"}</span>
      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            Rows per page
            <NativeSelect
              aria-label="Rows per page"
              value={pageSize}
              disabled={pending}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {[10, 25, 50, 100].map((size) => (
                <NativeSelectOption key={size} value={size}>
                  {size}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={pending || pageIndex === 0}
          onClick={onPrevious}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span>Page {pageIndex + 1}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={pending || !hasNext}
          onClick={onNext}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
