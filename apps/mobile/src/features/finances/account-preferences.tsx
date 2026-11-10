import type { FinanceAccount, UpdateFinanceAccountInput } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { InlineOptions } from "../../components/forms/inline-options";
import { Icon } from "../../components/icons";
import { useTheme, workspaceColor } from "../../theme";
import { useFinance } from "./data";
import { financeLabel } from "./presentation";
import { FinanceRow } from "./ui";

export function AccountPreferences({ account }: { account: FinanceAccount }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const [picker, setPicker] = useState<"ownership" | "planning" | null>(null);
  const [joint, setJoint] = useState(false);
  const [share, setShare] = useState(
    account.ownershipShare ? String(account.ownershipShare * 100) : "",
  );
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);
  const invalid =
    !share.trim() || !Number.isFinite(Number(share)) || Number(share) <= 0 || Number(share) > 100;
  async function save(fields: Partial<UpdateFinanceAccountInput>) {
    if (!owner || busy.current) return;
    const payload = JSON.stringify({ ...fields, expectedUpdatedAt: account.updatedAt });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    busy.current = true;
    setPending(true);
    const id = toast.loading("Updating account…");
    try {
      const result = await api.updateFinanceAccount(account.id, {
        ...fields,
        expectedUpdatedAt: account.updatedAt,
        idempotencyKey: attempt.current.key,
      });
      if (active.current !== owner) {
        toast.dismiss(id);
        return;
      }
      if (result.outcome !== "completed") {
        attempt.current = null;
        if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
        void client.invalidateQueries({ queryKey: ["finances", owner] });
        return;
      }
      attempt.current = null;
      setJoint(false);
      toast.success("Account updated", { id });
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    } catch {
      if (active.current === owner)
        toast.error("Couldn’t confirm the change. Check the account before retrying.", { id });
      else toast.dismiss(id);
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }
  return (
    <>
      <FinanceRow
        centered
        title="Ownership"
        icon="people"
        value={
          account.ownershipType === "joint"
            ? `Joint · ${((account.ownershipShare ?? 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
            : financeLabel(account.ownershipType)
        }
        valueTone={account.ownershipType === "unknown" ? "attention" : undefined}
        accessibilityHint={
          account.ownershipType === "unknown"
            ? "Confirm your ownership so balances can be included accurately."
            : "Edit account ownership"
        }
        onPress={pending ? undefined : () => setPicker(picker === "ownership" ? null : "ownership")}
      />
      {picker === "ownership" && (
        <InlineOptions
          value={account.ownershipType}
          options={[
            { label: "Individual", value: "individual", icon: "people" },
            { label: "Joint", value: "joint", icon: "people" },
          ]}
          onChange={(value) => {
            setPicker(null);
            if (value === "joint") setJoint(true);
            else if (value === "individual" && account.ownershipType !== "individual")
              void save({ ownershipType: "individual", ownershipShare: 1 });
          }}
        />
      )}
      {joint && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ flex: 1, color: t.ink }}>Your share</Text>
          <TextInput
            accessibilityLabel="Ownership percentage"
            value={share}
            onChangeText={setShare}
            editable={!pending}
            placeholder="50"
            keyboardType="decimal-pad"
            style={{
              color: invalid && share ? t.destructive : t.ink,
              minHeight: 44,
              minWidth: 50,
              textAlign: "right",
            }}
          />
          <Text style={{ color: t.ink }}>%</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel ownership change"
            disabled={pending}
            onPress={() => setJoint(false)}
            style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="cancel" color={t.secondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save ownership"
            disabled={pending || invalid}
            onPress={() =>
              void save({ ownershipType: "joint", ownershipShare: Number(share) / 100 })
            }
            style={{
              minHeight: 44,
              minWidth: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pending || invalid ? 0.5 : 1,
            }}
          >
            <Icon name="save" color={workspaceColor(t, "finances")} />
          </Pressable>
        </View>
      )}
      <FinanceRow
        centered
        title="Planning"
        icon="wallet"
        value={account.includeInPlanning ? "Included" : "Excluded"}
        onPress={pending ? undefined : () => setPicker(picker === "planning" ? null : "planning")}
      />
      {picker === "planning" && (
        <InlineOptions
          value={account.includeInPlanning ? "included" : "excluded"}
          options={[
            { label: "Included", value: "included" },
            { label: "Excluded", value: "excluded" },
          ]}
          onChange={(value) => {
            setPicker(null);
            if ((value === "included") !== account.includeInPlanning)
              void save({ includeInPlanning: value === "included" });
          }}
        />
      )}
    </>
  );
}
