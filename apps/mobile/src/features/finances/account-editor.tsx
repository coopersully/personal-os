import { ApiClientError } from "@personal-os/api-client";
import type { FinanceAccount, FinanceAccountKind } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Text, TextInput, type TextInputProps, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import { formRow, PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingLabel } from "../../components/settings-row-content";
import { spacing, useTheme } from "../../theme";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, parseBalance } from "./mutations";
import { Card, Copy, FinanceScreen, ReadState } from "./ui";

const kinds: readonly { value: FinanceAccountKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investments" },
  { value: "debt", label: "Debt" },
  { value: "other", label: "Other" },
];

function TextRow({
  label,
  correction,
  ...input
}: TextInputProps & { label: string; correction?: string }) {
  const t = useTheme();
  return (
    <View>
      <View style={formRow}>
        <SettingLabel style={{ flex: 0, flexShrink: 0 }}>{label}</SettingLabel>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={correction}
          placeholderTextColor={t.secondary}
          {...input}
          style={{
            flex: 1,
            minHeight: 32,
            padding: 0,
            textAlign: "right",
            fontSize: 17,
            color: correction ? t.destructive : t.ink,
          }}
        />
      </View>
      {correction ? (
        // The correction is written out so an invalid field is not signalled by colour alone.
        <Text
          style={{
            color: t.destructive,
            fontSize: 13,
            textAlign: "right",
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          }}
        >
          {correction}
        </Text>
      ) : null}
    </View>
  );
}

