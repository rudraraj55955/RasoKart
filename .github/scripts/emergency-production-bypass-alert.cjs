const LABEL = "emergency-production-bypass";
const SAFEGUARD_LABEL = "production-safeguard-drift";
const SAFEGUARD_MARKER = "<!-- production-safeguard-drift -->";

async function ensureLabel(github, owner, repo) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: LABEL });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: LABEL,
      color: "B60205",
      description: "A direct push bypassed the normal production pull-request gates",
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

async function findSafeguardIssue(
  github,
  owner,
  repo,
  marker = SAFEGUARD_MARKER,
) {
  for (let page = 1; ; page += 1) {
    const existing = await github.rest.issues.listForRepo({
      owner,
      repo,
      state: "all",
      creator: "github-actions[bot]",
      per_page: 100,
      page,
    });
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
}) {
  const { owner, repo } = context.repo;
  const existing = await findSafeguardIssue(github, owner, repo, marker);
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

  const existing = await github.rest.issues.listForRepo({
    owner,
    repo,
    state: "all",
    creator: "github-actions[bot]",
    per_page: 100,
  });
  if (existing.data.some((issue) => issue.body?.includes(marker))) {
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

module.exports = {
  LABEL,
  SAFEGUARD_LABEL,
  SAFEGUARD_MARKER,
  runEmergencyBypassAlert,
  runIntegrationCheck,
  runProductionSafeguardAlert,
  runSafeguardIntegrationCheck,
};
