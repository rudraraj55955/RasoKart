const LABEL = "emergency-production-bypass";
const STALE_RUN_LABEL = "emergency-production-bypass-stale-run";
const INTEGRATION_WORKFLOW_FILE = "emergency-production-bypass-alert.yml";
const DEFAULT_STALE_RUN_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const PROVIDER_AUDIT_WORKFLOW_FILE = "provider-analytics-report-audit.yml";
const PROVIDER_AUDIT_STALE_LABEL = "provider-analytics-report-audit-stale";
const PROVIDER_AUDIT_STALE_MARKER = "<!-- provider-analytics-report-audit-stale -->";
const DEFAULT_PROVIDER_AUDIT_STALE_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const PROVIDER_INTEGRATION_CHECK_RUN_NAME = "Provider alert integration check";
const PROVIDER_INTEGRATION_CHECK_REMINDER_LABEL = "provider-alert-integration-check-overdue";
const PROVIDER_INTEGRATION_CHECK_REMINDER_MARKER =
  "<!-- provider-alert-integration-check-overdue -->";
const PROVIDER_INTEGRATION_CHECK_FAILURE_LABEL = "provider-alert-integration-check-failing";
const PROVIDER_INTEGRATION_CHECK_FAILURE_MARKER =
  "<!-- provider-alert-integration-check-failing -->";
const DEFAULT_PROVIDER_INTEGRATION_CHECK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PROVIDER_INTEGRATION_CHECK_FAILURE_THRESHOLD = 2;
const PROVIDER_AUDIT_MONITOR_WORKFLOW_FILE = "provider-analytics-report-audit-monitor.yml";
const SAFEGUARD_LABEL = "production-safeguard-drift";
const SAFEGUARD_MARKER = "<!-- production-safeguard-drift -->";
const ISSUE_LIST_MAX_ATTEMPTS = 3;
const ISSUE_LIST_BACKOFF_MS = 250;

function isRetryableIssueListError(error) {
  const status = Number(error?.status);
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureLabel(
  github,
  owner,
  repo,
  label = LABEL,
  description = "A direct push bypassed the normal production pull-request gates",
  color = "B60205",
) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: label });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color,
      description,
    });
  }
}

async function ensureSafeguardLabel(github, owner, repo, labelName = SAFEGUARD_LABEL) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: labelName });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: labelName,
      color: "D93F0B",
      description: "Production branch or deployment safeguards have drifted",
    });
  }
}

async function findEmergencyBypassIssue(github, owner, repo, marker) {
  for (let page = 1; ; page += 1) {
    let existing;
    try {
      existing = await github.rest.issues.listForRepo({
        owner,
        repo,
        state: "all",
        creator: "github-actions[bot]",
        per_page: 100,
        page,
      });
    } catch (error) {
      throw new Error(
        `Failed to look up emergency bypass alert for ${owner}/${repo} on issue page ${page}`,
        { cause: error },
      );
    }
    const bypassIssue = existing.data.find((issue) => issue.body?.includes(marker));
    if (bypassIssue) return bypassIssue;
    if (existing.data.length < 100) return undefined;
  }
}

async function findSafeguardIssue(
  github,
  owner,
  repo,
  marker = SAFEGUARD_MARKER,
  {
    maxAttempts = ISSUE_LIST_MAX_ATTEMPTS,
    backoffMs = ISSUE_LIST_BACKOFF_MS,
    delay = sleep,
  } = {},
) {
  for (let page = 1; ; page += 1) {
    let existing;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        existing = await github.rest.issues.listForRepo({
          owner,
          repo,
          state: "all",
          creator: "github-actions[bot]",
          per_page: 100,
          page,
        });
        break;
      } catch (error) {
        const retryable = isRetryableIssueListError(error);
        if (!retryable || attempt === maxAttempts) {
          throw new Error(
            `Failed to look up production safeguard alert for ${owner}/${repo} on issue page ${page} after ${attempt} attempt${attempt === 1 ? "" : "s"}`,
            { cause: error },
          );
        }
        await delay(backoffMs * 2 ** (attempt - 1));
      }
    }
    const safeguardIssue = existing.data.find((issue) => issue.body?.includes(marker));
    if (safeguardIssue) return safeguardIssue;
    if (existing.data.length < 100) return undefined;
  }
}

