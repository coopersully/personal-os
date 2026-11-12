import type { FinanceOpeningPosition } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { FormSave } from "../../components/forms/form-save";
import { Icon } from "../../components/icons";
import { useTheme } from "../../theme";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

type OpeningAccount = FinanceOpeningPosition["accounts"][number];
export function FinanceOpeningPositionScreen() {
  const { owner } = useFinance();
  const t = useTheme();
  const attention = useFinanceRead(["attention"], (api) => api.getFinanceAttention());
  const month = attention.data?.period;
  const position = useFinanceRead(
    ["opening-position", month],
    (api) => {
      if (!month) throw new Error("Budget month unavailable");
      return api.getFinanceOpeningPosition(month);
    },
    !!month,
  );
  const [selected, setSelected] = useState<{
    account: OpeningAccount;
    position: FinanceOpeningPosition;
  } | null>(null);
  if (selected)
    return (
      <OpeningStatementForm
        key={`${owner}:${selected.account.accountId}`}
        {...selected}
        onDone={() => setSelected(null)}
      />
    );
  return (
    <FinanceScreen title="Starting balances" showTitle={false}>
      <Stack.Screen
        options={{
          gestureEnabled: true,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.back()}
              style={{
                minHeight: 44,
                minWidth: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View style={{ transform: [{ rotate: "180deg" }] }}>
                <Icon name="chevron" color={t.ink} />
              </View>
            </Pressable>
          ),
        }}
      />
      <ReadState query={attention}>
        <ReadState query={position}>
          {position.data ? (
            <>
              <Copy>
                Confirm balances at the start of{" "}
                {new Date(`${position.data.month}-01T12:00:00Z`).toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}{" "}
                from your statements. Today’s balance is not a starting balance.
              </Copy>
              <Card rows>
                {position.data.accounts.map((account) => (
                  <FinanceRow
                    key={account.accountId}
                    title={account.name}
                    icon="wallet"
                    value={
                      account.openingBalanceCents === null
                        ? "Needs evidence"
                        : formatMoney(account.openingBalanceCents / 100, account.currencyCode)
                    }
                    valueTone={account.reasons.length ? "attention" : undefined}
                    subtitle={account.reasons.map(financeLabel).join(" · ")}
                    onPress={
                      account.currencyCode === "USD"
                        ? () => {
                            if (position.data) setSelected({ account, position: position.data });
                          }
                        : undefined
                    }
                  />
                ))}
              </Card>
              {!position.data.accounts.length ? <Copy>No planning accounts available.</Copy> : null}
            </>
          ) : null}
        </ReadState>
      </ReadState>
    </FinanceScreen>
  );
}
function OpeningStatementForm({
  account,
  position,
  onDone,
}: {
  account: OpeningAccount;
  position: FinanceOpeningPosition;
  onDone: () => void;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const existing = position.statements
    .filter((item) => item.accountId === account.accountId && item.month === position.month)
    .sort((a, b) => b.revision - a.revision)[0];
  const [value, setValue] = useState(
    existing ? String(existing.signedOpeningBalanceCents / 100) : "",
  );
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const attempt = useRef<{ value: string; key: string } | null>(null);
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const cents = Math.round(Number(value) * 100);
  const valid =
    /^-?\d+(\.\d{1,2})?$/.test(value.trim()) &&
    Number.isSafeInteger(cents) &&
    Math.abs(cents) <= 10000000000;
  function close() {
    if (!edited || submitted) onDone();
    else
      Alert.alert("Discard statement changes?", "Your unsaved balance will be lost.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onDone },
      ]);
  }
  async function save() {
    if (!edited || !valid || busy.current || submitted) return;
    busy.current = true;
    setPending(true);
    if (attempt.current?.value !== value) attempt.current = { value, key: randomUUID() };
    const feedback = toast.loading("Recording opening statement…");
    try {
      const receipt = await api.confirmFinanceOpeningStatement({
        accountId: account.accountId,
        month: position.month,
        expectedAccountRevision: account.accountRevision,
        expectedStatementRevision: existing?.revision ?? 0,
        signedOpeningBalanceCents: cents,
        idempotencyKey: attempt.current.key,
      });
      if (
        receipt.accountId !== account.accountId ||
        receipt.month !== position.month ||
        receipt.signedOpeningBalanceCents !== cents
      )
        throw new Error("Statement not confirmed");
      if (active.current) {
        setSubmitted(true);
        toast.success("Opening statement recorded", { id: feedback });
        void client.invalidateQueries({ queryKey: ["finances", owner] });
        onDone();
      } else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error(
          "Could not confirm the statement. Your entry is kept; check the current account before retrying.",
          { id: feedback },
        );
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={close}
              style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}
            >
              <Text style={{ color: t.ink }}>{edited && !submitted ? "Cancel" : "Close"}</Text>
            </Pressable>
          ),
        }}
      />
      <FinanceScreen title={account.name}>
        <Copy>
          Balance at the beginning of{" "}
          {new Date(`${position.month}-01T12:00:00Z`).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
          .
        </Copy>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Icon name="wallet" color={t.secondary} />
            <Text style={{ color: t.ink, flex: 1 }}>Opening balance</Text>
            <Text style={{ color: t.ink }}>$</Text>
            <TextInput
              accessibilityLabel="Opening balance in USD"
              value={value}
              onChangeText={(text) => {
                setValue(text);
                setEdited(true);
              }}
              editable={!pending && !submitted}
              keyboardType="numbers-and-punctuation"
              placeholder={account.kind === "debt" ? "-450.00" : "1250.50"}
              placeholderTextColor={t.secondary}
              style={{
                minHeight: 44,
                minWidth: 90,
                maxWidth: "45%",
                textAlign: "right",
                fontSize: 16,
                color: edited && !valid ? t.destructive : t.ink,
              }}
            />
          </View>
        </Card>
        <Copy secondary>
          Use a negative amount for money owed. This records opening evidence; it does not change
          your current account balance.
        </Copy>
      </FinanceScreen>
      <FormSave
        workspace="finances"
        label="Confirm opening balance"
        disabled={!edited || !valid || pending || submitted}
        onPress={() => void save()}
      />
    </View>
  );
}
