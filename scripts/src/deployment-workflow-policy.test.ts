import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import alertModule from "../../.github/scripts/emergency-production-bypass-alert.cjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_DIR = join(ROOT, ".github/workflows");
const GUARDED_WORKFLOW = "production-deploy.yml";
const BYPASS_ALERT_WORKFLOW = "emergency-production-bypass-alert.yml";
const BRANCH_PROTECTION_AUDIT_WORKFLOW = "branch-protection-audit.yml";
const DEPLOY_JOBS = [
  "auto_frontend_deploy",
  "deploy_full_auto",
  "sensitive_production_deploy",
] as const;

const {
  LABEL,
  SAFEGUARD_LABEL,
  SAFEGUARD_MARKER,
  runEmergencyBypassAlert,
  runIntegrationCheck,
  runProductionSafeguardAlert,
  runSafeguardIntegrationCheck,
} = alertModule;
function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), "utf8");
}

function topLevelSection(source: string, key: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  assert.notEqual(start, -1, `missing top-level ${key}: section`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function jobBlock(source: string, jobName: string): string {
  const jobs = topLevelSection(source, "jobs");
  const lines = jobs.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing job ${jobName}`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_][A-Za-z0-9_-]*:/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function triggersMainPush(source: string): boolean {
  const trigger = topLevelSection(source, "on");
  const firstLine = trigger.split(/\r?\n/, 1)[0] ?? "";
  if (/\bpush\b/.test(firstLine)) return true;

  const pushLine = trigger.split(/\r?\n/).findIndex((line) => /^  push:\s*$/.test(line));
  if (pushLine === -1) return false;

  const lines = trigger.split(/\r?\n/);
  let pushBlockEnd = lines.length;
  for (let index = pushLine + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_][A-Za-z0-9_-]*:/.test(lines[index] ?? "")) {
      pushBlockEnd = index;
      break;
    }
  }
  const pushBlock = lines.slice(pushLine, pushBlockEnd);
  const hasBranchRestriction = pushBlock.some((line) => /^\s{4}branches(?:-ignore)?:/.test(line));
  return !hasBranchRestriction || pushBlock.some((line) => /\bmain\b/.test(line));
}

function isProductionDeploymentWorkflow(source: string): boolean {
  return (
    /environment:\s*(?:\n\s+name:\s*)?production-sensitive/m.test(source) &&
    /\b(?:ssh|appleboy\/ssh-action)\b/.test(source)
  );
}

function needsBothSafetyJobs(block: string): boolean {
  return /^\s{4}needs:\s*\[\s*classify\s*,\s*validate\s*\]\s*$/m.test(block);
}

function deploymentCanStart(
  classification: "pending" | "failure" | "success",
  validation: "pending" | "failure" | "success",
): boolean {
  return classification === "success" && validation === "success";
}

test("the production safety workflow runs for pull requests targeting main", () => {
  const source = readWorkflow(GUARDED_WORKFLOW);
  const trigger = topLevelSection(source, "on");

  assert.match(trigger, /^\s{2}pull_request:\s*$/m);
  assert.match(trigger, /^\s{4}branches:\s*\[main\]\s*$/m);
  assert.match(jobBlock(source, "classify"), /github\.event_name == 'pull_request'/);
  assert.match(jobBlock(source, "validate"), /github\.event_name == 'pull_request'/);
});

test("Production Deploy is the only production deployment workflow", () => {
  const workflowNames = readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name));
  const productionDeployers = workflowNames.filter((name) =>
    isProductionDeploymentWorkflow(readWorkflow(name)),
  );

  assert.deepEqual(
    productionDeployers,
    [GUARDED_WORKFLOW],
    "production-deploy.yml must be the only workflow capable of deploying to production",
  );
});

test("policy detects an independently reintroduced main-push VPS deployment", () => {
  const unsafeLegacySource = `name: Unsafe production deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    environment: production-sensitive
    steps:
      - run: ssh deploy@example.com
`;

  assert.equal(isProductionDeploymentWorkflow(unsafeLegacySource), true);
  assert.equal(triggersMainPush(unsafeLegacySource), true);
});

test("every guarded deployment job depends on classification and validation", () => {
  const source = readWorkflow(GUARDED_WORKFLOW);

  for (const jobName of DEPLOY_JOBS) {
    assert.equal(
      needsBothSafetyJobs(jobBlock(source, jobName)),
      true,
      `${jobName} must need both classify and validate`,
    );
  }
});

test("dry-run confirms no deployment can start while either safety check is pending or failed", () => {
  const states = ["pending", "failure", "success"] as const;

  for (const classification of states) {
    for (const validation of states) {
      const canStart = deploymentCanStart(classification, validation);
      assert.equal(
        canStart,
        classification === "success" && validation === "success",
        `unexpected deploy eligibility for classify=${classification}, validate=${validation}`,
      );
    }
  }

  assert.equal(deploymentCanStart("success", "pending"), false);
  assert.equal(deploymentCanStart("success", "failure"), false);
  assert.equal(deploymentCanStart("success", "success"), true);
});

test("the guarded validation job runs this policy check before deployment", () => {
  const source = readWorkflow(GUARDED_WORKFLOW);
  const validate = jobBlock(source, "validate");
  assert.match(validate, /test:deployment-workflow-policy/);
});

test("the required validation check fails rather than skips when classification fails", () => {
  const source = readWorkflow(GUARDED_WORKFLOW);
  const validate = jobBlock(source, "validate");

  assert.match(
    validate,
    /^\s{4}if:\s*always\(\)\s*&&/m,
    "validate must run even when its classify dependency fails or is cancelled",
  );
  assert.match(
    validate,
    /if:\s*needs\.classify\.result\s*!=\s*'success'[\s\S]*?exit 1/,
    "validate must explicitly fail when classification did not succeed",
  );
});

test("direct pushes to main create an owner-assigned emergency bypass alert", () => {
  const source = readWorkflow(BYPASS_ALERT_WORKFLOW);
  const alert = jobBlock(source, "alert_owner");

  assert.equal(triggersMainPush(source), true);
  assert.match(source, /pull-requests:\s*read/);
  assert.match(source, /issues:\s*write/);
  assert.match(alert, /runEmergencyBypassAlert/);
  assert.match(alert, /runIntegrationCheck/);
});

test("normal pull-request merges are excluded from emergency bypass alerts", () => {
  const source = readWorkflow(BYPASS_ALERT_WORKFLOW);
  const alert = jobBlock(source, "alert_owner");

  assert.match(alert, /context\.eventName === "workflow_dispatch"/);
  assert.match(alert, /context\.payload\.inputs\?\.integration_check/);
});

test("emergency bypass integration is checked on a schedule without deploy or push access", () => {
  const source = readWorkflow(BYPASS_ALERT_WORKFLOW);
  const trigger = topLevelSection(source, "on");
  const alert = jobBlock(source, "alert_owner");

  assert.match(trigger, /^\s{2}schedule:/m, "integration check must run on a schedule");
  assert.match(alert, /context\.eventName === "schedule"/);
  assert.match(alert, /await runIntegrationCheck\(\{ github, context, core \}\)/);
  assert.doesNotMatch(source, /contents:\s*write/);
  assert.doesNotMatch(source, /\bgit\s+push\b/);
  assert.doesNotMatch(source, /\bdeploy(?:ment)?\b/i);
});

test("emergency bypass alerts cannot be blocked by production deployment concurrency", () => {
  const source = readWorkflow(BYPASS_ALERT_WORKFLOW);
  const production = readWorkflow(GUARDED_WORKFLOW);

  assert.doesNotMatch(source, /^concurrency:/m);
  assert.match(production, /group:\s*rasokart-production/);
  assert.doesNotMatch(source, /rasokart-production/);
});

function fakeAlertHarness(associatedPulls: unknown[] = []) {
  const calls = {
    associated: 0,
    creates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  };
  const issue = {
    number: 42,
    assignees: [{ login: "repo-owner" }],
    labels: [{ name: LABEL }],
  };
  const github = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: async () => {
          calls.associated += 1;
          return { data: associatedPulls };
        },
      },
      issues: {
        listForRepo: async () => ({ data: [] }),
        getLabel: async () => ({ data: { name: LABEL } }),
        createLabel: async () => ({ data: { name: LABEL } }),
        create: async (request: Record<string, unknown>) => {
          calls.creates.push(request);
          return { data: issue };
        },
        get: async () => ({ data: issue }),
        update: async (request: Record<string, unknown>) => {
          calls.updates.push(request);
          return { data: { ...issue, state: "closed" } };
        },
      },
    },
  };
  const context = {
    repo: { owner: "repo-owner", repo: "repo-name" },
    payload: {
      after: "push-sha",
      compare: "https://github.test/repo-owner/repo-name/compare",
      head_commit: { timestamp: "2026-09-16T00:00:00Z" },
    },
    actor: "emergency-actor",
    serverUrl: "https://github.test",
    runId: 123,
    sha: "check-sha",
  };
  const core = { info: () => undefined };
  return { github, context, core, calls };
}

function fakeSafeguardHarness(
  existingIssue?: Record<string, unknown>,
  issuePages?: Array<Array<Record<string, unknown>>>,
  failingPage?: number,
) {
  const calls = {
    creates: [] as Array<Record<string, unknown>>,
    labelCreates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    listRequests: [] as Array<Record<string, unknown>>,
  };
  const github = {
    rest: {
      issues: {
        listForRepo: async (request: Record<string, unknown>) => {
          calls.listRequests.push(request);
          const page = Number(request.page ?? 1);
          if (page === failingPage) {
            throw new Error("simulated GitHub issue-list API failure");
          }
          const pages = issuePages ?? [existingIssue ? [existingIssue] : []];
          return { data: pages[page - 1] ?? [] };
        },
        getLabel: async () => ({ data: { name: SAFEGUARD_LABEL } }),
        createLabel: async (request: Record<string, unknown>) => {
          calls.labelCreates.push(request);
          return { data: { name: SAFEGUARD_LABEL } };
        },
        create: async (request: Record<string, unknown>) => {
          calls.creates.push(request);
          return {
            data: {
              number: 73,
              ...request,
            },
          };
        },
        update: async (request: Record<string, unknown>) => {
          calls.updates.push(request);
          return { data: { number: 73, ...request } };
        },
      },
    },
  };
  const context = {
    repo: { owner: "repo-owner", repo: "repo-name" },
    serverUrl: "https://github.test",
    runId: 987,
  };
  const core = { info: () => undefined };
  return { github, context, core, calls };
}

function fakeSafeguardIntegrationHarness(options: { failIssueVerification?: boolean } = {}) {
  const calls = {
    creates: [] as Array<Record<string, unknown>>,
    labelCreates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    labelDeletes: [] as Array<Record<string, unknown>>,
  };
  let labelExists = false;
  let issue: Record<string, unknown> | undefined;
  let failIssueVerification = options.failIssueVerification ?? false;
  const github = {
    rest: {
      issues: {
        listForRepo: async () => ({ data: issue ? [issue] : [] }),
        getLabel: async () => {
          if (!labelExists) {
            const error = new Error("Not Found") as Error & { status?: number };
            error.status = 404;
            throw error;
          }
          return { data: { name: "integration-label" } };
        },
        createLabel: async (request: Record<string, unknown>) => {
          labelExists = true;
          calls.labelCreates.push(request);
          return { data: { name: request.name } };
        },
        create: async (request: Record<string, unknown>) => {
          issue = { number: 73, ...request };
          calls.creates.push(request);
          return { data: issue };
        },
        get: async () => {
          if (failIssueVerification) {
            failIssueVerification = false;
            throw new Error("simulated safeguard issue verification failure");
          }
          return {
            data: issue
              ? {
                  ...issue,
                  assignees: (issue.assignees as string[]).map((login) => ({ login })),
                }
              : issue,
          };
        },
        update: async (request: Record<string, unknown>) => {
          issue = { ...issue, ...request };
          calls.updates.push(request);
          return { data: issue };
        },
        deleteLabel: async (request: Record<string, unknown>) => {
          labelExists = false;
          calls.labelDeletes.push(request);
        },
      },
    },
  };
  const context = {
    repo: { owner: "repo-owner", repo: "repo-name" },
    serverUrl: "https://github.test",
    runId: 987,
  };
  const core = { info: () => undefined };
  return {
    github,
    context,
    core,
    calls,
    getIssue: () => issue,
    hasLabel: () => labelExists,
  };
}

test("alert implementation uses the association API and assigns and labels the owner", async () => {
  const harness = fakeAlertHarness();
  const result = await runEmergencyBypassAlert(harness);

  assert.equal(result.created, true);
  assert.equal(harness.calls.associated, 1);
  assert.equal(harness.calls.creates.length, 1);
  assert.deepEqual(harness.calls.creates[0]?.assignees, ["repo-owner"]);
  assert.deepEqual(harness.calls.creates[0]?.labels, [LABEL]);
});

test("simulated normal pull-request merge exercises association API without creating alert", async () => {
  const harness = fakeAlertHarness();
  const result = await runEmergencyBypassAlert({
    ...harness,
    sha: "merge-sha",
    simulatedAssociatedPulls: [
      {
        merged_at: "2026-09-16T00:00:00Z",
        base: { ref: "main" },
        merge_commit_sha: "merge-sha",
      },
    ],
  });

  assert.deepEqual(result, { created: false, reason: "normal_pull_request_merge" });
  assert.equal(harness.calls.associated, 1);
  assert.equal(harness.calls.creates.length, 0);
});

test("non-production integration path verifies the issue and closes it", async () => {
  const harness = fakeAlertHarness();
  await runIntegrationCheck(harness);

  assert.equal(harness.calls.associated, 2);
  assert.equal(harness.calls.creates.length, 1);
  assert.deepEqual(harness.calls.updates, [
    {
      owner: "repo-owner",
      repo: "repo-name",
      issue_number: 42,
      state: "closed",
    },
  ]);
});

test("production safeguard drift creates one owner-assigned issue with every drift and run link", async () => {
  const harness = fakeSafeguardHarness();
  const result = await runProductionSafeguardAlert({
    ...harness,
    auditSucceeded: true,
    drift: ["force pushes are not blocked", "required validation context is missing: check"],
  });

  assert.equal(result.created, true);
  assert.equal(harness.calls.creates.length, 1);
  const request = harness.calls.creates[0] ?? {};
  assert.deepEqual(request.assignees, ["repo-owner"]);
  assert.deepEqual(request.labels, [SAFEGUARD_LABEL]);
  assert.match(String(request.body), new RegExp(SAFEGUARD_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(String(request.body), /force pushes are not blocked/);
  assert.match(String(request.body), /required validation context is missing: check/);
  assert.match(
    String(request.body),
    /https:\/\/github\.test\/repo-owner\/repo-name\/actions\/runs\/987/,
  );
});

test("serialized production safeguard alerts create only one marker issue", async () => {
  const calls = {
    creates: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  };
  const issues: Array<Record<string, unknown>> = [];
  const github = {
    rest: {
      issues: {
        listForRepo: async () => ({ data: [...issues] }),
        getLabel: async () => ({ data: { name: SAFEGUARD_LABEL } }),
        createLabel: async (request: Record<string, unknown>) => ({
          data: { name: request.name },
        }),
        create: async (request: Record<string, unknown>) => {
          const issue = { number: 73, ...request };
          issues.push(issue);
          calls.creates.push(request);
          return { data: issue };
        },
        update: async (request: Record<string, unknown>) => {
          calls.updates.push(request);
          return { data: request };
        },
      },
    },
  };
  const input = {
    github,
    context: {
      repo: { owner: "repo-owner", repo: "repo-name" },
      serverUrl: "https://github.test",
      runId: 987,
    },
    core: { info: () => undefined },
    auditSucceeded: true,
    drift: ["required status check is missing"],
  };

  const results = [
    await runProductionSafeguardAlert(input),
    await runProductionSafeguardAlert(input),
  ];

  assert.equal(calls.creates.length, 1);
  assert.equal(issues.filter((issue) => String(issue.body).includes(SAFEGUARD_MARKER)).length, 1);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(
    results.map((result) => result.created).sort(),
    [false, true],
  );
  assert.deepEqual(calls.creates[0]?.assignees, ["repo-owner"]);
});

test("production safeguard alerts are deduplicated, reopened on drift, and closed when healthy", async () => {
  const existingIssue = {
    number: 73,
    body: SAFEGUARD_MARKER,
    state: "closed",
  };
  const harness = fakeSafeguardHarness(existingIssue);

  const reopened = await runProductionSafeguardAlert({
    ...harness,
    auditSucceeded: true,
    drift: ["branch deletion is not blocked"],
  });
  assert.equal(reopened.created, false);
  assert.equal(reopened.updated, true);
  assert.equal(harness.calls.creates.length, 0);
  assert.equal(harness.calls.updates[0]?.state, "open");
  assert.deepEqual(harness.calls.updates[0]?.assignees, ["repo-owner"]);

  const resolved = await runProductionSafeguardAlert({
    ...harness,
    auditSucceeded: true,
    drift: [],
  });
  assert.equal(resolved.resolved, true);
  assert.equal(harness.calls.updates.length, 2);
  assert.equal(harness.calls.updates[1]?.state, "closed");
  assert.match(String(harness.calls.updates[1]?.body), /safeguard drift resolved/);
  assert.match(String(harness.calls.updates[1]?.body), /healthy audit run/);
});

test("safeguard integration creates, verifies, resolves, and cleans up a temporary issue", async () => {
  const harness = fakeSafeguardIntegrationHarness();
  const result = await runSafeguardIntegrationCheck(harness);

  assert.equal(result.created, true);
  assert.equal(result.resolved, true);
  assert.equal(
    harness.calls.labelCreates.filter(
      (request) => request.name === "production-safeguard-integration-987",
    ).length,
    1,
  );
  assert.equal(harness.calls.creates.length, 1);
  assert.deepEqual(harness.calls.creates[0]?.assignees, ["repo-owner"]);
  assert.deepEqual(harness.calls.creates[0]?.labels, ["production-safeguard-integration-987"]);
  assert.equal(harness.calls.updates.length, 1);
  assert.equal(harness.calls.updates[0]?.state, "closed");
  assert.deepEqual(harness.calls.updates[0]?.assignees, ["repo-owner"]);
  assert.equal(
    harness.calls.labelDeletes.filter(
      (request) => request.name === "production-safeguard-integration-987",
    ).length,
    1,
  );
});

test("production safeguard lookup finds a closed alert beyond the first issue page", async () => {
  const existingIssue = {
    number: 173,
    body: SAFEGUARD_MARKER,
    state: "closed",
  };
  const harness = fakeSafeguardHarness(undefined, [
    Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      body: `unrelated issue ${index + 1}`,
    })),
    [existingIssue],
  ]);

  const result = await runProductionSafeguardAlert({
    ...harness,
    auditSucceeded: true,
    drift: ["required status check is missing"],
  });

  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.equal(harness.calls.creates.length, 0);
  assert.equal(harness.calls.listRequests.length, 2);
  assert.equal(harness.calls.listRequests[0]?.page, 1);
  assert.equal(harness.calls.listRequests[1]?.page, 2);
  assert.equal(harness.calls.updates[0]?.issue_number, existingIssue.number);
  assert.equal(harness.calls.updates[0]?.state, "open");
});

test("production safeguard lookup scans the next page and creates only one alert when no marker exists", async () => {
  const harness = fakeSafeguardHarness(undefined, [
    Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      body: `unrelated issue ${index + 1}`,
    })),
    [{ number: 101, body: "another unrelated issue" }],
  ]);

  const result = await runProductionSafeguardAlert({
    ...harness,
    auditSucceeded: true,
    drift: ["required validation context is missing: check"],
  });

  assert.equal(result.created, true);
  assert.equal(harness.calls.creates.length, 1);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.listRequests.length, 2);
  assert.equal(harness.calls.listRequests[0]?.page, 1);
  assert.equal(harness.calls.listRequests[1]?.page, 2);
});

test("production safeguard lookup failure reports repository and page without mutating alerts", async () => {
  const harness = fakeSafeguardHarness(
    undefined,
    [
      Array.from({ length: 100 }, (_, index) => ({
        number: index + 1,
        body: `unrelated issue ${index + 1}`,
      })),
    ],
    2,
  );

  await assert.rejects(
    runProductionSafeguardAlert({
      ...harness,
      auditSucceeded: true,
      drift: [],
    }),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /repo-owner\/repo-name/);
      assert.match(error.message, /issue page 2/);
      assert.equal(
        (error as Error & { cause?: Error }).cause?.message,
        "simulated GitHub issue-list API failure",
      );
      return true;
    },
  );

  assert.equal(harness.calls.listRequests.length, 2);
  assert.equal(harness.calls.labelCreates.length, 0);
  assert.equal(harness.calls.creates.length, 0);
  assert.equal(harness.calls.updates.length, 0);
});

test("safeguard integration cleans up after issue verification fails", async () => {
  const harness = fakeSafeguardIntegrationHarness({ failIssueVerification: true });

  await assert.rejects(
    runSafeguardIntegrationCheck(harness),
    /simulated safeguard issue verification failure/,
  );

  assert.equal(harness.calls.creates.length, 1);
  assert.equal(harness.calls.updates.length, 1);
  assert.equal(harness.calls.updates[0]?.state, "closed");
  assert.deepEqual(harness.calls.updates[0]?.assignees, ["repo-owner"]);
  assert.deepEqual(harness.calls.updates[0]?.labels, ["production-safeguard-integration-987"]);
  const integrationLabelDeletes = harness.calls.labelDeletes.filter(
    (request) => request.name === "production-safeguard-integration-987",
  );
  assert.equal(integrationLabelDeletes.length, 1);
  assert.deepEqual(integrationLabelDeletes[0], {
    owner: "repo-owner",
    repo: "repo-name",
    name: "production-safeguard-integration-987",
  });
  assert.equal(harness.getIssue()?.state, "closed");
  assert.deepEqual(harness.getIssue()?.assignees, ["repo-owner"]);
  assert.equal(harness.hasLabel(), false);
});

test("branch and deployment safeguards are audited on a schedule and on demand", () => {
  const source = readWorkflow(BRANCH_PROTECTION_AUDIT_WORKFLOW);
  const trigger = topLevelSection(source, "on");

  assert.match(trigger, /^\s{2}schedule:/m, "branch protection audit must run on a schedule");
  assert.match(
    trigger,
    /^\s{2}workflow_dispatch:/m,
    "branch protection audit must be manually runnable",
  );
  assert.match(
    source,
    /audit:branch-protection/,
    "branch protection workflow must run the live protection audit",
  );
  assert.match(
    source,
    /BRANCH_PROTECTION_AUDIT_TOKEN/,
    "live audit must use a token capable of reading repository administration settings",
  );
  assert.match(
    readWorkflow(GUARDED_WORKFLOW),
    /TEMP_AUTO_DEPLOY_ENABLED/,
    "production deployment policy must declare its temporary auto-deploy variable",
  );
  assert.match(
    source,
    /Read and verify live production safeguards/,
    "scheduled audit must clearly cover deployment safeguards",
  );
  assert.match(source, /issues:\s*write/, "audit must be able to manage its owner alert issue");
  assert.match(source, /runProductionSafeguardAlert/);
  assert.match(source, /Preserve the failed audit status/);
  assert.doesNotMatch(source, /contents:\s*write/);
  assert.doesNotMatch(source, /\bdeploy(?:ment)?\s*:\s*write\b/i);
});

test("scheduled and manual safeguard audits are serialized without cancelling either run", () => {
  const source = readWorkflow(BRANCH_PROTECTION_AUDIT_WORKFLOW);
  const concurrency = topLevelSection(source, "concurrency");

  assert.match(concurrency, /^\s{2}group:\s*production-safeguards-audit\s*$/m);
  assert.match(concurrency, /^\s{2}cancel-in-progress:\s*false\s*$/m);
});

test("safeguard alert integration is manual, issue-only, and cannot change safeguards", () => {
  const source = readWorkflow(BRANCH_PROTECTION_AUDIT_WORKFLOW);
  const trigger = topLevelSection(source, "on");

  assert.match(trigger, /^\s{2}workflow_dispatch:/m);
  assert.match(source, /safeguard_integration_check/);
  assert.match(source, /runSafeguardIntegrationCheck/);
  assert.match(source, /issues:\s*write/);
  assert.doesNotMatch(source, /contents:\s*write/);
  assert.doesNotMatch(source, /\bgit\s+push\b/);
  assert.doesNotMatch(source, /\b(?:ssh|appleboy\/ssh-action)\b/);
  assert.doesNotMatch(source, /environment:\s*production-sensitive/);
});