function auditRunUrl(context, owner, repo) {
  return `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
}

function safeguardIssueBody({
  context,
  owner,
  repo,
  drift,
  auditSucceeded,
  auditError,
  marker = SAFEGUARD_MARKER,
}) {
  const runUrl = auditRunUrl(context, owner, repo);
  const driftItems = drift.length
    ? drift.map((problem) => `- ${problem}`)
    : ["- The audit did not return a drift list; inspect the failed audit run for details."];
  const errorDetails = auditError
    ? [
        "",
        "### Audit error",
        "",
        auditError,
      ]
    : [];

  return [
    marker,
    "## Production safeguard drift detected",
    "",
    auditSucceeded
      ? "The production safeguards audit completed and found the following drift:"
      : "The production safeguards audit failed before it could verify the live settings:",
    "",
    "### Drifted safeguards",
    "",
    ...driftItems,
    ...errorDetails,
    "",
    `- **Failed audit run:** [View the failed GitHub Actions run](${runUrl})`,
    "",
    "Restore the safeguards and rerun the audit. This alert is assigned to the repository owner.",
  ].join("\n");
}

async function runProductionSafeguardAlert({
  github,
  context,
  core,
  drift = [],
  auditSucceeded = false,
  auditError,
  labelName = SAFEGUARD_LABEL,
  marker = SAFEGUARD_MARKER,
  titlePrefix = "",
  issueListRetry,
}) {
  const { owner, repo } = context.repo;
  const existing = await findSafeguardIssue(github, owner, repo, marker, issueListRetry);
  const normalizedDrift = (Array.isArray(drift) ? drift : []).filter(
    (problem) => typeof problem === "string" && problem,
  );
  const healthy = auditSucceeded && normalizedDrift.length === 0;

  if (healthy) {
    if (!existing) {
      core.info("Production safeguards are healthy; no open drift alert exists.");
      return { created: false, resolved: false, reason: "no_alert" };
    }

    const runUrl = auditRunUrl(context, owner, repo);
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      title: `${titlePrefix}[RESOLVED] Production safeguard drift`,
      body: [
        marker,
        "## Production safeguard drift resolved",
        "",
        `The latest production safeguards audit completed successfully with no drift. [View the healthy audit run](${runUrl}).`,
        "",
        "This issue is closed. If safeguards drift again, the same issue will be reopened and updated.",
      ].join("\n"),
      state: "closed",
      assignees: [owner],
      labels: [labelName],
    });
    core.info(`Resolved production safeguard alert #${existing.number}.`);
    return { created: false, resolved: true, issue: existing };
  }

  await ensureSafeguardLabel(github, owner, repo, labelName);
  const body = safeguardIssueBody({
    context,
    owner,
    repo,
    drift: normalizedDrift,
    auditSucceeded,
    auditError,
    marker,
  });
  const request = {
    owner,
    repo,
    title: `${titlePrefix}[PRODUCTION SAFEGUARD DRIFT] Action required`,
    body,
    state: "open",
    assignees: [owner],
    labels: [labelName],
  };

  if (existing) {
    const updated = await github.rest.issues.update({
      ...request,
      issue_number: existing.number,
    });
    core.info(`Updated production safeguard alert #${existing.number}.`);
    return { created: false, updated: true, issue: updated.data };
  }

  const created = await github.rest.issues.create(request);
  core.info(`Created production safeguard alert #${created.data.number}.`);
  return { created: true, updated: false, issue: created.data };
}

