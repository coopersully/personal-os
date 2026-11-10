import type { FinanceAccount, UpdateFinanceAccountInput } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Icon } from "../../components/icons";
import { SettingLabel, SettingValue } from "../../components/settings-row-content";
import { useTheme, workspaceColor } from "../../theme";
import { useFinance } from "./data";
import { financeLabel } from "./presentation";

export function AccountPreferences({ account }: { account: FinanceAccount }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const [joint, setJoint] = useState(false);
  const [share, setShare] = useState(
    account.ownershipShare ? String(Number((account.ownershipShare * 100).toFixed(2))) : "",
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
      <EnumChoice
        label="Ownership"
        icon="people"
        value={joint ? "joint" : account.ownershipType}
        valueLabel={
          joint
            ? "Joint"
            : account.ownershipType === "joint"
              ? `Joint · ${((account.ownershipShare ?? 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
              : financeLabel(account.ownershipType)
        }
        valueColor={account.ownershipType === "unknown" ? t.warning : undefined}
        disabled={pending}
        options={[
          { label: "Individual", value: "individual", icon: "people" },
          { label: "Joint", value: "joint", icon: "people" },
        ]}
        onChange={(value) => {
          if (value === "joint") setJoint(true);
          else if (value === "individual") {
            setJoint(false);
            if (account.ownershipType !== "individual")
              void save({ ownershipType: "individual", ownershipShare: 1 });
          }
        }}
      />
      {!joint && account.ownershipType === "joint" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit ownership share"
          disabled={pending}
          onPress={() => {
            setShare(String(Number(((account.ownershipShare ?? 0) * 100).toFixed(2))));
            setJoint(true);
          }}
          style={{
            minHeight: 56,
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Icon name="people" color={t.secondary} size={22} />
          <SettingLabel>Your share</SettingLabel>
          <SettingValue>
            {((account.ownershipShare ?? 0) * 100).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
            %
          </SettingValue>
          <Icon name="chevron" color={t.secondary} size={16} />
        </Pressable>
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
      <EnumChoice
        label="Planning"
        icon="wallet"
        value={account.includeInPlanning ? "included" : "excluded"}
        disabled={pending}
        options={[
          { label: "Included", value: "included" },
          { label: "Excluded", value: "excluded" },
        ]}
        onChange={(value) => {
          if ((value === "included") !== account.includeInPlanning)
            void save({ includeInPlanning: value === "included" });
        }}
      />
    </>
  );
}
