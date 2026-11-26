import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TEST_TOKEN = "concurrency-regression-test-token";
const CREDENTIAL_FREE_REMOTE = "https://github.com/example/RasoKart.git";
const WORKER_PATH = fileURLToPath(
  new URL("./github-sync-git-auth.test-worker.ts", import.meta.url),
);

function writeFakeGit(binDir: string): void {
  const fakeGitPath = join(binDir, "git");
  writeFileSync(
    fakeGitPath,
    `#!/bin/sh
set -eu

if [ "$1" = "remote" ]; then
  echo "shared remote mutation attempted" >&2
  exit 91
fi

if [ "$1" = "fetch" ]; then
  : > "$GIT_SYNC_BARRIER_DIR/$SYNC_OPERATION_ID"
  attempts=0
  while [ "$(find "$GIT_SYNC_BARRIER_DIR" -type f | wc -l)" -lt "$GIT_SYNC_BARRIER_EXPECTED" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 200 ]; then
      echo "concurrency barrier timed out" >&2
      exit 94
    fi
    sleep 0.01
  done
fi

if [ -z "\${GIT_ASKPASS:-}" ] || [ ! -x "$GIT_ASKPASS" ]; then
  echo "missing per-command askpass helper" >&2
  exit 92
fi

username="$("$GIT_ASKPASS" "Username for 'https://github.com':")"
password="$("$GIT_ASKPASS" "Password for 'https://github.com':")"
if [ "$username" != "x-access-token" ] || [ "$password" != "$EXPECTED_GITHUB_SYNC_TOKEN" ]; then
  echo "authentication rejected" >&2
  exit 93
fi

printf '%s:%s:authenticated\\n' "$SYNC_OPERATION_ID" "$1" >> "$GIT_SYNC_TEST_LOG"
sleep 0.05

if [ "\${FAKE_GIT_FAIL_PUSH:-0}" = "1" ] && [ "$1" = "push" ]; then
  exit 95
fi
`,
    { encoding: "utf-8", mode: 0o700 },
  );
}

function runWorker(
  fixture: {
    binDir: string;
    repoDir: string;
    logFile: string;
    barrierDir: string;
    askpassRoot: string;
  },
  id: string,
  expectedAtBarrier: number,
  failPush = false,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx/esm", WORKER_PATH],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${fixture.binDir}:${process.env["PATH"] ?? ""}`,
          EXPECTED_GITHUB_SYNC_TOKEN: TEST_TOKEN,
          TEST_GITHUB_SYNC_TOKEN: TEST_TOKEN,
          TEST_GITHUB_SYNC_REMOTE: CREDENTIAL_FREE_REMOTE,
          TEST_GITHUB_SYNC_REPO_DIR: fixture.repoDir,
          TEST_GITHUB_SYNC_ASKPASS_ROOT: fixture.askpassRoot,
          GIT_SYNC_TEST_LOG: fixture.logFile,
          GIT_SYNC_BARRIER_DIR: fixture.barrierDir,
          GIT_SYNC_BARRIER_EXPECTED: String(expectedAtBarrier),
          SYNC_OPERATION_ID: id,
          FAKE_GIT_FAIL_PUSH: failPush ? "1" : "0",
        },
      },
    );

    let stderr = "";
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === null) {
        reject(new Error(`Worker ${id} exited without a status code.`));
        return;
      }
      if (code !== 0 && !failPush) {
        reject(new Error(`Worker ${id} failed with exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(code);
    });
  });
}

test("concurrent sync transports retain per-command authentication without mutating remotes", async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "github-sync-concurrency-test-"));
  const binDir = join(fixtureDir, "bin");
  const logFile = join(fixtureDir, "transport.log");
  const repoDir = join(fixtureDir, "repo");
  const barrierDir = join(fixtureDir, "barrier");
  const askpassRoot = join(fixtureDir, "askpass");
  const fixture = { binDir, logFile, repoDir, barrierDir, askpassRoot };

  try {
    mkdirSync(binDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(barrierDir, { recursive: true });
    mkdirSync(askpassRoot, { recursive: true });
    execFileSync("git", ["init", "-q", repoDir]);
    execFileSync("git", ["-C", repoDir, "remote", "add", "github", CREDENTIAL_FREE_REMOTE]);
    writeFakeGit(binDir);

    const concurrentCodes = await Promise.all(
      ["sync-a", "sync-b", "sync-c"].map(id => runWorker(fixture, id, 3)),
    );
    assert.deepEqual(concurrentCodes, [0, 0, 0]);

    const transportLines = readFileSync(logFile, "utf-8").trim().split("\n").sort();
    assert.deepEqual(transportLines, [
      "sync-a:fetch:authenticated",
      "sync-a:push:authenticated",
      "sync-b:fetch:authenticated",
      "sync-b:push:authenticated",
      "sync-c:fetch:authenticated",
      "sync-c:push:authenticated",
    ]);

    const remoteAfter = execFileSync("git", ["-C", repoDir, "remote", "get-url", "github"], {
      encoding: "utf-8",
    }).trim();
    assert.equal(remoteAfter, CREDENTIAL_FREE_REMOTE);
    assert.ok(!remoteAfter.includes(TEST_TOKEN), "remote URL must never contain the authentication token");
    assert.deepEqual(readdirSync(askpassRoot), [], "successful workers must remove all askpass files");

    for (const entry of readdirSync(barrierDir)) {
      rmSync(join(barrierDir, entry));
    }
    const failingCode = await runWorker(fixture, "sync-failure", 1, true);
    assert.equal(failingCode, 1);
    assert.deepEqual(readdirSync(askpassRoot), [], "failed workers must remove all askpass files");

    const syncSource = readFileSync(
      fileURLToPath(new URL("./github-sync.ts", import.meta.url)),
      "utf-8",
    );
    assert.doesNotMatch(syncSource, /git remote (?:set-url|add)/);
    assert.doesNotMatch(syncSource, /x-access-token:.*@github/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});