async function runSafeguardIntegrationCheck({ github, context, core }) {
  const { owner, repo } = context.repo;
  const labelName = `production-safeguard-integration-${context.runId}`;
  const marker = `<!-- production-safeguard-drift-integration:${context.runId} -->`;
  let issueNumber;
  let labelWasCreated = false;
  let resolved = false;

  try {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: labelName });
    } catch (error) {
      if (error.status !== 404) throw error;
      labelWasCreated = true;
    }
    if (!labelWasCreated) {
      throw new Error(`Integration label already exists: ${labelName}`);
    }

    const alert = await runProductionSafeguardAlert({
      github,
      context,
      core,
      auditSucceeded: true,
      drift: ["integration check simulated safeguard drift"],
      labelName,
      marker,
      titlePrefix: "[INTEGRATION CHECK] ",
    });
    if (!alert.created || !alert.issue) {
      throw new Error(`Safeguard integration alert was not created: ${alert.reason ?? "unknown reason"}`);
    }
    issueNumber = alert.issue.number;

    const issue = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    const assignees = issue.data.assignees?.map((assignee) => assignee.login) ?? [];
    const labels = (issue.data.labels ?? []).map((label) =>
      typeof label === "string" ? label : label.name,
    );
    if (issue.data.state !== "open") {
      throw new Error(`Safeguard integration alert is not open: #${issueNumber}`);
    }
    if (!assignees.includes(owner)) {
      throw new Error(`Safeguard integration alert is not assigned to repository owner ${owner}`);
    }
    if (!labels.includes(labelName)) {
      throw new Error(`Safeguard integration alert is missing the ${labelName} label`);
    }
    if (!issue.data.body?.includes(marker)) {
      throw new Error(`Safeguard integration alert is missing its marker: #${issueNumber}`);
    }

    const resolution = await runProductionSafeguardAlert({
      github,
      context,
      core,
      auditSucceeded: true,
      drift: [],
      labelName,
      marker,
      titlePrefix: "[INTEGRATION CHECK] ",
    });
    if (!resolution.resolved) {
      throw new Error(`Safeguard integration alert was not resolved: #${issueNumber}`);
    }

    const closedIssue = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    if (closedIssue.data.state !== "closed") {
      throw new Error(`Safeguard integration alert was not closed: #${issueNumber}`);
    }
    resolved = true;
    core.info(`Safeguard alert integration check passed for temporary issue #${issueNumber}.`);
    return { created: true, resolved: true, issue: closedIssue.data };
  } finally {
    const cleanupErrors = [];
    if (issueNumber && !resolved) {
      try {
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          state: "closed",
          assignees: [owner],
          labels: [labelName],
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (labelWasCreated) {
      try {
        await github.rest.issues.deleteLabel({ owner, repo, name: labelName });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `Provider audit integration cleanup failed for ${owner}/${repo}`,
      );
    }
  }
}

async function runEmergencyBypassAlert({
  github,
  context,
  core,
  sha = context.payload.after,
  simulatedAssociatedPulls,
  integrationCheck = false,
}) {
  const { owner, repo } = context.repo;
  const associated = await github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: sha,
  });
  const pulls = simulatedAssociatedPulls ?? associated.data;
  const normalMerge = pulls.some(
    (pull) =>
      pull.merged_at &&
      pull.base?.ref === "main" &&
      pull.merge_commit_sha === sha,
  );

  if (normalMerge) {
    core.info(`Commit ${sha} is a normal pull-request merge; no emergency alert needed.`);
    return { created: false, reason: "normal_pull_request_merge" };
  }

  const actor = context.actor;
  const timestamp = context.payload.head_commit?.timestamp ?? new Date().toISOString();
  const comparisonUrl =
    context.payload.compare ??
    `${context.serverUrl}/${owner}/${repo}/compare/${sha}^...${sha}`;
  const commitUrl = `${context.serverUrl}/${owner}/${repo}/commit/${sha}`;
  const prefix = integrationCheck ? "[INTEGRATION CHECK]" : "[EMERGENCY PRODUCTION BYPASS]";
  const title = `${prefix} Direct push to main by ${actor}`;
  const marker = `<!-- emergency-production-bypass:${integrationCheck ? `check-${context.runId}` : sha} -->`;

  const existing = await findEmergencyBypassIssue(github, owner, repo, marker);
  if (existing) {
    core.info(`An emergency bypass alert already exists for ${sha}.`);
    return { created: false, reason: "duplicate" };
  }

  await ensureLabel(github, owner, repo);

  const body = [
    marker,
    "## Emergency production bypass used",
    "",
    "A direct push reached the protected `main` branch without a normal pull-request merge.",
    "",
    `- **Actor:** @${actor}`,
    `- **Commit:** [\`${sha}\`](${commitUrl})`,
    `- **Timestamp:** ${timestamp}`,
    `- **Comparison:** [Review all pushed changes](${comparisonUrl})`,
    "",
    integrationCheck
      ? "This temporary issue was created by the non-production alert integration check."
      : "Review the change and confirm the emergency bypass was intentional.",
  ].join("\n");

  const created = await github.rest.issues.create({
    owner,
    repo,
    title,
    body,
    assignees: [owner],
    labels: [LABEL],
  });
  return { created: true, issue: created.data };
}