function AccountForm({ record, known }: { record: FinanceAccount | null; known: string[] }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  // Keep the reviewed revision with the draft; background refresh never overwrites edits.
  const [snapshot] = useState(record);
  const [knownIds] = useState(known);
  const manual = !snapshot || snapshot.provider === "manual";
  const [name, setName] = useState(snapshot?.name ?? "");
  const [institution, setInstitution] = useState(snapshot?.institution ?? "");
  const [kind, setKind] = useState<FinanceAccountKind>(snapshot?.kind ?? "cash");
  const [currency, setCurrency] = useState("");
  const [balance, setBalance] = useState(snapshot?.balance == null ? "" : String(snapshot.balance));
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const unconfirmed = useRef<{ name: string; institution: string } | null>(null);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentOwner.current === owner;
  const edit = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      set(value);
      setEdited(true);
    };
  };
  const amount = parseBalance(balance);
  const invalidCurrency = !!currency && !/^[A-Z]{3}$/.test(currency);
  const invalidBalance = manual && amount === undefined;
  const invalid =
    !name.trim() || !institution.trim() || invalidBalance || (!snapshot && invalidCurrency);
  const close = () =>
    edited
      ? Alert.alert("Discard changes?", "Unsaved edits will be lost.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ])
      : router.back();
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });

  async function create(id: string | number) {
    const input = {
      balance: amount ?? null,
      currencyCode: currency || null,
      institution: institution.trim(),
      kind,
      name: name.trim(),
      provider: "manual" as const,
    };
    const earlier = unconfirmed.current;
    if (earlier) {
      // Account creation has no retry key: look for the earlier attempt, under the values it
      // was sent with, before writing again. The draft may have been corrected since.
      let recorded: boolean;
      try {
        recorded = (await api.listFinanceAccounts()).accounts.some(
          (item) =>
            !knownIds.includes(item.id) &&
            item.provider === "manual" &&
            item.name === earlier.name &&
            item.institution === earlier.institution,
        );
      } catch {
        if (current())
          toast.error("Couldn’t check whether the account was added. Try again shortly.", { id });
        else toast.dismiss(id);
        return;
      }
      if (!current()) return void toast.dismiss(id);
      if (recorded) {
        await refresh();
        if (!current()) return void toast.dismiss(id);
        if (earlier.name === input.name && earlier.institution === input.institution)
          toast.success("Account added", { id });
        else
          toast.info(
            `Your earlier attempt already added “${earlier.name}”. Edit that account to change it.`,
            { id },
          );
        router.back();
        return;
      }
      unconfirmed.current = null;
    }
    try {
      await api.createFinanceAccount(input);
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      unconfirmed.current = confirmedRejection(error)
        ? null
        : { name: input.name, institution: input.institution };
      toast.error(
        unconfirmed.current
          ? "Couldn’t confirm the account was added. Your draft is still here; saving again checks Accounts first."
          : "Couldn’t add this account. Your draft is still here.",
        { id },
      );
      return;
    }
    await refresh();
    if (!current()) return void toast.dismiss(id);
    toast.success("Account added", { id });
    router.back();
  }

  async function update(account: FinanceAccount, id: string | number) {
    const changes = {
      ...(name.trim() !== account.name ? { name: name.trim() } : {}),
      ...(institution.trim() !== account.institution ? { institution: institution.trim() } : {}),
      ...(kind !== account.kind ? { kind } : {}),
      ...(manual && (amount ?? null) !== account.balance ? { balance: amount ?? null } : {}),
    };
    if (!Object.keys(changes).length) {
      toast.info("No changes to save", { id });
      router.back();
      return;
    }
    const payload = JSON.stringify({ ...changes, expectedUpdatedAt: account.updatedAt });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    try {
      const result = await api.updateFinanceAccount(account.id, {
        ...changes,
        expectedUpdatedAt: account.updatedAt,
        idempotencyKey: attempt.current.key,
      });
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      if (result.outcome !== "completed") {
        if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
        void refresh();
        return;
      }
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success("Account updated", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (confirmedRejection(error)) attempt.current = null;
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "This account changed elsewhere. Close and reopen it to review the latest version; your draft is still here."
          : confirmedRejection(error)
            ? "Couldn’t save this account. Your draft is still here."
            : "Couldn’t confirm the save. Your draft is still here. Check the account before retrying.",
        { id },
      );
      // Rejected or unknown, the cached record may be stale: reopening must show the latest.
      void refresh();
    }
  }

  async function save() {
    if (lock.current || !edited || invalid) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading(snapshot ? "Saving account…" : "Adding account…");
    try {
      await (snapshot ? update(snapshot, id) : create(id));
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          // The page heading below names the screen; the bar carries only dismissal.
          title: "",
          gestureEnabled: false,
          headerBackVisible: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            onPress: close,
            disabled: pending,
          }),
        }}
      />
      <FinanceScreen title={snapshot ? "Edit account" : "Add account"}>
        <Card rows>
          {/* Shared rows pad themselves; let them span the card so every row lines up. */}
          <PaddedSurfaceRows>
            <TextRow
              label="Name"
              value={name}
              onChangeText={edit(setName)}
              editable={!pending}
              maxLength={160}
              placeholder="Required"
            />
            <TextRow
              label="Institution"
              value={institution}
              onChangeText={edit(setInstitution)}
              editable={!pending}
              maxLength={160}
              placeholder="Required"
            />
            <EnumChoice
              label="Account type"
              value={kind}
              disabled={pending}
              options={kinds}
              onChange={(value) => edit(setKind)(value as FinanceAccountKind)}
            />
            {!snapshot && (
              <TextRow
                label="Currency"
                value={currency}
                onChangeText={(value) => edit(setCurrency)(value.toUpperCase())}
                editable={!pending}
                correction={invalidCurrency ? "Use a three-letter code such as USD." : undefined}
                maxLength={3}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Optional"
              />
            )}
            {manual && (
              <TextRow
                label="Balance"
                value={balance}
                onChangeText={edit(setBalance)}
                editable={!pending}
                correction={invalidBalance ? "Enter an amount such as 2400.00." : undefined}
                keyboardType="numbers-and-punctuation"
                placeholder="Optional"
              />
            )}
          </PaddedSurfaceRows>
        </Card>
        <Copy secondary>
          Name and Institution are required.{" "}
          {!snapshot
            ? "A manual account holds a balance you maintain yourself. Leave Balance or Currency blank when unknown."
            : manual
              ? "Leave Balance blank when it is unavailable."
              : "Balances for a connected account come from its institution."}
        </Copy>
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        disabled={!edited || pending || invalid}
        onPress={() => void save()}
      />
    </View>
  );
}

/** Adds a manual account, or edits the identity of the account named by `id`. */
export function FinanceAccountEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const record = id ? query.data?.accounts.find((item) => item.id === id) : null;
  return (
    <ReadState query={query}>
      {record === undefined ? (
        <FinanceScreen title="Account">
          <Copy secondary>This account is unavailable.</Copy>
        </FinanceScreen>
      ) : (
        <AccountForm
          key={id ?? "new"}
          record={record}
          known={query.data?.accounts.map((item) => item.id) ?? []}
        />
      )}
    </ReadState>
  );
}
