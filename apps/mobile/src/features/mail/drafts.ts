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

/** Writes this person's marks to the device. A storage fault leaves the in-memory marks. */
async function storeMarks(owner: string) {
  const ids = [...unconfirmedSends]
    .filter((key) => key.startsWith(`${owner}:`))
    .map((key) => key.slice(owner.length + 1));
  try {
    const store = await storage();
    if (ids.length) await store.setItemAsync(storeKey(owner), JSON.stringify(ids));
    else await store.deleteItemAsync(storeKey(owner));
  } catch {
    // The lock still holds for as long as the app runs.
  }
}

/**
 * True once this person's stored marks are back in memory. Drafts are not opened before then,
 * so a draft marked before a restart opens locked.
 */
export function useUnconfirmedSendsRestored() {
  const { owner } = useMail();
  const [ready, setReady] = useState(() => !!owner && restored.has(owner));
  useEffect(() => {
    if (!owner) return;
    if (restored.has(owner)) return setReady(true);
    let live = true;
    void storage()
      .then((store) => store.getItemAsync(storeKey(owner)))
      .then((stored) => {
        const ids: unknown = stored ? JSON.parse(stored) : [];
        if (Array.isArray(ids))
          for (const id of ids)
            if (typeof id === "string") unconfirmedSends.add(sendKey(owner, id));
      })
      // Unreadable marks cannot be recovered; the API's own draft state still applies.
      .catch(() => undefined)
      .then(() => {
        restored.add(owner);
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [owner]);
  return ready;
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
     * the drafts first. A create is recognised only in a draft that did not exist before it and
     * still holds exactly this text; no other draft is ever taken over or written to.
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
            if (landed && sameDraft(landed, input)) {
              done("Draft saved");
              return { ok: true, draft: landed };
            }
            // An update continues from its own draft's record. A create has no identity to
            // recognise its draft by, so text that has since changed is saved as a new draft:
            // a draft that only looks like the interrupted one is never written over.
            if (draft) target = landed ?? target;
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
        if (owner) {
          unconfirmedSends.add(sendKey(owner, draft.id));
          await storeMarks(owner);
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