async function runIntegrationCheck({ github, context, core }) {
  const sha = context.sha;
  let issueNumber;
  try {
    const alert = await runEmergencyBypassAlert({
      github,
      context,
      core,
      sha,
      integrationCheck: true,
      simulatedAssociatedPulls: [],
    });
    if (!alert.created || !alert.issue) {
      throw new Error(`Integration alert was not created: ${alert.reason ?? "unknown reason"}`);
    }
    issueNumber = alert.issue.number;

    const issue = await github.rest.issues.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
    });
    const assignees = issue.data.assignees?.map((assignee) => assignee.login) ?? [];
    const labels = issue.data.labels.map((label) =>
      typeof label === "string" ? label : label.name,
    );
    if (!assignees.includes(context.repo.owner)) {
      throw new Error(`Integration alert is not assigned to repository owner ${context.repo.owner}`);
    }
    if (!labels.includes(LABEL)) {
      throw new Error(`Integration alert is missing the ${LABEL} label`);
    }

    const normalMerge = await runEmergencyBypassAlert({
      github,
      context,
      core,
      sha,
      integrationCheck: true,
      simulatedAssociatedPulls: [
        {
          merged_at: new Date().toISOString(),
          base: { ref: "main" },
          merge_commit_sha: sha,
        },
      ],
    });
    if (normalMerge.created || normalMerge.reason !== "normal_pull_request_merge") {
      throw new Error("Simulated normal pull-request merge unexpectedly created an alert");
    }
    core.info(`Integration check passed for temporary issue #${issueNumber}.`);
  } finally {
    if (issueNumber) {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        state: "closed",
      });
    }
  }
}

function runTimestamp(run) {
  const timestamp = run.completed_at ?? run.updated_at ?? run.created_at;
  const milliseconds = Date.parse(timestamp ?? "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function workflowRunUrl({ context, owner, repo, run }) {
  return (
    run.html_url ??
    `${context.serverUrl}/${owner}/${repo}/actions/runs/${run.id}`
  );
}

async function runStaleIntegrationCheck({
  github,
  context,
  core,
  now = Date.now(),
  staleRunWindowMs = DEFAULT_STALE_RUN_WINDOW_MS,
}) {
  const { owner, repo } = context.repo;
  const runsResponse = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: INTEGRATION_WORKFLOW_FILE,
    event: "schedule",
    status: "completed",
    per_page: 100,
  });
  const runs = (runsResponse.data.workflow_runs ?? [])
    .slice()
    .sort((left, right) => (runTimestamp(right) ?? 0) - (runTimestamp(left) ?? 0));
  const latestRun = runs[0];
  const latestRunTimestamp = latestRun ? runTimestamp(latestRun) : null;
  const runIsRecent =
    latestRunTimestamp !== null &&
    now - latestRunTimestamp <= staleRunWindowMs;

  if (runIsRecent) {
    core.info(
      `The scheduled emergency integration check completed recently (run ${latestRun.id}); no stale-run alert needed.`,
    );
    return {
      created: false,
      reason: "recent_completed_run",
      run: latestRun,
    };
  }

  const runMarker = latestRun ? String(latestRun.id) : "none";
  const marker = `<!-- ${STALE_RUN_LABEL}:${runMarker} -->`;
  const existing = await github.rest.issues.listForRepo({
    owner,
    repo,
    state: "all",
    creator: "github-actions[bot]",
    per_page: 100,
  });
  if (existing.data.some((issue) => issue.body?.includes(marker))) {
    core.info(`A stale-run alert already exists for scheduled run ${runMarker}.`);
    return { created: false, reason: "duplicate", run: latestRun };
  }

  await ensureLabel(
    github,
    owner,
    repo,
    STALE_RUN_LABEL,
    "The emergency production bypass integration check has gone stale",
    "D93F0B",
  );

  const lastRunText = latestRun
    ? `The last completed scheduled run was [run ${latestRun.id}](${workflowRunUrl({
        context,
        owner,
        repo,
        run: latestRun,
      })}) at ${latestRun.completed_at ?? latestRun.updated_at ?? latestRun.created_at}.`
    : "No completed scheduled run was found in the workflow history.";
  const created = await github.rest.issues.create({
    owner,
    repo,
    title: "[ALERT] Emergency bypass integration check is stale",
    body: [
      marker,
      "## Emergency bypass integration check is stale",
      "",
      lastRunText,
      "",
      `The scheduled workflow has not completed within ${Math.round(
        staleRunWindowMs / (24 * 60 * 60 * 1000),
      )} days. Check whether GitHub scheduling is disabled or delayed, then run the integration check manually if needed.`,
      "",
      "This monitor only reads GitHub Actions run history and does not deploy or push to `main`.",
    ].join("\n"),
    assignees: [owner],
    labels: [STALE_RUN_LABEL],
  });
  return { created: true, issue: created.data, run: latestRun };
}

