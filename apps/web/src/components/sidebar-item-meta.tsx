import { SidebarMenuBadge } from "@/components/ui/sidebar";

const exactCount = new Intl.NumberFormat("en-US");
const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatSidebarCount(count: number) {
  return count < 1000 ? exactCount.format(count) : compactCount.format(count).toLowerCase();
}

/** A sibling of SidebarMenuButton; reserve its width with sidebar-item-with-meta. */
export function SidebarItemMeta({
  attention = false,
  count,
  label,
  inline = false,
}: {
  attention?: boolean;
  count?: number | undefined;
  label: string;
  inline?: boolean;
}) {
  const knownCount = count !== undefined && Number.isFinite(count) && count >= 0;
  if (!attention && !knownCount) return null;
  const description = [
    attention ? "Action required" : null,
    knownCount ? exactCount.format(count) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const Container = inline ? "span" : SidebarMenuBadge;
  return (
    <Container
      role="group"
      className="sidebar-item-meta"
      aria-label={`${label}: ${description}`}
      title={description}
    >
      {attention ? (
        <span
          role="status"
          aria-label={`${label}: Action required`}
          className="sidebar-item-meta__dot"
        />
      ) : null}
      {knownCount ? <span aria-hidden="true">{formatSidebarCount(count)}</span> : null}
    </Container>
  );
}
