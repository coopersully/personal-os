import type { MailDraft, MailSetupAccount } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams, usePreventRemove } from "expo-router";
import { type ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { toast } from "sonner-native";
import { AppToaster } from "../../components/app-toaster";
import { EditorClose } from "../../components/editor-close";
import { editorActionOptions, editorDismissOptions } from "../../components/editor-header";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { InlineOptions } from "../../components/forms/inline-options";
import { Icon } from "../../components/icons";
import { PageRefreshControl } from "../../components/page-refresh";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Field, Section, TitleField } from "../tasks/ui";
import { Attachments } from "./attachments";
import { type ComposeFields, composePayload, DraftWriter, draftFields } from "./compose-state";
import { messageIntent, type ReplyMode, splitQuotedBody } from "./reply";

export function MailComposerScreen() {
  const {
    id,
    accountId = "",
    threadId,
    messageId,
    mode,
  } = useLocalSearchParams<{
    id?: string;
    accountId?: string;
    threadId?: string;
    messageId?: string;
    mode?: ReplyMode;
  }>();
  const { session, state } = useAuth();
  const setup = useQuery({
    queryKey: ["mail", state.user?.id, "accounts"],
    queryFn: () => session.api().getMailSetupContext(),
  });
  const drafts = useQuery({
    queryKey: ["mail", state.user?.id, "compose-draft", id],
    enabled: !!id,
    gcTime: 0,
    staleTime: 0,
    queryFn: () => session.api().listMailDrafts(),
  });
  const source = useQuery({
    queryKey: ["mail", state.user?.id, "compose-source", threadId, messageId, mode],
    enabled: !!threadId && !id,
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      if (!threadId || !messageId || !["reply", "replyAll", "forward"].includes(mode ?? ""))
        throw new Error("Message not found");
      const api = session.api();
      const [thread, messages] = await Promise.all([
        api.getMailThread(threadId),
        api.listMailMessages(threadId),
      ]);
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error("Message not found");
      return { thread, message };
    },
  });
  const initial = drafts.data?.find((draft) => draft.id === id);
  if (setup.isPending || (id && drafts.isPending) || (threadId && !id && source.isPending))
    return <ActivityIndicator accessibilityLabel="Loading composer" />;
  if (setup.isError || (id && !initial) || (threadId && !id && !source.data))
    return (
      <View style={{ padding: spacing.page }}>
        <EditorClose label="Close" onPress={() => router.back()} />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void setup.refetch();
            if (id) void drafts.refetch();
            if (threadId) void source.refetch();
          }}
        >
          <Text>Reload composer</Text>
        </Pressable>
      </View>
    );
  let seed: ComposeFields | undefined;
  if (!id && source.data && mode) {
    const account = setup.data?.accounts.find((a) => a.accountId === source.data.thread.accountId);
    if (mode !== "forward" && !account?.email)
      return (
        <View>
          <EditorClose label="Close" onPress={() => router.back()} />
          <Text>Reconnect the original account in Settings to reply.</Text>
        </View>
      );
    seed = messageIntent(source.data.thread, source.data.message, account?.email ?? null, mode);
  }
  return (
    <MailComposer
      key={`${state.user?.id}:${id ?? threadId ?? "new"}:${messageId}:${mode}`}
      seed={seed}
      mode={mode}
      initial={initial}
      accountId={accountId}
      accounts={setup.data?.accounts ?? []}
    />
  );
}
function MailComposer({
  seed,
  mode,
  initial,
  accountId,
  accounts,
}: {
  seed?: ComposeFields;
  mode?: ReplyMode;
  initial?: MailDraft;
  accountId: string;
  accounts: MailSetupAccount[];
}) {
  const t = useTheme();
  const offset = useFormKeyboardOffset();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const messageTop = useRef(0);
  const messageFocused = useRef(false);
  useEffect(() => {
    if (offset > 0 && messageFocused.current)
      scroll.current?.scrollTo({ y: messageTop.current, animated: true });
  }, [offset]);
  const { session, state } = useAuth();
  const client = useQueryClient();
  const [writer] = useState(() => new DraftWriter(session.api(), initial));
  const [blocked, setBlocked] = useState(writer.blocked);
  const available = accounts.filter((a) => a.sendCapability === "available");
  const preferred = accounts.find((a) => a.accountId === accountId) ?? available[0] ?? accounts[0];
  const [fields, setFields] = useState(() => seed ?? draftFields(initial, preferred?.accountId));
  const [quote] = useState(() => splitQuotedBody(fields.body).quote);
  const [showQuote, setShowQuote] = useState(false);
  const messageBody =
    quote && fields.body.endsWith(quote) ? fields.body.slice(0, -quote.length) : fields.body;
  const latest = useRef(fields);
  latest.current = fields;
  const [edited, setEdited] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const live = useRef(true);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selected = accounts.find((a) => a.accountId === fields.accountId);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["mail", state.user?.id] }).catch(() => undefined);
  };
  const report = useCallback(
    (error: unknown) => {
      if (live.current) setBlocked(writer.blocked);
      if (live.current)
        toast.error(
          error instanceof Error
            ? error.message
            : "Couldn’t save your draft. Your text is still here.",
        );
    },
    [writer],
  );
  useEffect(() => {
    if (writer.blocked) report(new Error(writer.blocked));
  }, [writer, report]);
  const persist = async () => {
    const snapshot = latest.current;
    const saved = await writer.save(snapshot);
    if (live.current && JSON.stringify(snapshot) === JSON.stringify(latest.current)) {
      setDirty(false);
      const next = { ...snapshot, attachments: saved.attachments ?? [] };
      latest.current = next;
      setFields(next);
    }
    invalidate();
    return saved;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!dirty || working || writer.blocked || !composePayload(fields, writer.draft).success)
      return;
    timer.current = setTimeout(() => {
      void persistRef.current().catch(report);
    }, 650);
    return () => clearTimeout(timer.current);
  }, [fields, dirty, working, writer, report]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (status) => {
      if (status !== "active" && dirty && !busy.current && !writer.blocked) {
        clearTimeout(timer.current);
        void persistRef.current().catch(report);
      }
    });
    return () => listener.remove();
  }, [dirty, writer, report]);
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);
  const change = <K extends keyof ComposeFields>(key: K, value: ComposeFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
    setEdited(true);
    setDirty(true);
  };
  const addAttachments = async () => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    clearTimeout(timer.current);
    try {
      const { pickAttachments } = await import("./attachment-files");
      const existing = latest.current.attachments ?? [];
      const files = await pickAttachments(existing);
      if (live.current && files !== existing) change("attachments", files);
    } catch (error) {
      if (live.current)
        toast.error(error instanceof Error ? error.message : "Couldn’t add attachment.");
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  };
  const saveAndClose = async () => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    clearTimeout(timer.current);
    const id = toast.loading("Saving draft…");
    try {
      await persist();
      if (live.current) {
        toast.success("Draft saved", { id });
        setLeaving(true);
      }
    } catch (error) {
      toast.dismiss(id);
      report(error);
    } finally {
      if (!live.current) toast.dismiss(id);
      busy.current = false;
      if (live.current) setWorking(false);
    }
  };
  const close = () => {
    if (busy.current) return;
    if (writer.blocked && dirty) {
      Alert.alert(
        "Close this local copy?",
        "Your latest edits may not be saved. Check Drafts and Sent before retrying. Closing does not delete saved mail.",
        [
          { text: "Keep writing", style: "cancel" },
          { text: "Close local copy", style: "destructive", onPress: () => setLeaving(true) },
        ],
      );
      return;
    }
    if (!dirty) {
      setLeaving(true);
      return;
    }
    if (Platform.OS === "web") {
      if (globalThis.confirm("Save your draft and close?")) void saveAndClose();
    } else
      Alert.alert(
        "Save draft and close?",
        "Keep your message in Drafts so you can finish it later.",
        [
          { text: "Keep writing", style: "cancel" },
          { text: "Save draft", onPress: () => void saveAndClose() },
        ],
      );
  };
  usePreventRemove(!leaving && (dirty || working), close);
  const review = async () => {
    if (busy.current || writer.blocked) return;
    const payload = composePayload(latest.current, writer.draft);
    if (!payload.success || !payload.data.to.length) {
      toast.error("Enter valid recipient email addresses before sending.");
      return;
    }
    busy.current = true;
    setWorking(true);
    clearTimeout(timer.current);
    const unlock = () => {
      busy.current = false;
      if (live.current) setWorking(false);
    };
    try {
      const saved = await persist();
      if (!live.current) {
        unlock();
        return;
      }
      const send = async () => {
        const id = toast.loading("Sending…");
        try {
          await writer.send(saved);
          if (live.current) {
            toast.success("Message sent", { id });
            setLeaving(true);
          }
        } catch (error) {
          toast.dismiss(id);
          report(error);
        } finally {
          if (!live.current) toast.dismiss(id);
          invalidate();
          unlock();
        }
      };
      const detail = `From ${selected?.email ?? selected?.label}\nTo ${saved.to.map((r) => r.address).join(", ")}${saved.cc.length ? `\nCc ${saved.cc.map((r) => r.address).join(", ")}` : ""}\n${saved.subject || "(No subject)"}`;
      if (Platform.OS === "web") {
        if (globalThis.confirm(`Send this message?\n${detail}`)) void send();
        else unlock();
      } else
        Alert.alert(
          "Send this message?",
          detail,
          [
            { text: "Keep editing", style: "cancel", onPress: unlock },
            { text: "Send", onPress: () => void send() },
          ],
          { cancelable: false },
        );
    } catch (error) {
      report(error);
      unlock();
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <Stack.Screen
        options={{
          title: initial
            ? "Draft"
            : mode === "reply"
              ? "Reply"
              : mode === "replyAll"
                ? "Reply all"
                : mode === "forward"
                  ? "Forward"
                  : "New message",
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited && dirty ? "Cancel" : "Close",
            disabled: working,
            onPress: close,
          }),
          ...editorActionOptions({
            id: "send",
            label: "Review and send",
            icon: "send",
            disabled:
              working ||
              !!writer.blocked ||
              selected?.sendCapability !== "available" ||
              !fields.to.trim(),
            onPress: () => void review(),
          }),
        }}
      />
      <ScrollView
        ref={scroll}
        alwaysBounceVertical
        refreshControl={<PageRefreshControl scope={["mail"]} />}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        style={{ marginBottom: offset > 0 ? offset + 96 : 0 }}
        contentContainerStyle={{ padding: spacing.page, paddingBottom: 112 }}
      >
        <Section>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`From, ${selected?.email ?? selected?.label ?? "Choose account"}`}
              accessibilityState={{ expanded, disabled: working || !!blocked || !!fields.threadId }}
              disabled={working || !!blocked || !!fields.threadId}
              onPress={() => {
                if (!fields.threadId) setExpanded(!expanded);
              }}
              style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md }}
            >
              <Icon name="profile" color={t.secondary} />
              <Text style={{ color: t.ink, fontSize: 17 }}>From</Text>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  textAlign: "right",
                  color: selected?.sendCapability === "available" ? t.ink : t.warning,
                  fontSize: 17,
                }}
              >
                {selected?.email ?? selected?.label ?? "Choose account"}
              </Text>
              {!fields.threadId && <Icon name="chevron" size={16} color={t.secondary} />}
            </Pressable>
            {expanded && (
              <InlineOptions
                value={fields.accountId}
                options={accounts.map((a) => ({
                  value: a.accountId,
                  label: a.email ?? a.label,
                  icon: "profile",
                }))}
                onChange={(value) => {
                  change("accountId", value);
                  setExpanded(false);
                }}
              />
            )}
            {selected?.sendCapability !== "available" && (
              <Text style={{ color: t.secondary, paddingBottom: spacing.md }}>
                {selected
                  ? "Reconnect in Settings to send. You can still save drafts."
                  : "Connect an account in Settings."}
              </Text>
            )}
          </View>
          <Field
            label="To"
            value={fields.to}
            editable={!working && !blocked}
            onChangeText={(value) => change("to", value)}
            placeholder="e.g. sam@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Field
            label="Cc"
            value={fields.cc}
            editable={!working && !blocked}
            onChangeText={(value) => change("cc", value)}
            placeholder="e.g. alex@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </Section>
        <View
          onLayout={(event) => {
            messageTop.current = event.nativeEvent.layout.y;
          }}
        >
          <View>
            <TitleField
              style={{ fontSize: 18, minHeight: 44 }}
              label="Subject"
              placeholder="Lunch on Friday"
              value={fields.subject}
              maxLength={998}
              editable={!working && !blocked}
              onChangeText={(value) => change("subject", value)}
            />
            <Field
              label="Message"
              onFocus={() => {
                messageFocused.current = true;
                if (offset > 0) scroll.current?.scrollTo({ y: messageTop.current, animated: true });
              }}
              onBlur={() => {
                messageFocused.current = false;
              }}
              compact={false}
              placeholder="Hi Sam, are you free for lunch on Friday at noon?"
              value={messageBody}
              onChangeText={(value) => change("body", value + quote)}
              editable={!working && !blocked}
              multiline
              scrollEnabled={false}
              maxLength={Math.max(0, 100000 - quote.length)}
              style={{ minHeight: 160 }}
            />
          </View>
        </View>
        {!!quote && (
          <Section>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quoted message"
              accessibilityState={{ expanded: showQuote }}
              onPress={() => setShowQuote(!showQuote)}
              style={{
                minHeight: 52,
                paddingHorizontal: spacing.lg,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <Icon name="mail" color={t.secondary} />
              <Text style={{ flex: 1, color: t.secondary, fontSize: 16 }}>Quoted message</Text>
              <Text style={{ color: t.information }}>{showQuote ? "Hide" : "Show"}</Text>
            </Pressable>
            {showQuote && (
              <Text
                selectable
                style={{ padding: spacing.lg, color: t.secondary, fontSize: 15, lineHeight: 22 }}
              >
                {quote.trimStart()}
              </Text>
            )}
          </Section>
        )}
        <Section>
          <Attachments
            files={fields.attachments ?? []}
            disabled={working || !!blocked}
            remove={(id) =>
              change(
                "attachments",
                (fields.attachments ?? []).filter((file) => file.id !== id),
              )
            }
            load={async (file) => {
              if (file.data !== undefined) return { ...file, data: file.data };
              const api = session.api();
              if (file.source)
                return api.downloadMailAttachment(file.source.messageId, file.source.attachmentId);
              if (!writer.draft) throw new Error("Save this draft before opening its attachments.");
              return api.downloadMailDraftAttachment(writer.draft.id, file.id);
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add attachments"
            disabled={working || !!blocked}
            onPress={() => void addAttachments()}
            style={{
              minHeight: 52,
              paddingHorizontal: spacing.lg,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              opacity: working || blocked ? 0.5 : 1,
            }}
          >
            <Icon name="add" color={t.ink} />
            <Text style={{ color: t.ink, fontSize: 17 }}>Add attachments</Text>
            <Text style={{ color: t.secondary, marginLeft: "auto", fontSize: 13 }}>
              10 MB total
            </Text>
          </Pressable>
        </Section>
      </ScrollView>
      <FormSave
        workspace="mail"
        keyboardOffset={offset}
        disabled={!edited || working || !!writer.blocked || !fields.accountId}
        onPress={() => void saveAndClose()}
      />
      <AppToaster editor />
    </View>
  );
}
