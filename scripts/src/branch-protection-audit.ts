import { pathToFileURL } from "node:url";
import { appendFileSync } from "node:fs";

export const REQUIRED_VALIDATION_CONTEXT =
  "Production Deploy / Validate (install, typecheck, build, test)";
export const PRODUCTION_ENVIRONMENT = "production-sensitive";
export const TEMP_AUTO_DEPLOY_VARIABLE = "TEMP_AUTO_DEPLOY_ENABLED";

export const EXPECTED_PRODUCTION_APPROVERS_VARIABLE = "EXPECTED_PRODUCTION_APPROVERS";
type StatusCheck = { context?: unknown };
type BranchProtection = {
  required_pull_request_reviews?: unknown;
  required_status_checks?: {
    strict?: unknown;
    contexts?: unknown;
    checks?: unknown;
  } | null;
  allow_force_pushes?: { enabled?: unknown } | null;
  allow_deletions?: { enabled?: unknown } | null;
  enforce_admins?: { enabled?: unknown } | null;
};
type EnvironmentProtection = {
  protection_rules?: unknown;
};
type EnvironmentProtectionRule = {
  type?: unknown;
  reviewers?: unknown;
};
type RepositoryVariable = {
  value?: unknown;
};

function normalizeApproverPolicy(policy: string): string[] {
  return policy
    .split(",")
    .map((approver) => approver.trim().toLowerCase())
    .filter(Boolean);
}
export function findBranchProtectionDrift(
  protection: BranchProtection,
  requiredContext = REQUIRED_VALIDATION_CONTEXT,
): string[] {
  const drift: string[] = [];

  if (!protection.required_pull_request_reviews) {
    drift.push("pull requests are not required before merging");
  }

  const statusChecks = protection.required_status_checks;
  if (!statusChecks) {
    drift.push("required status checks are not configured");
  } else {
    if (statusChecks.strict !== true) {
      drift.push("required status checks are not strict (branches need not be up to date)");
    }

    const contexts = new Set<string>();
    if (Array.isArray(statusChecks.contexts)) {
      for (const context of statusChecks.contexts) {
        if (typeof context === "string") contexts.add(context);
      }
    }
    if (Array.isArray(statusChecks.checks)) {
      for (const check of statusChecks.checks as StatusCheck[]) {
        if (typeof check?.context === "string") contexts.add(check.context);
      }
    }
    if (!contexts.has(requiredContext)) {
      drift.push(`required validation context is missing: ${requiredContext}`);
    }
  }

  if (protection.allow_force_pushes?.enabled !== false) {
    drift.push("force pushes are not blocked");
  }
  if (protection.allow_deletions?.enabled !== false) {
    drift.push("branch deletion is not blocked");
  }
  if (protection.enforce_admins?.enabled !== false) {
    drift.push("administrator emergency bypass is not preserved");
  }

  return drift;
}

export function findDeploymentApprovalDrift(
  environment: EnvironmentProtection,
  temporaryAutoDeployValue: unknown,
  environmentName = PRODUCTION_ENVIRONMENT,
  expectedApproversPolicy = DEFAULT_EXPECTED_PRODUCTION_APPROVERS,
): string[] {
  const rules = Array.isArray(environment.protection_rules)
    ? (environment.protection_rules as EnvironmentProtectionRule[])
    : [];
  const reviewerRule = rules.find((rule) => rule?.type === "required_reviewers");
  const reviewers = Array.isArray(reviewerRule?.reviewers) ? reviewerRule.reviewers : [];
  const temporaryAutoDeployEnabled = temporaryAutoDeployValue === "true";

  if (temporaryAutoDeployEnabled) return [];

  const drift: string[] = [];
  if (reviewers.length === 0) {
    drift.push(
      `environment safeguard drift: ${environmentName} has no required reviewers while ${TEMP_AUTO_DEPLOY_VARIABLE} is disabled`,
    );
  }

  const configuredApprovers = new Set(
    reviewers
      .map((reviewer) => reviewerIdentity(reviewer))
      .filter((identity): identity is string => identity !== undefined),
  );
  for (const expectedApprover of normalizeApproverPolicy(expectedApproversPolicy)) {
    if (!configuredApprovers.has(expectedApprover)) {
      drift.push(
        `environment safeguard drift: ${environmentName} is missing expected approver ${expectedApprover}`,
      );
    }
  }

  return drift;
}

