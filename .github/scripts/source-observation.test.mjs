import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyChanges } from "./ci-scope.mjs";
import {
  ObservationChanged,
  observeSource,
  SourceClient,
  stableObservation,
} from "./source-observation.mjs";
import { createReceipt, selectedJobNames, sha256 } from "./source-receipt.mjs";

const head = "a".repeat(40),
  base = "b".repeat(40),
  merge = "c".repeat(40);
const scope = { ...classifyChanges([]), full: false, prose_only: true, repo: true };
const repository = "owner/repo";
const pr = {
  state: "open",
  number: 42,
  head: { sha: head },
  base: { sha: base, ref: "main", repo: { id: 1, full_name: repository } },
  merge_commit_sha: merge,
  body: "current body",
  labels: [],
};
const workflow = { id: 12, path: ".github/workflows/ci.yml", state: "active" };
const run = {
  id: 7,
  workflow_id: 12,
  repository: { id: 1, full_name: repository },
  run_attempt: 1,
  head_sha: head,
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  pull_requests: [{ number: 42, base: { sha: base, ref: "main" }, head: { sha: head } }],
};
const env = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REPOSITORY: repository,
  GITHUB_RUN_ID: "7",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: merge,
  GITHUB_WORKFLOW_SHA: merge,
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/ci.yml@refs/pull/42/merge`,
};
const receipt = createReceipt(
  { pull_request: pr, repository: { id: 1, full_name: repository } },
  env,
  scope,
  () => "contents",
);

function fixture() {
  return {
    repository,
    number: 42,
    downloads: 0,
    validations: [],
    live: structuredClone(pr),
    rows: [structuredClone(run)],
    data: structuredClone(receipt),
    jobs: selectedJobNames(scope).map((name, i) => ({
      id: i + 1,
      name,
      run_id: 7,
      run_attempt: 1,
      head_sha: head,
      status: "completed",
      conclusion: "success",
    })),
    pr() {
      return structuredClone(this.live);
    },
    runs() {
      return structuredClone(this.rows);
    },
    api(path) {
      return path === "actions/workflows/ci.yml"
        ? workflow
        : structuredClone(this.rows.find((r) => r.id === 7));
    },
    validateBody(body) {
      this.validations.push(body);
    },
    scope() {
      return scope;
    },
    digests() {
      return { workflowSha256: sha256("contents"), classifierSha256: sha256("contents") };
    },
    pages(path) {
      return path.endsWith("/artifacts")
        ? [
            {
              id: 11,
              name: `source-candidate-7-${this.rows[0].run_attempt}`,
              digest: `sha256:${"d".repeat(64)}`,
              workflow_run: { id: 7, head_sha: head },
            },
          ]
        : structuredClone(this.jobs);
    },
    receipt() {
      this.downloads++;
      return structuredClone(this.data);
    },
  };
}

test("completed source binds receipt, current body and selected attempt jobs", () => {
  const client = fixture();
  const result = observeSource(client, { headSha: head, baseSha: base });
  assert.equal(result.state, "success");
  assert.equal(result.bodySha256, sha256(pr.body));
  assert.equal(result.artifact.id, 11);
  assert.deepEqual(client.validations, [pr.body]);
  assert.equal(client.downloads, 1);
  assert.equal(result.jobs.length, 3);
});

test("metadata-first pending/missing source remains pending and never downloads", () => {
  for (const rows of [[], [{ ...run, status: "in_progress", conclusion: null }]]) {
    const client = fixture();
    client.rows = rows;
    assert.equal(observeSource(client).state, "pending");
    assert.equal(client.downloads, 0);
  }
});

test("newest failed/canceled/pending attempt supersedes an earlier success", () => {
  for (const conclusion of ["failure", "cancelled", null]) {
    const client = fixture();
    client.rows.push({
      ...run,
      run_attempt: 2,
      status: conclusion ? "completed" : "queued",
      conclusion,
    });
    if (conclusion) assert.throws(() => observeSource(client), /failed\/canceled/);
    else {
      client.api = (path) => (path === "actions/workflows/ci.yml" ? workflow : client.rows[1]);
      assert.equal(observeSource(client).state, "pending");
    }
    assert.equal(client.downloads, 0);
  }
});

test("foreign PR on shared head neither satisfies nor supersedes this PR", () => {
  const foreign = { ...run, id: 99, conclusion: "failure", pull_requests: [{ number: 98 }] };
  const client = fixture();
  client.rows.push(foreign);
  assert.equal(observeSource(client).runId, 7);
  client.rows = [foreign];
  assert.equal(observeSource(client).state, "pending");
});

test("same-head retarget cannot reuse original event receipt or metadata event tuple", () => {
  const client = fixture();
  client.live.base.sha = "d".repeat(40);
  assert.throws(() => observeSource(client, { baseSha: base }), /integration context changed/);
  assert.throws(() => observeSource(client), /integration context is stale/);
  client.rows[0].pull_requests[0].base.sha = client.live.base.sha;
  assert.throws(() => observeSource(client), /receipt does not bind/);
});

test("retry beginning during job observation invalidates stable PR tuple", () => {
  const client = fixture();
  const pages = client.pages;
  client.pages = function (path) {
    const result = pages.call(this, path);
    if (path.endsWith("/jobs")) this.rows[0].run_attempt++;
    return result;
  };
  assert.throws(() => observeSource(client), ObservationChanged);
});

test("old metadata event validates live body, and concurrent edit invalidates observation", () => {
  const client = fixture();
  client.live.body = "new Work map";
  assert.equal(observeSource(client).bodySha256, sha256("new Work map"));
  assert.deepEqual(client.validations, ["new Work map"]);
  const read = client.pr;
  let reads = 0;
  client.pr = function () {
    if (++reads === 2) this.live.body = "edited again";
    return read.call(this);
  };
  assert.throws(() => observeSource(client), ObservationChanged);
});

test("selected skipped/neutral/missing/wrong-attempt/foreign jobs fail even with green workflow", () => {
  for (const change of [
    (c) => {
      c.jobs[1].conclusion = "skipped";
    },
    (c) => {
      c.jobs[1].conclusion = "neutral";
    },
    (c) => {
      c.jobs.pop();
    },
    (c) => {
      c.jobs[1].run_attempt = 2;
    },
    (c) => {
      c.jobs[1].head_sha = base;
    },
    (c) => {
      c.jobs.push(c.jobs[1]);
    },
  ]) {
    const client = fixture();
    change(client);
    assert.throws(() => observeSource(client), /Selected source job/);
  }
});

test("missing partial-rerun receipt requires full source retry, never older receipt reuse", () => {
  const client = fixture();
  const pages = client.pages;
  client.pages = function (path) {
    return path.endsWith("/artifacts") ? [] : pages.call(this, path);
  };
  assert.throws(() => observeSource(client), /retry the full source run/);
});

test("identity, scope and digest mismatches cannot become source evidence", () => {
  for (const change of [
    (c) => {
      c.data.runAttempt++;
    },
    (c) => {
      c.data.number++;
    },
    (c) => {
      c.data.repositoryId++;
    },
    (c) => {
      c.data.classifierSha256 = "e".repeat(64);
    },
    (c) => {
      c.data.scope = classifyChanges(["apps/api/src/app.ts"]);
    },
  ]) {
    const client = fixture();
    change(client);
    assert.throws(() => observeSource(client), /receipt does not bind/);
  }
});

test("one bounded recollection handles change, repeated changes fail", () => {
  const client = fixture();
  const read = client.pr;
  let count = 0;
  client.pr = function () {
    if (++count === 2) this.live.body = "new";
    return read.call(this);
  };
  assert.equal(stableObservation(client).state, "success");
  assert.equal(count, 4);
  client.pr = function () {
    this.live.body += "!";
    return read.call(this);
  };
  assert.throws(() => stableObservation(client), ObservationChanged);
});

test("provider inventories, deadlines and archive transport stay bounded", () => {
  const client = new SourceClient(repository, 42, 0);
  assert.throws(() => client.command("gh", ["api", "user"]), /deadline/);
  let pages = 0;
  client.api = () => {
    pages++;
    return { total_count: 1000, jobs: Array(100).fill({}) };
  };
  assert.throws(() => client.pages("anything", "jobs"), /pagination limit/);
  assert.equal(pages, 3);
  client.api = () => ({ total_count: 2, jobs: [{}] });
  assert.throws(() => client.pages("anything", "jobs"), /changed during pagination/);
});

test("bounded archive parser rejects traversal, multiple entries, bombs and duplicate JSON keys", () => {
  const python = `import io,zipfile,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:\n for name,body in __import__('json').loads(sys.argv[1]):z.writestr(name,body)\nsys.stdout.buffer.write(b.getvalue())`;
  const cases = [
    [["source-candidate.json", '{"ok":true}']],
    [["../source-candidate.json", "{}"]],
    [
      ["source-candidate.json", "{}"],
      ["other", "{}"],
    ],
    [["source-candidate.json", "x".repeat(17000)]],
    [["source-candidate.json", '{"a":1,"a":2}']],
  ];
  for (let i = 0; i < cases.length; i++) {
    const archive = execFileSync("python3", ["-c", python, JSON.stringify(cases[i])]);
    const read = () =>
      execFileSync("python3", [".github/scripts/read-source-receipt.py"], {
        input: archive,
        stdio: ["pipe", "pipe", "pipe"],
      });
    if (i === 0) assert.deepEqual(JSON.parse(read()), { ok: true });
    else assert.throws(read);
  }
  assert.throws(() =>
    execFileSync("python3", [".github/scripts/read-source-receipt.py"], {
      input: Buffer.alloc(65537),
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
});

test("workflow keeps read-only permissions, polling and one protected context", () => {
  const metadata = readFileSync(".github/workflows/pr-metadata.yml", "utf8");
  assert.match(metadata, /actions: read/);
  assert.doesNotMatch(metadata, /write|workflow_run|--collect/);
  assert.match(metadata, /wait-source-ci.mjs/);
  assert.match(readFileSync(".github/scripts/wait-source-ci.mjs", "utf8"), /40 \* 60 \* 1000/);
});

test("provider retry is bounded and malformed private payload stays out of errors", () => {
  const client = new SourceClient(repository, 42);
  let calls = 0;
  client.command = () => {
    if (++calls === 1) throw new Error("private-token");
    return Buffer.from('{"ok":true}');
  };
  assert.deepEqual(client.api("example"), { ok: true });
  assert.equal(calls, 2);
  calls = 0;
  client.command = () => {
    calls++;
    return Buffer.from("private-token malformed");
  };
  assert.throws(
    () => client.api("example"),
    (error) => {
      assert.equal(calls, 2);
      return !error.message.includes("private-token");
    },
  );
});

test("receipt transport rejects excess input and mismatched digest before decoding", () => {
  const client = new SourceClient(repository, 42);
  let calls = 0;
  client.command = () => {
    calls++;
    return Buffer.from("wrong archive");
  };
  const artifact = { id: 1, expired: false, size_in_bytes: 20, digest: `sha256:${"d".repeat(64)}` };
  assert.throws(() => client.receipt({ ...artifact, size_in_bytes: 65537 }), /identity\/size/);
  assert.equal(calls, 0);
  assert.throws(() => client.receipt(artifact), /digest mismatch/);
  assert.equal(calls, 1);
});

test("PR body remains an environment value, never shell command text or receipt data", () => {
  const client = new SourceClient(repository, 42);
  const body = "literal $(printf private) `literal`";
  client.command = (command, args, options) => {
    assert.equal(command, "bash");
    assert.deepEqual(args, [".codex/scripts/check-pr-body.sh"]);
    assert.equal(options.env.PR_BODY, body);
    return Buffer.from("");
  };
  client.validateBody(body);
  assert.equal(JSON.stringify(receipt).includes(pr.body), false);
});

test("newer unknown workflow/PR identity cannot fall back to an older success", () => {
  for (const change of [
    (r) => {
      delete r.pull_requests;
    },
    (r) => {
      r.pull_requests = [];
    },
    (r) => {
      r.pull_requests = [{}];
    },
    (r) => {
      delete r.workflow_id;
    },
    (r) => {
      delete r.repository;
    },
    (r) => {
      r.event = "push";
    },
  ]) {
    const client = fixture();
    const newer = structuredClone(run);
    newer.id = 8;
    change(newer);
    client.rows.push(newer);
    assert.throws(() => observeSource(client), /inventory identity incomplete/);
    assert.equal(client.downloads, 0);
  }
});

test("ci:full label edits affect future events, not the authenticated receipt scope", () => {
  const client = fixture();
  client.live.labels = [{ name: "ci:full" }];
  assert.equal(observeSource(client).state, "success");
  const full = classifyChanges([]);
  client.live.labels = [];
  client.data.forceFull = true;
  client.data.scope = full;
  client.scope = (_base, _head, forceFull) => {
    assert.equal(forceFull, true);
    return full;
  };
  client.jobs = selectedJobNames(full).map((name, i) => ({
    id: i + 1,
    name,
    run_id: 7,
    run_attempt: 1,
    head_sha: head,
    status: "completed",
    conclusion: "success",
  }));
  const result = observeSource(client);
  assert.equal(result.state, "success");
  assert.equal(result.forceFull, true);
});

test("pending old-base source is stale, and retarget event cannot wait on an old run", () => {
  const client = fixture();
  client.rows[0].status = "in_progress";
  client.rows[0].conclusion = null;
  client.live.base.sha = "d".repeat(40);
  assert.throws(() => observeSource(client), /integration context is stale/);
  assert.equal(client.downloads, 0);
  assert.throws(() => observeSource(fixture(), { retargeted: true }), /Retargeted metadata event/);
});

test("Git scope recomputation uses the remaining command timeout and historical force flag", () => {
  const client = new SourceClient(repository, 42);
  const classifier = readFileSync(".github/scripts/ci-scope.mjs");
  client.command = (program, args, options) => {
    if (program === "git") return classifier;
    assert.equal(program, "node");
    assert.deepEqual(args, [
      ".github/scripts/ci-scope.mjs",
      "--base",
      base,
      "--head",
      head,
      "--json",
    ]);
    assert.equal(options.env.CI_FULL, "true");
    return Buffer.from(JSON.stringify(classifyChanges([])));
  };
  assert.equal(client.scope(base, head, true).full, true);
});