async function runProviderAnalyticsAuditStaleCheck({
  github,
  context,
  core,
  now = Date.now(),
  staleRunWindowMs = DEFAULT_PROVIDER_AUDIT_STALE_WINDOW_MS,
  workflowRuns,
  labelName = PROVIDER_AUDIT_STALE_LABEL,
  marker = PROVIDER_AUDIT_STALE_MARKER,
  titlePrefix = "",
}) {
  const { owner, repo } = context.repo;
  const runsResponse = workflowRuns
    ? { data: { workflow_runs: workflowRuns } }
    : await github.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: PROVIDER_AUDIT_WORKFLOW_FILE,
        status: "completed",
        per_page: 100,
      });
  const runs = (runsResponse.data.workflow_runs ?? [])
    .slice()
    .sort((left, right) => (runTimestamp(right) ?? 0) - (runTimestamp(left) ?? 0));
  const latestRun = runs[0];
  const latestRunTimestamp = latestRun ? runTimestamp(latestRun) : null;
  const runIsRecent =
    latestRunTimestamp !== null &&
    now - latestRunTimestamp <= staleRunWindowMs;
  const existing = await findSafeguardIssue(
    github,
    owner,
    repo,
    marker,
  );

  if (runIsRecent) {
    if (!existing || existing.state === "closed") {
      core.info("The provider analytics report audit completed recently; no open stale-run alert exists.");
      return { created: false, resolved: false, reason: "recent_completed_run", run: latestRun };
    }

    const updated = await github.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      title: `${titlePrefix}[RESOLVED] Provider analytics report audit resumed`,
      body: [
        marker,
        "## Provider analytics report audit resumed",
        "",
        `The audit completed again in [run ${latestRun.id}](${workflowRunUrl({
          context,
          owner,
          repo,
          run: latestRun,
        })}).`,
        "",
        "This issue is closed. The monitor will reopen it if completed audit runs become stale again.",
      ].join("\n"),
      state: "closed",
      assignees: [owner],
      labels: [labelName],
    });
    core.info(`Resolved provider analytics audit stale-run alert #${existing.number}.`);
    return { created: false, resolved: true, issue: updated.data, run: latestRun };
  }

  await ensureLabel(
    github,
    owner,
    repo,
    labelName,
    "The provider analytics report audit has stopped completing",
    "D93F0B",
  );
  const lastRunText = latestRun
    ? `The last completed audit was [run ${latestRun.id}](${workflowRunUrl({
        context,
        owner,
        repo,
        run: latestRun,
      })}) at ${latestRun.completed_at ?? latestRun.updated_at ?? latestRun.created_at}.`
    : "No completed audit run was found in the workflow history.";
  const request = {
    owner,
    repo,
    title: `${titlePrefix}[ALERT] Provider analytics report audit is stale`,
    body: [
      marker,
      "## Provider analytics report audit is stale",
      "",
      lastRunText,
      "",
      `No successful or failed audit run has completed within ${Math.round(
        staleRunWindowMs / (24 * 60 * 60 * 1000),
      )} days. Check whether GitHub scheduling is disabled or delayed, then run the audit manually.`,
      "",
      "This monitor reads only GitHub Actions run metadata. It cannot deploy, push code, or access analytics credentials or event payloads.",
    ].join("\n"),
    state: "open",
    assignees: [owner],
    labels: [labelName],
  };

  if (existing) {
    const updated = await github.rest.issues.update({
      ...request,
      issue_number: existing.number,
    });
    core.info(`Updated provider analytics audit stale-run alert #${existing.number}.`);
    return { created: false, updated: true, issue: updated.data, run: latestRun };
  }

  const created = await github.rest.issues.create(request);
  core.info(`Created provider analytics audit stale-run alert #${created.data.number}.`);
  return { created: true, updated: false, issue: created.data, run: latestRun };
}

