import type { ApiClientError } from "@personal-os/api-client";
import type { CreateMailDraftInput, MailDraft } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { useMail } from "./data";
import { draftStage, sameDraft, sendNotAccepted } from "./draft-logic";
import { mailWriteRejected } from "./logic";

/**
 * nohmi's drafts, including ones an agent prepared. They carry message text, so they are held
 * only while a screen shows them: no cache time, like an open conversation.
 */
export function useMailDrafts() {
  const { api, owner } = useMail();
  return useQuery({
    queryKey: ["mail", owner, "drafts"],
    meta: { scopedReadFeedback: true },
    enabled: !!owner,
    queryFn: () => api.listMailDrafts(),
    gcTime: 0,
    staleTime: 0,
  });
}

/**
 * A save the API never confirmed: what was sent, and for a create the drafts that already
 * existed, so only a draft that appeared afterwards can be taken for the one it made.
 */
export type UnconfirmedSave = { input: CreateMailDraftInput; known: readonly string[] };

export type SaveResult =
  | { ok: true; draft: MailDraft }
  /** `unconfirmed` is kept so the next save looks for that write before writing again. */
  | { ok: false; unconfirmed?: UnconfirmedSave };

/**
 * Drafts with a send this device started and has not seen settled. A draft is marked before
 * its send leaves and unmarked only by a confirmed outcome or a successful check, and the marks
 * are stored on the device, so neither reopening the draft nor restarting the app can skip the
 * check that makes another send safe. Only draft ids are stored, never message text.
 */
const unconfirmedSends = new Set<string>();
const restored = new Set<string>();
const sendKey = (owner: string | undefined, draftId: string) => `${owner}:${draftId}`;
const storeKey = (owner: string) =>
  `personal-os.mail.unconfirmed-sends.v1.${owner.replace(/[^A-Za-z0-9._-]/g, "_")}`;

/** Loaded on first use, so screens that only read a conversation never load device storage. */
const storage = () => import("expo-secure-store");

/** Whether this person's draft still has a send this device could not confirm. */
export function sendUnconfirmed(owner: string | undefined, draftId: string) {
  return unconfirmedSends.has(sendKey(owner, draftId));
}

