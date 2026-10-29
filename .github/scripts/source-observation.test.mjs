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

for (const status of ["in_progress", "completed"]) {
  test(`null merge identity stays pending with ${status} source, then recovers`, () => {
    const client = fixture();
    client.live.merge_commit_sha = null;
    client.rows[0].status = status;
    client.rows[0].conclusion = status === "completed" ? "success" : null;
    const pages = client.pages;
    client.pages = () => assert.fail("Pending merge identity must not read artifacts or jobs");
    const pending = stableObservation(client);
    assert.equal(pending.state, "pending");
    assert.equal(pending.mergeSha, null);
    assert.equal(client.downloads, 0);
    assert.equal(pending.receipt, undefined);
    client.pages = pages;
    client.live.merge_commit_sha = merge;
    client.rows[0].status = "completed";
    client.rows[0].conclusion = "success";
    assert.equal(stableObservation(client).state, "success");
    assert.equal(client.downloads, 1);
  });
}

for (const conclusion of ["failure", "cancelled"]) {
  test(`null merge identity does not hide ${conclusion} source attempt`, () => {
    const client = fixture();
    client.live.merge_commit_sha = null;
    client.rows[0].conclusion = conclusion;
    assert.throws(() => stableObservation(client), /Latest source run failed\/canceled/);
    assert.equal(client.downloads, 0);
  });
}

for (const firstMerge of [null, merge]) {
  test(`merge identity changing from ${firstMerge === null ? "null" : "valid"} recollects`, () => {
    const client = fixture();
    let reads = 0;
    client.pr = () => ({
      ...structuredClone(pr),
      merge_commit_sha: reads++ === 0 ? firstMerge : firstMerge === null ? merge : null,
    });
    const result = stableObservation(client);
    assert.equal(reads, 4);
    assert.equal(result.state, firstMerge === null ? "success" : "pending");
    assert.equal(result.mergeSha, firstMerge === null ? merge : null);
    assert.equal(client.downloads, 1);
    if (firstMerge !== null) assert.equal(result.receipt, undefined);
  });
}

test("missing and malformed merge identities remain fatal", () => {
  for (const value of [undefined, "", "bad-sha", 1, [merge], { sha: merge }]) {
    const client = fixture();
    client.live.merge_commit_sha = value;
    assert.throws(() => stableObservation(client), /Live PR identity unavailable/);
    assert.equal(client.downloads, 0);
  }
});

function regeneratedFixture() {
  const client = fixture();
  const liveMerge = "e".repeat(40);
  const tree = "f".repeat(40);
  client.live.merge_commit_sha = liveMerge;
  client.commitReads = [];
  client.commits = Object.fromEntries(
    [merge, liveMerge].map((sha) => [
      sha,
      {
        sha,
        url: `https://api.github.com/repos/${repository}/git/commits/${sha}`,
        tree: { sha: tree },
        parents: [{ sha: base }, { sha: head }],
      },
    ]),
  );
  const api = client.api.bind(client);
  client.api = (path) => {
    if (!path.startsWith("git/commits/")) return api(path);
    client.commitReads.push(path);
    const result = client.commits[path.slice("git/commits/".length)];
    if (!result) throw new Error("commit unavailable");
    return structuredClone(result);
  };
  return client;
}

test("regenerated synthetic commits preserve original receipt with complete content identity evidence", () => {
  const client = regeneratedFixture();
  const result = observeSource(client);
  assert.equal(result.state, "success");
  assert.equal(result.mergeSha, client.live.merge_commit_sha);
  assert.equal(result.receipt.mergeSha, merge);
  assert.equal(result.receipt.workflowSha, merge);
  assert.deepEqual(result.mergeCommitEvidence, {
    provider: "github-rest",
    repository,
    sourceCommit: {
      sha: merge,
      treeSha: "f".repeat(40),
      parentShas: [base, head],
      url: `https://api.github.com/repos/${repository}/git/commits/${merge}`,
    },
    liveCommit: {
      sha: client.live.merge_commit_sha,
      treeSha: "f".repeat(40),
      parentShas: [base, head],
      url: `https://api.github.com/repos/${repository}/git/commits/${client.live.merge_commit_sha}`,
    },
  });
  assert.equal(client.commitReads.length, 2);
});

test("structured observer equivalence is accepted by its readiness consumer", () => {
  const observation = observeSource(regeneratedFixture());
  const pr = Object.fromEntries(
    [
      "headSha",
      "baseSha",
      "number",
      "bodySha256",
      "mergeSha",
      "repository",
      "repositoryId",
      "baseRef",
    ].map((key) => [key, observation[key]]),
  );
  const verification = {
    sourceRun: Object.fromEntries(
      ["headSha", "baseSha", "workflowId", "runId", "runAttempt", "event"].map((key) => [
        key,
        observation[key],
      ]),
    ),
  };
  const accepted = () =>
    JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          "import sys,json;sys.path.insert(0,'.agents/skills/ship-it/scripts');from evaluate_readiness import source_observation_matches;d=json.load(sys.stdin);print(json.dumps(source_observation_matches(d['observation'],d['pr'],d['verification'])))",
        ],
        { input: JSON.stringify({ observation, pr, verification }), encoding: "utf8" },
      ),
    );
  assert.equal(accepted(), true);
  observation.mergeCommitEvidence.liveCommit.parentShas.reverse();
  assert.equal(accepted(), false);
});

test("synthetic equivalence rejects changed trees, nonexact ordered parents and invalid provider identity", () => {
  const mutations = [
    (c) => {
      c.tree.sha = "9".repeat(40);
    },
    (c) => {
      c.tree.sha = "invalid";
    },
    (c) => {
      c.parents.reverse();
    },
    (c) => {
      c.parents.pop();
    },
    (c) => {
      c.parents.push({ sha: head });
    },
    (c) => {
      c.parents[0].sha = "9".repeat(40);
    },
    (c) => {
      c.sha = "9".repeat(40);
    },
    (c) => {
      c.url = `https://api.github.com/repos/foreign/repo/git/commits/${c.sha}`;
    },
  ];
  for (const side of [merge, "e".repeat(40)]) {
    for (const mutate of mutations) {
      const client = regeneratedFixture();
      mutate(client.commits[side]);
      assert.throws(() => observeSource(client));
    }
    const client = regeneratedFixture();
    delete client.commits[side];
    assert.throws(() => observeSource(client), /unavailable/);
  }
});

test("receipt identity errors fail before synthetic commit lookup", () => {
  for (const field of [
    "number",
    "repository",
    "repositoryId",
    "headSha",
    "baseSha",
    "baseRef",
    "event",
    "runId",
    "runAttempt",
    "workflowSha",
    "workflowRef",
    "workflowSha256",
    "classifierSha256",
    "forceFull",
  ]) {
    const client = regeneratedFixture();
    client.data[field] = typeof client.data[field] === "number" ? 99 : "wrong";
    assert.throws(() => observeSource(client));
    assert.deepEqual(client.commitReads, []);
  }
});

test("synthetic equivalence never bypasses final live integration stability", () => {
  const client = regeneratedFixture();
  let reads = 0;
  const read = client.pr.bind(client);
  client.pr = () => {
    const value = read();
    if (++reads > 1) value.merge_commit_sha = "9".repeat(40);
    return value;
  };
  assert.throws(() => observeSource(client), ObservationChanged);
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
  const desktopJob = client.jobs.find((job) => job.name === "Desktop (macos-15)");
  assert.ok(desktopJob);
  desktopJob.name = "Desktop (macos-14)";
  assert.throws(() => observeSource(client), /Selected source job/);
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