async function readGitHubJson(
  url: string,
  token: string,
  settingName: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `GitHub API could not read ${settingName} (HTTP ${response.status}). ` +
        `Ensure BRANCH_PROTECTION_AUDIT_TOKEN has Administration: read and Variables: read access. ${detail}`,
    );
  }

  return response.json();
}

function writeWorkflowOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.PROTECTED_BRANCH ?? "main";
  const expectedApproversPolicy =
    process.env[EXPECTED_PRODUCTION_APPROVERS_VARIABLE] ??
    DEFAULT_EXPECTED_PRODUCTION_APPROVERS;

  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  }

  const apiBase = `https://api.github.com/repos/${repository}`;
  const variableUrl =
    `${apiBase}/actions/variables/${encodeURIComponent(TEMP_AUTO_DEPLOY_VARIABLE)}`;
  const [branchProtection, environmentProtection, variableResponse] = await Promise.all([
    readGitHubJson(
      `${apiBase}/branches/${encodeURIComponent(branch)}/protection`,
      token,
      `branch protection for ${branch}`,
    ),
    readGitHubJson(
      `${apiBase}/environments/${encodeURIComponent(PRODUCTION_ENVIRONMENT)}`,
      token,
      `environment ${PRODUCTION_ENVIRONMENT}`,
    ),
    fetch(variableUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }),
  ]);

  let temporaryAutoDeployValue: unknown;
  if (variableResponse.status === 404) {
    temporaryAutoDeployValue = undefined;
  } else if (!variableResponse.ok) {
    const detail = (await variableResponse.text()).slice(0, 500);
    throw new Error(
      `GitHub API could not read repository variable ${TEMP_AUTO_DEPLOY_VARIABLE} ` +
        `(HTTP ${variableResponse.status}). Ensure BRANCH_PROTECTION_AUDIT_TOKEN has ` +
        `Variables: read access. ${detail}`,
    );
  } else {
    temporaryAutoDeployValue = ((await variableResponse.json()) as RepositoryVariable).value;
  }

  const drift = [
    ...findBranchProtectionDrift(branchProtection as BranchProtection),
    ...findDeploymentApprovalDrift(
      environmentProtection as EnvironmentProtection,
      temporaryAutoDeployValue,
      PRODUCTION_ENVIRONMENT,
      expectedApproversPolicy,
    ),
  ];
  if (drift.length > 0) {
    writeWorkflowOutput("drift", JSON.stringify(drift));
    console.error(`Production safeguard drift detected for ${repository}:`);
    for (const problem of drift) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }

  writeWorkflowOutput("drift", "[]");
  console.log(
    `Production safeguards verified for ${repository}:${branch} and ${PRODUCTION_ENVIRONMENT}`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    writeWorkflowOutput("audit_error", JSON.stringify(message));
    console.error(message);
    process.exitCode = 1;
  });
}

function reviewerIdentity(reviewer: unknown): string | undefined {
  if (!reviewer || typeof reviewer !== "object") return undefined;

  const entry = reviewer as {
    type?: unknown;
    reviewer?: { login?: unknown; slug?: unknown; name?: unknown };
  };
  const type =
    entry.type === "User" ? "user" : entry.type === "Team" ? "team" : undefined;
  if (!type || !entry.reviewer) return undefined;

  const identity =
    type === "user" ? entry.reviewer.login : entry.reviewer.slug ?? entry.reviewer.name;
  return typeof identity === "string" ? `${type}:${identity.toLowerCase()}` : undefined;
}

export const DEFAULT_EXPECTED_PRODUCTION_APPROVERS = "user:rudraraj55955";
