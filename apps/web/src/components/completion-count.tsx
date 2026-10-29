/** Plain completion ratio, kept together when space is constrained. */
export function CompletionCount({ value, total }: { value: number; total: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {value} / {total}
    </span>
  );
}
