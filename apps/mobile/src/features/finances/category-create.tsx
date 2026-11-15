import type { FinanceCategory } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { useFinance } from "./data";
import { confirmedRejection } from "./mutations";
import { FinanceRow } from "./ui";

/**
 * Adds a category beside the picker that needed it. The server finds or creates by name, so
 * repeating an unconfirmed add never duplicates a category.
 */
export function CategoryCreate({
  categories,
  disabled = false,
  onCreated,
}: {
  /** The loaded categories; a name already among them is selected instead of written again. */
  categories: readonly FinanceCategory[];
  disabled?: boolean;
  onCreated: (category: FinanceCategory) => void;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const [name, setName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const trimmed = name?.trim() ?? "";

  async function add() {
    if (!owner || busy.current || !trimmed) return;
    const existing = categories.find(
      (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      toast.info(`“${existing.name}” already exists. It is now selected.`);
      setName(null);
      onCreated(existing);
      return;
    }
    busy.current = true;
    setPending(true);
    const id = toast.loading("Adding category…");
    try {
      const category = await api.createFinanceCategory({ name: trimmed });
      if (active.current !== owner) return void toast.dismiss(id);
      client.setQueryData<FinanceCategory[]>(["finances", owner, "categories"], (rows) =>
        rows && !rows.some((item) => item.id === category.id) ? [...rows, category] : rows,
      );
      void client.invalidateQueries({ queryKey: ["finances", owner, "categories"] });
      toast.success(`Category “${category.name}” added`, { id });
      setName(null);
      onCreated(category);
    } catch (error) {
      if (active.current !== owner) return void toast.dismiss(id);
      toast.error(
        confirmedRejection(error)
          ? "Couldn’t add this category. Check the name and try again."
          : "Couldn’t confirm the category was added. Adding it again will not create a duplicate.",
        { id },
      );
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }

  if (name === null)
    return (
      <FinanceRow
        centered
        title="New category"
        icon="add"
        onPress={disabled ? undefined : () => setName("")}
      />
    );
  return (
    <SettingsAccentProvider workspace="finances">
      <TextInput
        accessibilityLabel="New category name"
        autoFocus
        editable={!pending}
        maxLength={80}
        value={name}
        onChangeText={setName}
        placeholder="Pet care"
        placeholderTextColor={t.secondary}
        returnKeyType="done"
        onSubmitEditing={() => void add()}
        style={{ color: t.ink, fontSize: 17, minHeight: 44, padding: 0 }}
      />
      <Actions inset={false}>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel new category"
          disabled={pending}
          onPress={() => setName(null)}
        />
        <Action
          label="Add"
          accessibilityLabel="Add category"
          disabled={pending || !trimmed}
          onPress={() => void add()}
        />
      </Actions>
    </SettingsAccentProvider>
  );
}
