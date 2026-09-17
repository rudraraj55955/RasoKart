import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findBranchProtectionDrift,
  findDeploymentApprovalDrift,
  REQUIRED_VALIDATION_CONTEXT,
} from "./branch-protection-audit";

function protectedMain() {
  return {
    required_pull_request_reviews: {},
    required_status_checks: {
      strict: true,
      checks: [{ context: REQUIRED_VALIDATION_CONTEXT, app_id: 15368 }],
    },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    enforce_admins: { enabled: true },
  };
}

test("accepts the complete main-branch protection policy", () => {
  assert.deepEqual(findBranchProtectionDrift(protectedMain()), []);
});

const driftCases = [
  {
    name: "pull request requirement",
    change: { required_pull_request_reviews: null },
    expected: "pull requests are not required before merging",
  },
  {
    name: "strict status checks",
    change: { required_status_checks: { strict: false, contexts: [REQUIRED_VALIDATION_CONTEXT] } },
    expected: "required status checks are not strict",
  },
  {
    name: "validation context",
    change: { required_status_checks: { strict: true, checks: [{ context: "another check" }] } },
    expected: `required validation context is missing: ${REQUIRED_VALIDATION_CONTEXT}`,
  },
  {
    name: "force-push blocking",
    change: { allow_force_pushes: { enabled: true } },
    expected: "force pushes are not blocked",
  },
  {
    name: "deletion blocking",
    change: { allow_deletions: { enabled: true } },
    expected: "branch deletion is not blocked",
  },
  {
    name: "administrator enforcement",
    change: { enforce_admins: { enabled: false } },
    expected: "branch protection is not enforced for administrators",
  },
  {
    name: "missing administrator enforcement response",
    change: { enforce_admins: null },
    expected: "branch protection is not enforced for administrators",
  },
] as const;

for (const driftCase of driftCases) {
  test(`identifies drift in ${driftCase.name}`, () => {
    const drift = findBranchProtectionDrift({ ...protectedMain(), ...driftCase.change });
    assert.equal(drift.some((message) => message.includes(driftCase.expected)), true);
  });
}

test("reports all missing status-check safeguards", () => {
  const drift = findBranchProtectionDrift({
    ...protectedMain(),
    required_status_checks: null,
  });
  assert.deepEqual(drift, ["required status checks are not configured"]);
});

test("accepts required production environment reviewers when temporary auto-deploy is disabled", () => {
  const drift = findDeploymentApprovalDrift(
    {
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "User", reviewer: { login: "repo-owner" } }],
        },
      ],
    },
    "false",
    "production-sensitive",
    "user:repo-owner",
  );
  assert.deepEqual(drift, []);
});

test("accepts an expected production team reviewer", () => {
  const drift = findDeploymentApprovalDrift(
    {
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "Team", reviewer: { slug: "release-engineering" } }],
        },
      ],
    },
    "false",
    "production-sensitive",
    "team:release-engineering",
  );
  assert.deepEqual(drift, []);
});

test("reports the expected approver when it is replaced", () => {
  const drift = findDeploymentApprovalDrift(
    {
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "User", reviewer: { login: "unexpected-reviewer" } }],
        },
      ],
    },
    "false",
    "production-sensitive",
    "user:repo-owner,team:release-engineering",
  );
  assert.deepEqual(drift, [
    "environment safeguard drift: production-sensitive is missing expected approver user:repo-owner",
    "environment safeguard drift: production-sensitive is missing expected approver team:release-engineering",
  ]);
});

test("accepts missing reviewers only while temporary auto-deploy is explicitly enabled", () => {
  assert.deepEqual(findDeploymentApprovalDrift({ protection_rules: [] }, "true"), []);
});

for (const disabledValue of ["false", undefined, "TRUE", true]) {
  test(`reports environment approval drift when auto-deploy value is ${String(disabledValue)}`, () => {
    const drift = findDeploymentApprovalDrift({ protection_rules: [] }, disabledValue);
    assert.match(
      drift[0] ?? "",
      /production-sensitive has no required reviewers while TEMP_AUTO_DEPLOY_ENABLED is disabled/,
    );
    assert.match(drift[1] ?? "", /missing expected approver user:rudraraj55955/);
  });
}

test("reports drift when the required-reviewers rule exists but has no reviewers", () => {
  const drift = findDeploymentApprovalDrift(
    { protection_rules: [{ type: "required_reviewers", reviewers: [] }] },
    "false",
  );
  assert.equal(drift.length, 2);
  assert.match(drift[0] ?? "", /production-sensitive has no required reviewers/);
  assert.match(drift[1] ?? "", /missing expected approver user:rudraraj55955/);
});
