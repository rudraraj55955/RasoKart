import { createAuthenticatedGitRunner } from "./github-sync-git-auth.js";

const token = process.env["TEST_GITHUB_SYNC_TOKEN"];
const remoteUrl = process.env["TEST_GITHUB_SYNC_REMOTE"];
const operationId = process.env["SYNC_OPERATION_ID"];
const repoDir = process.env["TEST_GITHUB_SYNC_REPO_DIR"];
const askpassRoot = process.env["TEST_GITHUB_SYNC_ASKPASS_ROOT"];

if (!token || !remoteUrl || !operationId || !repoDir || !askpassRoot) {
  process.exit(2);
}

const runner = createAuthenticatedGitRunner(token, {
  cwd: repoDir,
  env: process.env,
  tempDirectory: askpassRoot,
});

try {
  runner.run(["fetch", "--no-tags", remoteUrl, `main:refs/github-sync/${operationId}/main`]);
  runner.run(["push", remoteUrl, "HEAD:main", "--force"]);
} catch {
  // The parent test asserts the exit code. Do not echo command failures because
  // credential-oriented tests must never normalize printing auth diagnostics.
  process.exitCode = 1;
} finally {
  runner.dispose();
}