async function runProviderAnalyticsAuditIntegrationCheck({ github, context, core }) {
  const { owner, repo } = context.repo;
  const labelName = `provider-audit-stale-integration-${context.runId}`;
  const marker = `<!-- provider-analytics-report-audit-stale-integration:${context.runId} -->`;
  const titlePrefix = "[INTEGRATION CHECK] ";
  const now = Date.now();
  const staleRun = {
    id: `integration-stale-${context.runId}`,
    completed_at: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const healthyRun = {
    id: `integration-healthy-${context.runId}`,
    completed_at: new Date(now).toISOString(),
  };
  let issueNumber;
  let labelWasCreated = false;
  let resolved = false;

  try {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: labelName });
    } catch (error) {
      if (error.status !== 404) throw error;
      labelWasCreated = true;
    }
    if (!labelWasCreated) {
      throw new Error(`Integration label already exists: ${labelName}`);
    }

    const stale = await runProviderAnalyticsAuditStaleCheck({
      github,
      context,
      core,
      now,
      workflowRuns: [staleRun],
      labelName,
      marker,
      titlePrefix,
    });
    if (!stale.created || !stale.issue) {
      throw new Error(`Provider audit integration alert was not created`);
    }
    issueNumber = stale.issue.number;

    async function verifyIssue(expectedState) {
      const response = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
      const issue = response.data;
      const assignees = issue.assignees?.map((assignee) => assignee.login) ?? [];
      const labels = (issue.labels ?? []).map((label) =>
        typeof label === "string" ? label : label.name,
      );
      if (issue.state !== expectedState) {
        throw new Error(`Provider audit integration alert #${issueNumber} is not ${expectedState}`);
      }
      if (!assignees.includes(owner)) {
        throw new Error(`Provider audit integration alert is not assigned to ${owner}`);
      }
      if (!labels.includes(labelName)) {
        throw new Error(`Provider audit integration alert is missing label ${labelName}`);
      }
      if (!issue.body?.includes(marker)) {
        throw new Error(`Provider audit integration alert #${issueNumber} is missing its marker`);
      }
      return issue;
    }

    await verifyIssue("open");
    const firstResolution = await runProviderAnalyticsAuditStaleCheck({
      github,
      context,
      core,
      now,
      workflowRuns: [healthyRun],
      labelName,
      marker,
      titlePrefix,
    });
    if (!firstResolution.resolved) {
      throw new Error(`Provider audit integration alert #${issueNumber} was not resolved`);
    }
    await verifyIssue("closed");

    const reopened = await runProviderAnalyticsAuditStaleCheck({
      github,
      context,
      core,
      now,
      workflowRuns: [staleRun],
      labelName,
      marker,
      titlePrefix,
    });
    if (!reopened.updated) {
      throw new Error(`Provider audit integration alert #${issueNumber} was not reopened`);
    }
    await verifyIssue("open");

    const finalResolution = await runProviderAnalyticsAuditStaleCheck({
      github,
      context,
      core,
      now,
      workflowRuns: [healthyRun],
      labelName,
      marker,
      titlePrefix,
    });
    if (!finalResolution.resolved) {
      throw new Error(`Provider audit integration alert #${issueNumber} was not finally resolved`);
    }
    const closedIssue = await verifyIssue("closed");
    resolved = true;
    core.info(`Provider audit alert integration check passed for issue #${issueNumber}.`);
    return { created: true, reopened: true, resolved: true, issue: closedIssue };
  } finally {
    if (issueNumber && !resolved) {
      await github.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed",
        assignees: [owner],
        labels: [labelName],
      });
    }
    if (labelWasCreated) {
      await github.rest.issues.deleteLabel({ owner, repo, name: labelName });
    }
  }
}