/** Puts this person's stored marks back in memory; false when they could not be read. */
async function restoreMarks(owner: string) {
  if (restored.has(owner)) return true;
  try {
    const stored = await (await storage()).getItemAsync(storeKey(owner));
    const ids: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return false;
    for (const id of ids) unconfirmedSends.add(sendKey(owner, id));
    restored.add(owner);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes this person's marks to the device; false when the device could not store them. The
 * stored marks are read back first, so a write never replaces marks this run has not seen.
 */
async function storeMarks(owner: string) {
  if (!(await restoreMarks(owner))) return false;
  const ids = [...unconfirmedSends]
    .filter((key) => key.startsWith(`${owner}:`))
    .map((key) => key.slice(owner.length + 1));
  try {
    const store = await storage();
    if (ids.length) await store.setItemAsync(storeKey(owner), JSON.stringify(ids));
    else await store.deleteItemAsync(storeKey(owner));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this person's stored marks are back in memory. Drafts are not opened before they
 * are, so a draft marked before a restart opens locked; marks that cannot be read keep drafts
 * closed until `retry` reads them.
 */
export function useUnconfirmedSendsRestored() {
  const { owner } = useMail();
  const [state, setState] = useState<"pending" | "ready" | "failed">(() =>
    owner && restored.has(owner) ? "ready" : "pending",
  );
  const live = useRef(true);
  const read = async () => {
    if (!owner) return false;
    const ok = await restoreMarks(owner);
    if (live.current) setState(ok ? "ready" : "failed");
    return ok;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per signed-in person.
  useEffect(() => {
    live.current = true;
    void read();
    return () => {
      live.current = false;
    };
  }, [owner]);
  return { state, retry: read };
}

/** For tests: forget what is in memory, as a restart does. Stored marks are kept. */
export function forgetUnconfirmedSends() {
  unconfirmedSends.clear();
  restored.clear();
}

/**
 * What a send came to. Anything but `sent` and `unsent` means delivery is not known: the
 * composer locks, and nothing is sent again until the person has checked.
 */
export type SendResult =
  | { state: "sent" }
  | { state: "unsent"; draft: MailDraft }
  | { state: "unknown"; draft?: MailDraft };

const status = (error: unknown) => (error as ApiClientError | undefined)?.status;

const UNCONFIRMED_SEND =
  "Couldn’t confirm whether this message was sent. Check Sent mail before sending again.";

/**
 * Draft and send writes for one composer. One write runs at a time, every outcome is reported
 * through one toast, and a send is only ever called `sent` when the API says so. A send is never
 * repeated here: after any failure the draft is read again and its recorded state decides.
 */
export function useDraftWrites() {
  const { api, owner } = useMail();
  const { session } = useAuth();
  const client = useQueryClient();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  /** Runs one write at a time; a second tap while one is in flight does nothing. */
  async function run<T>(
    loading: string,
    work: (report: {
      done: (message: string) => void;
      failed: (message: string) => void;
    }) => Promise<T>,
  ): Promise<T | undefined> {
    if (!owner || busy.current) return undefined;
    busy.current = true;
    setPending(true);
    // The session that asked: an outcome that settles after sign-out reports to no one.
    const epoch = session.epoch();
    const current = () => session.epoch() === epoch;
    const id = toast.loading(loading);
    let reported = false;
    const report = (kind: "success" | "error") => (message: string) => {
      reported = true;
      if (current()) toast[kind](message, { id });
    };
    try {
      return await work({ done: report("success"), failed: report("error") });
    } finally {
      if (!reported || !current()) toast.dismiss(id);
      busy.current = false;
      setPending(false);
      if (current()) {
        void client.invalidateQueries({ queryKey: ["mail", owner, "drafts"] });
      }
    }
  }

  /** Lifts a draft's mark once a result settles what happened; an unknown result keeps it. */
  const track =
    (draft: MailDraft) =>
    (result: SendResult | undefined): SendResult | undefined => {
      if (owner && result && result.state !== "unknown") {
        unconfirmedSends.delete(sendKey(owner, draft.id));
        void storeMarks(owner);
      }
      return result;
    };
  const find = async (id: string) => (await api.listMailDrafts()).find((draft) => draft.id === id);

  return {
    pending,

    /**
     * Saves the form. A write the API never confirmed may have landed, so the next save reads
     * the drafts first. An interrupted create is never adopted, because nothing identifies the
     * draft it made: this composer only ever writes to a draft the API handed it.
     */
    save(
      input: CreateMailDraftInput,
      draft: MailDraft | null,
      unconfirmed?: UnconfirmedSave,
    ): Promise<SaveResult | undefined> {
      return run("Saving draft…", async ({ done, failed }): Promise<SaveResult> => {
        let target = draft;
        let known = unconfirmed?.known ?? [];
        if (unconfirmed || !draft) {
          let drafts: MailDraft[];
          try {
            drafts = await api.listMailDrafts();
          } catch {
            failed("Couldn’t check your drafts, so nothing was saved. Try again.");
            return { ok: false, ...(unconfirmed ? { unconfirmed } : {}) };
          }
          if (unconfirmed) {
            // The earlier write may have landed: its record decides what this save starts from.
            const landed = drafts.find(
              (found) =>
                (draft ? found.id === draft.id : !known.includes(found.id)) &&
                draftStage(found) === "editable" &&
                sameDraft(found, unconfirmed.input),
            );
            if (draft) {
              // An update continues from its own draft's record.
              if (landed && sameDraft(landed, input)) {
                done("Draft saved");
                return { ok: true, draft: landed };
              }
              target = landed ?? target;
            } else if (landed && sameDraft(landed, input)) {
              // A create has no identity to recognise its draft by. A new draft with this text
              // may be the interrupted one or someone else's, so it is neither adopted nor
              // copied: the person opens it from Drafts, where its record is its identity.
              failed("A draft with this text is already in Drafts. Open it there to continue.");
              return { ok: false, unconfirmed };
            }
            // Text that has since changed is saved as a new draft below.
          } else known = drafts.map((found) => found.id);
        }
        try {
          const saved = target
            ? await api.updateMailDraft(target.id, {
                ...input,
                expectedUpdatedAt: target.updatedAt,
              })
            : await api.createMailDraft(input);
          done("Draft saved");
          return { ok: true, draft: saved };
        } catch (error) {
          if (!target) {
            if (mailWriteRejected(error)) {
              failed("Couldn’t save the draft. Check the recipients and try again.");
              return { ok: false };
            }
            failed("Couldn’t confirm the draft was saved. Try again; nohmi checks first.");
            return { ok: false, unconfirmed: { input, known } };
          }
          // The save may have landed, or the draft may have moved on: its record decides.
          const found = await find(target.id).catch(() => null);
          if (found && draftStage(found) === "editable" && sameDraft(found, input)) {
            done("Draft saved");
            return { ok: true, draft: found };
          }
          const rejected = mailWriteRejected(error);
          failed(
            found === undefined
              ? "This draft is no longer available."
              : rejected && status(error) === 409
                ? "This draft changed somewhere else. Close it and open it again to continue."
                : rejected
                  ? "Couldn’t save the draft. Check the recipients and try again."
                  : "Couldn’t confirm the draft was saved. Try again.",
          );
          // Neither confirmed nor read back: the next save looks for it before writing again.
          return found === null && !rejected
            ? { ok: false, unconfirmed: { input, known: [] } }
            : { ok: false };
        }
      });
    },

    /** Deletes an unsent draft. Returns true only when the API confirms it is gone. */
    discard(draft: MailDraft) {
      return run("Discarding draft…", async ({ done, failed }) => {
        try {
          await api.deleteMailDraft(draft.id);
          done("Draft discarded");
          return true;
        } catch (error) {
          failed(
            mailWriteRejected(error)
              ? "This draft can no longer be discarded."
              : "Couldn’t confirm the draft was discarded. Check Drafts before trying again.",
          );
          return false;
        }
      });
    },

    /**
     * Sends the draft the person just reviewed, at the revision they reviewed. The API claims
     * the draft before it reaches the provider, so a repeat cannot send it twice; this still
     * never repeats on its own.
     */
    send(draft: MailDraft): Promise<SendResult | undefined> {
      return run("Sending message…", async ({ done, failed }): Promise<SendResult> => {
        // Marked and stored before the request leaves, so even an app that is closed mid-send
        // comes back with this draft locked.
        // Without the stored mark a restart could lift the lock, so nothing is sent.
        if (owner) {
          const key = sendKey(owner, draft.id);
          const marked = unconfirmedSends.has(key);
          unconfirmedSends.add(key);
          if (!(await storeMarks(owner))) {
            if (!marked) unconfirmedSends.delete(key);
            failed("Couldn’t prepare this iPhone to send safely, so nothing was sent. Try again.");
            return { state: "unsent", draft };
          }
        }
        let fault: unknown;
        try {
          await api.sendMailDraft({ draftId: draft.id, confirmedUpdatedAt: draft.updatedAt });
          done("Message sent");
          void client.invalidateQueries({ queryKey: ["mail", owner, "summaries"] });
          return { state: "sent" };
        } catch (error) {
          fault = error;
        }
        let found: MailDraft | undefined;
        try {
          found = await find(draft.id);
        } catch {
          failed(UNCONFIRMED_SEND);
          return { state: "unknown" };
        }
        const stage = found ? draftStage(found) : "missing";
        if (found && stage === "sent") {
          done("Message sent");
          return { state: "sent" };
        }
        // Only a refusal the API vouches for proves nothing left; an unsent record alone does
        // not, because a request that timed out here may still be on its way to the provider.
        const refused = mailWriteRejected(fault) || sendNotAccepted(fault);
        if (found && stage === "editable" && refused) {
          failed(
            status(fault) === 409
              ? "This draft changed after you reviewed it. Review it again before sending."
              : "Couldn’t send the message. It was not sent, and your draft is saved.",
          );
          return { state: "unsent", draft: found };
        }
        failed(UNCONFIRMED_SEND);
        return { state: "unknown", ...(found ? { draft: found } : {}) };
      }).then(track(draft));
    },

    /** Reads the draft's recorded state again after an unconfirmed send. Sends nothing. */
    check(draft: MailDraft): Promise<SendResult | undefined> {
      return run("Checking this message…", async ({ done, failed }): Promise<SendResult> => {
        let found: MailDraft | undefined;
        try {
          found = await find(draft.id);
        } catch {
          failed("Couldn’t check this message. Try again.");
          return { state: "unknown" };
        }
        if (!found) {
          failed("This draft is no longer available. Check Sent mail to see whether it was sent.");
          return { state: "unknown" };
        }
        const stage = draftStage(found);
        if (stage === "sent") {
          done("Message sent");
          return { state: "sent" };
        }
        if (stage === "editable") {
          // A request that timed out here may still arrive. Saving the draft again moves its
          // revision on, so the API refuses that late send instead of sending after this.
          try {
            const retired = await api.updateMailDraft(found.id, {
              accountId: found.accountId,
              to: found.to,
              cc: found.cc,
              subject: found.subject,
              body: found.body,
              threadId: found.threadId,
              expectedUpdatedAt: found.updatedAt,
            });
            done("This message is recorded as not sent. Review it before sending.");
            return { state: "unsent", draft: retired };
          } catch {
            failed("Couldn’t confirm this message is safe to send again. Check again.");
            return { state: "unknown", draft: found };
          }
        }
        failed(
          stage === "sending"
            ? "This message is still being sent. Check again in a moment."
            : "Delivery is still unconfirmed. Check Sent mail, then record what happened.",
        );
        return { state: "unknown", draft: found };
      }).then(track(draft));
    },

    /** Records what the person found in Sent mail for a send the API could not confirm. */
    reconcile(draft: MailDraft, outcome: "sent" | "not_sent"): Promise<SendResult | undefined> {
      return run("Recording…", async ({ done, failed }): Promise<SendResult> => {
        try {
          const saved = await api.reconcileMailDraft(draft.id, { outcome });
          done(outcome === "sent" ? "Recorded as sent" : "Recorded as not sent");
          return outcome === "sent" ? { state: "sent" } : { state: "unsent", draft: saved };
        } catch (error) {
          failed(
            mailWriteRejected(error)
              ? "Couldn’t record that for this draft. Check it again."
              : "Couldn’t confirm that was recorded. Check this message again.",
          );
          return { state: "unknown", draft };
        }
      }).then(track(draft));
    },
  };
}
