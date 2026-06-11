import { execSync } from "child_process";

const GITHUB_REPO =
  process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";
const REMOTE_NAME = "github";

function run(cmd: string, opts: { stdio?: "pipe" | "inherit" } = {}) {
  return execSync(cmd, { stdio: opts.stdio ?? "pipe" });
}

function resetRemote() {
  try {
    run(
      `git remote set-url ${REMOTE_NAME} https://github.com/${GITHUB_REPO}.git`,
    );
  } catch {
  }
}

async function main() {
  const token = process.env["GITHUB_TOKEN"];

  if (!token) {
    console.warn(
      "GITHUB_SYNC: Skipping — GITHUB_TOKEN secret is not set.",
    );
    return;
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${GITHUB_REPO}.git`;

  try {
    run(`git remote get-url ${REMOTE_NAME}`);
    run(`git remote set-url ${REMOTE_NAME} ${remoteUrl}`);
  } catch {
    run(`git remote add ${REMOTE_NAME} ${remoteUrl}`);
  }

  try {
    console.log(`GITHUB_SYNC: Pushing to ${GITHUB_REPO}...`);
    try {
      run(`git fetch ${REMOTE_NAME} main`, { stdio: "inherit" });
    } catch {
    }
    run(`git push ${REMOTE_NAME} HEAD:main --force`, { stdio: "inherit" });
    console.log("GITHUB_SYNC: Sync complete.");
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message.replace(token, "<REDACTED>")
        : String(err).replace(token, "<REDACTED>");
    throw new Error(`Push failed — ${message}`);
  } finally {
    resetRemote();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`GITHUB_SYNC: ${message}`);
  process.exit(1);
});