async function runProviderAnalyticsAuditIntegrationCheckReminder({
  github,
  context,
  core,
  now = Date.now(),
  overdueWindowMs = DEFAULT_PROVIDER_INTEGRATION_CHECK_WINDOW_MS,
  workflowRuns,
}) {
  const { owner, repo } = context.repo;
  const runsResponse = workflowRuns
    ? { data: { workflow_runs: workflowRuns } }
    : await github.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: PROVIDER_AUDIT_MONITOR_WORKFLOW_FILE,
        event: "workflow_dispatch",
        status: "completed",
        per_page: 100,
      });
  const successfulChecks = (runsResponse.data.workflow_runs ?? [])
    .filter(
      (run) =>
        run.conclusion === "success" &&
        run.display_title === PROVIDER_INTEGRATION_CHECK_RUN_NAME,
    )
    .sort((left, right) => (runTimestamp(right) ?? 0) - (runTimestamp(left) ?? 0));
  const latestRun = successfulChecks[0];
  const latestTimestamp = latestRun ? runTimestamp(latestRun) : null;
  const recent =
    latestTimestamp !== null &&
    now - latestTimestamp <= overdueWindowMs;
  const existing = await findSafeguardIssue(
    github,
    owner,
    repo,
    PROVIDER_INTEGRATION_CHECK_REMINDER_MARKER,
  );

  if (recent) {
    if (!existing || existing.state === "closed") {
      core.info("The provider alert integration check succeeded recently; no reminder is open.");
      return { created: false, resolved: false, reason: "recent_successful_check", run: latestRun };
    }
    const updated = await github.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      title: "[RESOLVED] Provider alert integration check completed",
      body: [
        PROVIDER_INTEGRATION_CHECK_REMINDER_MARKER,
        "## Provider alert integration check completed",
        "",
        `The manual integration check succeeded in [run ${latestRun.id}](${workflowRunUrl({
          context,
          owner,
          repo,
          run: latestRun,
        })}).`,
        "",
        "This reminder is closed. It will reopen if the check becomes overdue again.",
      ].join("\n"),
      state: "closed",
      assignees: [owner],
      labels: [PROVIDER_INTEGRATION_CHECK_REMINDER_LABEL],
    });
    return { created: false, resolved: true, issue: updated.data, run: latestRun };
  }

  await ensureLabel(
    github,
    owner,
    repo,
    PROVIDER_INTEGRATION_CHECK_REMINDER_LABEL,
    "The manual provider alert integration check is overdue",
    "FBCA04",
  );
  const lastRunText = latestRun
    ? `The last successful manual check was [run ${latestRun.id}](${workflowRunUrl({
        context,
        owner,
        repo,
        run: latestRun,
      })}) at ${latestRun.completed_at ?? latestRun.updated_at ?? latestRun.created_at}.`
    : "No successful manual provider alert integration check was found in the workflow history.";
  const request = {
    owner,
    repo,
    title: "[REMINDER] Run the provider alert integration check",
    body: [
      PROVIDER_INTEGRATION_CHECK_REMINDER_MARKER,
      "## Provider alert integration check is overdue",
      "",
      lastRunText,
      "",
      `The check has not succeeded within ${Math.round(
        overdueWindowMs / (24 * 60 * 60 * 1000),
      )} days. Run this workflow manually with \`integration_check\` enabled.`,
      "",
      "This reminder reads only GitHub Actions run metadata. It cannot deploy, push code, or access analytics credentials or event payloads.",
    ].join("\n"),
    state: "open",
    assignees: [owner],
    labels: [PROVIDER_INTEGRATION_CHECK_REMINDER_LABEL],
  };
  if (existing) {
    const updated = await github.rest.issues.update({
      ...request,
      issue_number: existing.number,
    });
    return { created: false, updated: true, issue: updated.data, run: latestRun };
  }
  const created = await github.rest.issues.create(request);
  return { created: true, updated: false, issue: created.data, run: latestRun };
}

