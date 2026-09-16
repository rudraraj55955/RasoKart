import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS_DIR = join(ROOT, ".github/workflows");
const GUARDED_WORKFLOW = "production-deploy.yml";
const DEPLOY_JOBS = [
  "auto_frontend_deploy",
  "deploy_full_auto",
  "sensitive_production_deploy",
] as const;

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