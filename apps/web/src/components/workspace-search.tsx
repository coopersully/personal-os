import { Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function WorkspaceSearch({
  label,
  placeholder = label,
}: {
  label: string;
  placeholder?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = workspaceSearchFromParams(searchParams);

  const updateSearch = (value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value.trim()) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  };

  return (
    <InputGroup className="workspace-topbar__search">
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        onChange={(event) => updateSearch(event.currentTarget.value)}
        placeholder={placeholder}
        type="search"
        value={search}
      />
    </InputGroup>
  );
}

export function workspaceSearchFromParams(searchParams: URLSearchParams): string {
  return searchParams.get("q") ?? "";
}