async function runProviderAnalyticsAuditIntegrationCheckFailureAlert({
  github,
  context,
  core,
  currentConclusion,
  failureThreshold = DEFAULT_PROVIDER_INTEGRATION_CHECK_FAILURE_THRESHOLD,
  workflowRuns,
}) {
  const { owner, repo } = context.repo;
  if (currentConclusion !== "success" && currentConclusion !== "failure") {
    core.info(`Ignoring provider alert integration check conclusion: ${currentConclusion}`);
    return { created: false, resolved: false, reason: "unsupported_conclusion" };
  }

  const runsResponse = workflowRuns
    ? { data: { workflow_runs: workflowRuns } }
    : await github.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: PROVIDER_AUDIT_MONITOR_WORKFLOW_FILE,
        event: "workflow_dispatch",
        status: "completed",
        per_page: 100,
      });
  const priorChecks = (runsResponse.data.workflow_runs ?? [])
    .filter((run) => run.display_title === PROVIDER_INTEGRATION_CHECK_RUN_NAME)
    .sort((left, right) => (runTimestamp(right) ?? 0) - (runTimestamp(left) ?? 0));
  const existing = await findSafeguardIssue(
    github,
    owner,
    repo,
    PROVIDER_INTEGRATION_CHECK_FAILURE_MARKER,
  );

  if (currentConclusion === "success") {
    if (!existing || existing.state === "closed") {
      core.info("The provider alert integration check succeeded; no failure alert is open.");
      return { created: false, resolved: false, reason: "successful_check" };
    }
    const updated = await github.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      title: "[RESOLVED] Provider alert integration checks recovered",
      body: [
        PROVIDER_INTEGRATION_CHECK_FAILURE_MARKER,
        "## Provider alert integration checks recovered",
        "",
        `The latest manual integration check succeeded. [View the successful run](${auditRunUrl(
          context,
          owner,
          repo,
        )}).`,
        "",
        "This issue is closed. It will reopen if manual integration checks repeatedly fail again.",
      ].join("\n"),
      state: "closed",
      assignees: [owner],
      labels: [PROVIDER_INTEGRATION_CHECK_FAILURE_LABEL],
    });
    return { created: false, resolved: true, issue: updated.data };
  }

  let consecutiveFailures = 1;
  for (const run of priorChecks) {
    if (run.conclusion !== "failure") break;
    consecutiveFailures += 1;
  }
  if (consecutiveFailures < failureThreshold) {
    core.info(
      `Provider alert integration check failed ${consecutiveFailures} consecutive time(s); alert threshold is ${failureThreshold}.`,
    );
    return { created: false, resolved: false, reason: "below_threshold", consecutiveFailures };
  }

  await ensureLabel(
    github,
    owner,
    repo,
    PROVIDER_INTEGRATION_CHECK_FAILURE_LABEL,
    "Manual provider alert integration checks are repeatedly failing",
    "B60205",
  );
  const request = {
    owner,
    repo,
    title: "[ALERT] Provider alert integration checks are failing",
    body: [
      PROVIDER_INTEGRATION_CHECK_FAILURE_MARKER,
      "## Provider alert integration checks are repeatedly failing",
      "",
      `${consecutiveFailures} consecutive manual integration checks have failed, including [the latest run](${auditRunUrl(
        context,
        owner,
        repo,
      )}).`,
      "",
      "Investigate the failed checks and rerun this workflow manually with `integration_check` enabled.",
      "",
      "This alert reads only GitHub Actions run metadata. It cannot deploy, push code, or access analytics credentials or event payloads.",
    ].join("\n"),
    state: "open",
    assignees: [owner],
    labels: [PROVIDER_INTEGRATION_CHECK_FAILURE_LABEL],
  };
  if (existing) {
    const updated = await github.rest.issues.update({
      ...request,
      issue_number: existing.number,
    });
    return {
      created: false,
      updated: true,
      issue: updated.data,
      consecutiveFailures,
    };
  }
  const created = await github.rest.issues.create(request);
  return {
    created: true,
    updated: false,
    issue: created.data,
    consecutiveFailures,
  };
}

module.exports = {
  DEFAULT_PROVIDER_INTEGRATION_CHECK_FAILURE_THRESHOLD,
  DEFAULT_PROVIDER_INTEGRATION_CHECK_WINDOW_MS,
  DEFAULT_PROVIDER_AUDIT_STALE_WINDOW_MS,
  DEFAULT_STALE_RUN_WINDOW_MS,
  INTEGRATION_WORKFLOW_FILE,
  LABEL,
  PROVIDER_AUDIT_STALE_LABEL,
  PROVIDER_AUDIT_STALE_MARKER,
  PROVIDER_AUDIT_WORKFLOW_FILE,
  PROVIDER_AUDIT_MONITOR_WORKFLOW_FILE,
  PROVIDER_INTEGRATION_CHECK_REMINDER_LABEL,
  PROVIDER_INTEGRATION_CHECK_REMINDER_MARKER,
  PROVIDER_INTEGRATION_CHECK_FAILURE_LABEL,
  PROVIDER_INTEGRATION_CHECK_FAILURE_MARKER,
  STALE_RUN_LABEL,
  SAFEGUARD_LABEL,
  SAFEGUARD_MARKER,
  runEmergencyBypassAlert,
  runIntegrationCheck,
  runProviderAnalyticsAuditIntegrationCheck,
  runProviderAnalyticsAuditIntegrationCheckFailureAlert,
  runProviderAnalyticsAuditIntegrationCheckReminder,
  runProviderAnalyticsAuditStaleCheck,
  runProductionSafeguardAlert,
  runSafeguardIntegrationCheck,
  runStaleIntegrationCheck,
};
