import type {
  MailDispositionKind,
  MailObligationKind,
  MailObligationState,
  MailResponseBrief,
  MailStewardshipFeedbackKind,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangleIcon, ShieldCheckIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";

const dispositions: MailDispositionKind[] = [
  "active",
  "deferred",
  "waiting",
  "delegated",
  "reference",
  "noise",
  "resolved",
];
const obligationKinds: MailObligationKind[] = [
  "reply",
  "follow_up",
  "decide",
  "schedule",
  "record",
  "security_review",
];
const obligationStates: MailObligationState[] = [
  "open",
  "waiting",
  "deferred",
  "resolved",
  "dismissed",
];

export function ThreadStewardship({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["mail-thread-stewardship", threadId] as const;
  const stewardship = useQuery({ queryFn: () => api.getMailThreadStewardship(threadId), queryKey });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["mail-stewardship-status"] }),
    ]);
  };
  const disposition = useMutation({
    mutationFn: ({ rationale, value }: { rationale: string; value: MailDispositionKind }) =>
      api.setMailDisposition(threadId, {
        disposition: value,
        expectedThreadUpdatedAt: stewardship.data?.threadUpdatedAt as string,
        rationale,
      }),
    onError: refresh,
    onSuccess: refresh,
  });
  const createObligation = useMutation({
    mutationFn: ({ kind, rationale }: { kind: MailObligationKind; rationale: string }) =>
      api.createMailObligation(threadId, {
        dueAt: null,
        goalIds: [],
        kind,
        nextReviewAt: null,
        owner: { kind: "user" },
        rationale,
        sourceMessageId: null,
        sourceThreadRevision: stewardship.data?.threadUpdatedAt as string,
      }),
    onError: refresh,
    onSuccess: refresh,
  });
  const updateObligation = useMutation({
    mutationFn: ({
      id,
      state,
      version,
    }: {
      id: string;
      state: MailObligationState;
      version: number;
    }) => api.updateMailObligation(id, { expectedVersion: version, state }),
    onError: refresh,
    onSuccess: refresh,
  });
  const answer = useMutation({
    mutationFn: ({
      answer: value,
      generalize,
      id,
      version,
    }: {
      answer: string;
      generalize: boolean;
      id: string;
      version: number;
    }) => api.answerMailQuestion(id, { answer: value, expectedVersion: version, generalize }),
    onError: refresh,
    onSuccess: refresh,
  });
  const feedback = useMutation({
    mutationFn: ({
      comment,
      kind,
      targetId,
      targetType,
    }: {
      comment: string;
      kind: MailStewardshipFeedbackKind;
      targetId: string;
      targetType: "obligation" | "disposition" | "question";
    }) => api.createMailStewardshipFeedback({ comment, kind, targetId, targetType }),
    onSuccess: refresh,
  });
  const brief = useMutation({
    mutationFn: (purpose: string) =>
      api.previewMailResponseBrief(threadId, {
        expectedThreadUpdatedAt: stewardship.data?.threadUpdatedAt as string,
        factsToAddress: [],
        materialsNeeded: [],
        openQuestions: [],
        purpose,
        toneConsiderations: [],
      }),
    onError: refresh,
  });

  if (stewardship.isPending)
    return <Skeleton aria-label="Loading thread stewardship" className="m-6 h-48" />;
  if (stewardship.isError)
    return (
      <Alert className="m-6" variant="destructive">
        <AlertTriangleIcon aria-hidden="true" />
        <AlertTitle>Thread stewardship is unavailable</AlertTitle>
        <AlertDescription>{errorMessage(stewardship.error)}</AlertDescription>
      </Alert>
    );
  return (
    <div className="mail-thread-stewardship">
      <header>
        <p className="eyebrow">Persistent stewardship</p>
        <h3>Thread ledger</h3>
        <p>Private guidance and exact, version-checked controls. Ilo never sends email.</p>
      </header>
      {disposition.isError ||
      createObligation.isError ||
      updateObligation.isError ||
      answer.isError ||
      brief.isError ? (
        <Alert variant="warning">
          <AlertTriangleIcon aria-hidden="true" />
          <AlertTitle>Evidence changed or the operation could not apply</AlertTitle>
          <AlertDescription>
            The latest thread evidence has been requested. Review it before retrying.
          </AlertDescription>
        </Alert>
      ) : null}
      <DispositionControl
        current={stewardship.data.disposition?.disposition ?? null}
        pending={disposition.isPending}
        save={(value, rationale) => disposition.mutate({ rationale, value })}
      />
      <ObligationControl
        create={(kind, rationale) => createObligation.mutate({ kind, rationale })}
        obligations={stewardship.data.obligations}
        pending={createObligation.isPending || updateObligation.isPending}
        setState={(id, version, state) => updateObligation.mutate({ id, state, version })}
      />
      <QuestionControl
        answer={(id, version, value, generalize) =>
          answer.mutate({ answer: value, generalize, id, version })
        }
        pending={answer.isPending}
        questions={stewardship.data.questions}
      />
      <ResponseBriefControl
        brief={brief.data ?? null}
        pending={brief.isPending}
        preview={(purpose) => brief.mutate(purpose)}
      />
      <Card size="sm">
        <CardHeader>
          <CardTitle>Calendar commitment evidence</CardTitle>
          <CardDescription>
            Open Calendar’s preview surface to evaluate evidence. No event is created automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link to="/calendar/review">Open Calendar review</Link>
          </Button>
        </CardContent>
      </Card>
      <FeedbackControl
        currentDispositionId={stewardship.data.disposition?.id ?? null}
        pending={feedback.isPending}
        submit={(targetId, kind, comment) =>
          feedback.mutate({ comment, kind, targetId, targetType: "disposition" })
        }
      />
    </div>
  );
}

