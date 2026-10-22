import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import { Reorder, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ColumnsIcon, DownloadIcon, MoreHorizontalIcon } from "./icons";
import { ReorderHandle } from "./reorder-handle";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "./responsive-dialog";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Item } from "./ui/item";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/** Nested controls keep their own action; selection never opens a record. */
function isRecordClick(event: React.MouseEvent<HTMLElement>) {
  return (
    !(event.target as Element).closest(
      'button, a, input, select, textarea, [role="button"], [role="checkbox"]',
    ) && !window.getSelection()?.toString()
  );
}

export type DataColumn<T> = {
  id: string;
  label: string;
  value: (row: T) => string | number;
  cell?: (row: T) => ReactNode;
  mobileCell?: (row: T) => ReactNode;
  mobileHidden?: boolean;
  mobileOrder?: number;
  primary?: boolean;
  defaultHidden?: boolean;
  width?: number;
};
type View = {
  order: string[];
  hidden: string[];
  density: "comfortable" | "compact";
  wrap: boolean;
  sizing: Record<string, number>;
};
type Props<T> = {
  rows: T[];
  columns: DataColumn<T>[];
  rowId: (row: T) => string;
  rowLabel: (row: T) => string;
  onOpen: (row: T) => void;
  storageKey: string;
  label: string;
  fileName: string;
  caption?: ReactNode;
};
export function csvCell(value: string | number) {
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function defaults<T>(columns: DataColumn<T>[]): View {
  return {
    order: columns.map((c) => c.id),
    hidden: columns.filter((c) => c.defaultHidden && !c.primary).map((c) => c.id),
    density: "compact",
    wrap: false,
    sizing: {},
  };
}
function readView<T>(key: string, columns: DataColumn<T>[]): View {
  const fallback = defaults(columns);
  try {
    const data = JSON.parse(localStorage.getItem(`nohmi:data-view:${key}`) ?? "null");
    if (!data || !Array.isArray(data.order) || !Array.isArray(data.hidden)) return fallback;
    const ids = new Set(fallback.order);
    const order: string[] = [
      ...new Set<string>(data.order.filter((id: unknown) => typeof id === "string" && ids.has(id))),
    ];
    return {
      order: [...order, ...fallback.order.filter((id) => !order.includes(id))],
      hidden: data.hidden.filter(
        (id: unknown) => typeof id === "string" && columns.some((c) => c.id === id && !c.primary),
      ),
      density: data.density === "comfortable" ? "comfortable" : "compact",
      wrap: data.wrap === true,
      sizing: Object.fromEntries(
        Object.entries(data.sizing ?? {}).filter(
          ([id, size]) =>
            ids.has(id) &&
            typeof size === "number" &&
            Number.isFinite(size) &&
            size >= 80 &&
            size <= 600,
        ),
      ) as Record<string, number>,
    };
  } catch {
    return fallback;
  }
}
/** Manual pagination: this component receives only the current authorized page. */
export function DataTable<T>(props: Props<T>) {
  return <DataTableState key={props.storageKey} {...props} />;
}
function DataTableState<T>({
  rows,
  columns,
  rowId,
  rowLabel,
  onOpen,
  storageKey,
  label,
  fileName,
  caption,
}: Props<T>) {
  const mobile = useIsMobile();
  const [view, setView] = useState(() => readView(storageKey, columns));
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ page: string; ids: RowSelectionState }>({
    page: "",
    ids: {},
  });
  const page = rows.map(rowId).join("|");
  const selectedIds = selection.page === page ? selection.ids : {};
  useEffect(() => {
    try {
      localStorage.setItem(`nohmi:data-view:${storageKey}`, JSON.stringify(view));
    } catch {
      toast.error("Couldn’t save your table layout on this device.", {
        id: `data-view:${storageKey}`,
      });
    }
  }, [view, storageKey]);
  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.label,
        accessorFn: column.value,
        size: column.width ?? 160,
        minSize: 80,
        maxSize: 600,
        cell: ({ row }) =>
          column.primary ? (
            <Button
              variant="ghost"
              className="h-auto min-h-7 max-w-full justify-start whitespace-normal px-1 text-left"
              aria-label={rowLabel(row.original)}
              onClick={() => onOpen(row.original)}
            >
              {(mobile ? column.mobileCell?.(row.original) : undefined) ??
                column.cell?.(row.original) ??
                column.value(row.original)}
            </Button>
          ) : (
            ((mobile ? column.mobileCell?.(row.original) : undefined) ??
            column.cell?.(row.original) ??
            column.value(row.original))
          ),
      })),
    [columns, rowLabel, onOpen, mobile],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: rowId,
    columnResizeMode: "onChange",
    enableRowSelection: true,
    state: {
      columnOrder: view.order,
      columnVisibility: Object.fromEntries(view.hidden.map((id) => [id, false])),
      columnSizing: view.sizing,
      rowSelection: selectedIds,
    },
    onColumnSizingChange: (updater) =>
      setView((old) => ({
        ...old,
        sizing: typeof updater === "function" ? updater(old.sizing) : updater,
      })),
    onRowSelectionChange: (updater) =>
      setSelection({ page, ids: typeof updater === "function" ? updater(selectedIds) : updater }),
  });
  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const ordered = view.order.flatMap((id) => {
    const c = columns.find((item) => item.id === id);
    return c ? [c] : [];
  });
  const visible = ordered.filter((column) => !view.hidden.includes(column.id));
  function exportPage() {
    const data = selected.length ? selected : rows;
    const csv = [
      visible.map((c) => csvCell(c.label)).join(","),
      ...data.map((row) => visible.map((c) => csvCell(c.value(row))).join(",")),
    ].join("\r\n");
    try {
      const url = URL.createObjectURL(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      const revoke = URL.revokeObjectURL.bind(URL);
      window.setTimeout(() => revoke(url), 1000);
      toast.success(
        `CSV download started for ${data.length} ${data.length === 1 ? "row" : "rows"}.`,
      );
    } catch {
      toast.error("Couldn’t start the CSV download. Try again.");
    }
  }
  function move(id: string, delta: number) {
    setView((old) => {
      const order = [...old.order];
      const index = order.indexOf(id);
      const other = index + delta;
      if (other < 0 || other >= order.length) return old;
      [order[index], order[other]] = [order[other]!, order[index]!];
      return { ...old, order };
    });
  }
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={`${label} view`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {selected.length ? (
            <>
              <span>{selected.length} selected on this page</span>
              <Button variant="ghost" size="sm" onClick={() => table.resetRowSelection()}>
                Clear selection
              </Button>
            </>
          ) : (
            caption
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Table actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setOpen(true)}>
              <ColumnsIcon />
              Table Options
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!rows.length} onSelect={exportPage}>
              <DownloadIcon />
              {selected.length ? "Export Selected" : "Export Page"}
            </DropdownMenuItem>
            {mobile ? (
              <DropdownMenuItem
                disabled={!rows.length}
                onSelect={() => table.toggleAllRowsSelected(true)}
              >
                Select page
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Table Options</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex min-w-0 max-w-full flex-col gap-4 overflow-x-hidden">
              <p className="text-sm text-muted-foreground">
                Choose visible columns and their order. Your layout is saved on this device.
              </p>
              <FieldGroup className="min-w-0 pr-3">
                <Field orientation="horizontal" className="min-w-0 flex-wrap">
                  <FieldLabel htmlFor="data-view-density">Row spacing</FieldLabel>
                  <NativeSelect
                    className="max-w-40 shrink-0"
                    id="data-view-density"
                    value={view.density}
                    onChange={(event) =>
                      setView((old) => ({
                        ...old,
                        density: event.target.value === "compact" ? "compact" : "comfortable",
                      }))
                    }
                  >
                    <NativeSelectOption value="comfortable">Comfortable</NativeSelectOption>
                    <NativeSelectOption value="compact">Compact</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field orientation="horizontal" className="min-w-0 flex-wrap">
                  <FieldLabel htmlFor="data-view-wrap">Wrap long text</FieldLabel>
                  <Switch
                    id="data-view-wrap"
                    checked={view.wrap}
                    onCheckedChange={(wrap) => setView((old) => ({ ...old, wrap }))}
                  />
                </Field>
              </FieldGroup>
              <Reorder.Group
                as="div"
                axis="y"
                values={view.order}
                layoutScroll
                className="flex max-h-[45dvh] min-w-0 flex-col overflow-x-hidden overflow-y-auto pr-3"
                onReorder={(order) => setView((old) => ({ ...old, order }))}
              >
                {ordered.map((column, index) => (
                  <ColumnOption
                    key={column.id}
                    column={column}
                    index={index}
                    count={ordered.length}
                    visible={!view.hidden.includes(column.id)}
                    onMove={(offset) => move(column.id, offset)}
                    onVisibleChange={(checked) =>
                      setView((old) => ({
                        ...old,
                        hidden: checked
                          ? old.hidden.filter((id) => id !== column.id)
                          : [...old.hidden, column.id],
                      }))
                    }
                  />
                ))}
              </Reorder.Group>
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button variant="secondary" onClick={() => setView(defaults(columns))}>
                Reset Layout
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
      <Card className="settings-panel gap-0 overflow-hidden py-0">
        {mobile ? (
          <div className="flex flex-col">
            {table.getRowModel().rows.map((row) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: Expands the primary button's pointer target; that button remains the keyboard entry point.
              // biome-ignore lint/a11y/useKeyWithClickEvents: The nested primary button provides the same keyboard action without a duplicate tab stop.
              <div
                key={row.id}
                onClick={(event) => {
                  if (isRecordClick(event)) onOpen(row.original);
                }}
                className={cn(
                  "settings-navigation-row flex min-w-0 cursor-pointer items-start gap-3",
                  view.density === "compact" ? "px-3 py-2" : "p-3",
                )}
              >
                <Checkbox
                  className="mt-1"
                  aria-label={`Select ${rowLabel(row.original)}`}
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(value === true)}
                />
                <dl
                  className={cn(
                    "grid min-w-0 flex-1 grid-cols-2",
                    view.density === "compact" ? "gap-x-3 gap-y-1.5" : "gap-3",
                  )}
                >
                  {row
                    .getVisibleCells()
                    .filter(
                      (cell) =>
                        !columns.find((column) => column.id === cell.column.id)?.mobileHidden,
                    )
                    .sort((a, b) => {
                      const left = columns.find((column) => column.id === a.column.id);
                      const right = columns.find((column) => column.id === b.column.id);
                      const rank = (column: DataColumn<T> | undefined) =>
                        column?.primary ? -1 : (column?.mobileOrder ?? Number.MAX_SAFE_INTEGER);
                      return rank(left) - rank(right);
                    })
                    .map((cell) => (
                      <div
                        className={cn(
                          "min-w-0",
                          columns.find((column) => column.id === cell.column.id)?.primary
                            ? "col-span-2"
                            : view.density === "compact" &&
                                "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2",
                        )}
                        key={cell.id}
                      >
                        <dt
                          className={
                            columns.find((c) => c.id === cell.column.id)?.primary
                              ? "sr-only"
                              : "max-w-20 truncate text-sm leading-5 text-muted-foreground"
                          }
                        >
                          {String(cell.column.columnDef.header)}
                        </dt>
                        <dd
                          className={cn(
                            "min-w-0 text-sm leading-5",
                            view.wrap ? "whitespace-pre-wrap break-words" : "truncate",
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <Table
            aria-label={label}
            style={{ width: table.getTotalSize() + 40, minWidth: "100%", tableLayout: "fixed" }}
          >
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={
                      table.getIsAllRowsSelected() && rows.length > 0
                        ? true
                        : table.getIsSomeRowsSelected()
                          ? "indeterminate"
                          : false
                    }
                    disabled={!rows.length}
                    onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
                  />
                </TableHead>
                {table.getHeaderGroups()[0]?.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="relative"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {/* biome-ignore lint/a11y/useSemanticElements: Focusable column-resize widget rather than a thematic break. */}
                    <div
                      role="separator"
                      aria-label={`Resize ${String(header.column.columnDef.header)}`}
                      aria-orientation="vertical"
                      tabIndex={0}
                      aria-valuenow={header.getSize()}
                      aria-valuemin={80}
                      aria-valuemax={600}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                        event.preventDefault();
                        const width = Math.min(
                          600,
                          Math.max(80, header.getSize() + (event.key === "ArrowRight" ? 16 : -16)),
                        );
                        table.setColumnSizing((old) => ({ ...old, [header.id]: width }));
                      }}
                      className="absolute inset-y-0 right-0 w-2 touch-none cursor-col-resize bg-border/40 opacity-0 hover:opacity-100 focus:opacity-100"
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={(event) => {
                    if (isRecordClick(event)) onOpen(row.original);
                  }}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${rowLabel(row.original)}`}
                      checked={row.getIsSelected()}
                      onCheckedChange={(value) => row.toggleSelected(value === true)}
                    />
                  </TableCell>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        view.density === "compact" ? "py-1" : "py-3",
                        view.wrap ? "whitespace-pre-wrap break-words" : "truncate",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}

function ColumnOption<T>({
  column,
  index,
  count,
  visible,
  onMove,
  onVisibleChange,
}: {
  column: DataColumn<T>;
  index: number;
  count: number;
  visible: boolean;
  onMove: (offset: number) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  return (
    <Reorder.Item
      as="div"
      value={column.id}
      dragListener={false}
      dragControls={controls}
      data-dragging={dragging || undefined}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      className="reorder-row relative min-w-0 max-w-full rounded-lg"
    >
      <Item size="xs" className="min-w-0 flex-nowrap py-1">
        <ReorderHandle
          controls={controls}
          label={`Reorder ${column.label}`}
          onMove={onMove}
          canMoveUp={index > 0}
          canMoveDown={index < count - 1}
        />
        <label htmlFor={`column-${column.id}`} className="min-w-0 flex-1 truncate text-sm">
          {column.label}
        </label>
        <Checkbox
          id={`column-${column.id}`}
          checked={visible}
          disabled={column.primary}
          onCheckedChange={(checked) => onVisibleChange(checked === true)}
        />
      </Item>
    </Reorder.Item>
  );
}