function DispositionControl({
  current,
  pending,
  save,
}: {
  current: MailDispositionKind | null;
  pending: boolean;
  save: (value: MailDispositionKind, rationale: string) => void;
}) {
  const [value, setValue] = useState<MailDispositionKind>(current ?? "active");
  const [rationale, setRationale] = useState("User confirmed this thread disposition.");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Disposition</CardTitle>
        <CardDescription>How this conversation belongs in the durable workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="mail-stewardship-form"
          onSubmit={(event) => {
            event.preventDefault();
            save(value, rationale);
          }}
        >
          <label>
            Disposition
            <select
              onChange={(event) => setValue(event.currentTarget.value as MailDispositionKind)}
              value={value}
            >
              {dispositions.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="mail-disposition-rationale">
            Rationale
            <Input
              id="mail-disposition-rationale"
              onChange={(event) => setRationale(event.currentTarget.value)}
              value={rationale}
            />
          </label>
          <Button disabled={pending} size="sm" type="submit">
            Save disposition
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ObligationControl({
  create,
  obligations,
  pending,
  setState,
}: {
  create: (kind: MailObligationKind, rationale: string) => void;
  obligations: Awaited<ReturnType<typeof api.getMailThreadStewardship>>["obligations"];
  pending: boolean;
  setState: (id: string, version: number, state: MailObligationState) => void;
}) {
  const [kind, setKind] = useState<MailObligationKind>("follow_up");
  const [rationale, setRationale] = useState("");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Obligations</CardTitle>
        <CardDescription>
          Explicit commitments and follow-through, never inferred from prose in v1.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {obligations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No obligations recorded.</p>
        ) : (
          obligations.map((obligation) => (
            <div className="mail-obligation-row" key={obligation.id}>
              <div>
                <strong>{label(obligation.kind)}</strong>
                <p>{obligation.rationale}</p>
              </div>
              <label>
                <span className="sr-only">State for {label(obligation.kind)}</span>
                <select
                  disabled={pending}
                  onChange={(event) =>
                    setState(
                      obligation.id,
                      obligation.version,
                      event.currentTarget.value as MailObligationState,
                    )
                  }
                  value={obligation.state}
                >
                  {obligationStates.map((state) => (
                    <option key={state} value={state}>
                      {label(state)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))
        )}
        <form
          className="mail-stewardship-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (rationale.trim()) create(kind, rationale.trim());
          }}
        >
          <label>
            New obligation
            <select
              onChange={(event) => setKind(event.currentTarget.value as MailObligationKind)}
              value={kind}
            >
              {obligationKinds.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="mail-obligation-rationale">
            Why this is explicit
            <Input
              id="mail-obligation-rationale"
              onChange={(event) => setRationale(event.currentTarget.value)}
              value={rationale}
            />
          </label>
          <Button disabled={pending || !rationale.trim()} size="sm" type="submit">
            Record obligation
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function QuestionControl({
  answer,
  pending,
  questions,
}: {
  answer: (id: string, version: number, value: string, generalize: boolean) => void;
  pending: boolean;
  questions: Awaited<ReturnType<typeof api.getMailThreadStewardship>>["questions"];
}) {
  const [generalize, setGeneralize] = useState(false);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Questions</CardTitle>
        <CardDescription>
          Answer the exact case. Reusable learning is a separate explicit proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open questions.</p>
        ) : (
          questions.map((question) => (
            <div className="space-y-2" key={question.id}>
              <p>{question.reason}</p>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => (
                  <Button
                    disabled={pending}
                    key={option.value}
                    onClick={() => answer(question.id, question.version, option.value, generalize)}
                    size="sm"
                    variant="outline"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ))
        )}
        {questions.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={generalize}
              onChange={(event) => setGeneralize(event.currentTarget.checked)}
              type="checkbox"
            />
            Propose this answer as a reusable rule
          </label>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResponseBriefControl({
  brief,
  pending,
  preview,
}: {
  brief: MailResponseBrief | null;
  pending: boolean;
  preview: (purpose: string) => void;
}) {
  const [purpose, setPurpose] = useState("");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Private response brief</CardTitle>
        <CardDescription>
          An advisory checklist only. It has no recipient, message body, copy action, or delivery
          path.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="mail-stewardship-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (purpose.trim()) preview(purpose.trim());
          }}
        >
          <label htmlFor="mail-response-purpose">
            Purpose
            <Input
              id="mail-response-purpose"
              onChange={(event) => setPurpose(event.currentTarget.value)}
              placeholder="What must a response accomplish?"
              value={purpose}
            />
          </label>
          <Button disabled={pending || !purpose.trim()} size="sm" type="submit">
            Preview private brief
          </Button>
        </form>
        {brief ? (
          <section aria-label="Private response brief" className="rounded-lg border p-3">
            <Badge variant="outline">Not transmittable</Badge>
            <h4 className="mt-2 font-medium">{brief.purpose}</h4>
            <Checklist label="Facts to address" values={brief.factsToAddress} />
            <Checklist label="Open questions" values={brief.openQuestions} />
            <Checklist label="Materials needed" values={brief.materialsNeeded} />
            <Checklist label="Tone considerations" values={brief.toneConsiderations} />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FeedbackControl({
  currentDispositionId,
  pending,
  submit,
}: {
  currentDispositionId: string | null;
  pending: boolean;
  submit: (targetId: string, kind: MailStewardshipFeedbackKind, comment: string) => void;
}) {
  const [kind, setKind] = useState<MailStewardshipFeedbackKind>("correct");
  const [comment, setComment] = useState("");
  if (!currentDispositionId) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Teach through review</CardTitle>
        <CardDescription>
          Feedback is durable evidence; it does not silently change a reusable rule.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="mail-stewardship-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) submit(currentDispositionId, kind, comment.trim());
          }}
        >
          <label>
            Feedback
            <select
              onChange={(event) =>
                setKind(event.currentTarget.value as MailStewardshipFeedbackKind)
              }
              value={kind}
            >
              {["correct", "incorrect", "outdated", "exception"].map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="mail-feedback-comment">
            Comment
            <Textarea
              id="mail-feedback-comment"
              onChange={(event) => setComment(event.currentTarget.value)}
              value={comment}
            />
          </label>
          <Button disabled={pending || !comment.trim()} size="sm" type="submit">
            <ShieldCheckIcon aria-hidden="true" data-icon="inline-start" />
            Record feedback
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Checklist({ label: heading, values }: { label: string; values: string[] }) {
  return values.length > 0 ? (
    <div className="mt-3">
      <strong>{heading}</strong>
      <ul className="list-disc pl-5">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  ) : null;
}
function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
