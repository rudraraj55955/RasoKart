import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

// Execute the real preflight, never the production entrypoint: no environment
// loading, backup, migration, build, restart or production/network request.
const source = fs.readFileSync(new URL("./deploy-sensitive-production.sh", import.meta.url), "utf8");
const start = source.indexOf("# 1b.");
const end = source.indexOf("# 3. Load environment");
assert.ok(start > 0 && end > start, "preflight boundaries must remain explicit");
const preflight = source.slice(start, end);
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(cwd, name, data) {
  fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
  fs.writeFileSync(path.join(cwd, name), data);
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-drift-"));
  directories.push(root);
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  const upstream = path.join(root, "upstream");
  fs.mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "main");
  write(repo, "tracked.txt", "base\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "base");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  git(root, "clone", "-b", "main", remote, upstream);
  write(upstream, "incoming.txt", "upstream\n");
  git(upstream, "add", "."); git(upstream, "commit", "-m", "incoming");
  git(upstream, "push", "origin", "main");
  return { root, repo };
}
function tree(cwd) {
  const result = {};
  function visit(dir, prefix = "") {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const relative = path.join(prefix, name), absolute = path.join(dir, name);
      if (fs.statSync(absolute).isDirectory()) visit(absolute, relative);
      else result[relative] = fs.readFileSync(absolute).toString("base64");
    }
  }
  visit(cwd);
  return result;
}
function snapshot(repo) {
  return { head: git(repo, "rev-parse", "HEAD"), index: fs.readFileSync(path.join(repo, ".git/index")).toString("base64"),
    files: tree(repo), merge: fs.existsSync(path.join(repo, ".git/MERGE_HEAD")) ? fs.readFileSync(path.join(repo, ".git/MERGE_HEAD"), "utf8") : null };
}
function run({ root, repo }) {
  return spawnSync("bash", ["-c", `set -Eeuo pipefail\nlog() { printf '%s\\n' "$*"; }\nfail() { log "$*"; exit 1; }\nLOG_FILE="$1"\nPROTECTED_PATHS=(server data uploads .env backups)\n${preflight}\nprintf 'PREFLIGHT_OK\\n'`, "preflight", path.join(root, "test.log")],
    { cwd: repo, env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8" });
}
function preserved(f, expected) {
  const before = snapshot(f.repo), result = run(f);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, expected);
  assert.deepEqual(snapshot(f.repo), before, "index, HEAD, merge state and every working file must survive");
}
test("clean checkout passes preflight without changing HEAD or working files", () => {
  const f = fixture(), before = snapshot(f.repo), result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PREFLIGHT_OK/);
  assert.deepEqual(snapshot(f.repo), before);
});
test("unstaged tracked changes are rejected and preserved", () => {
  const f = fixture(); write(f.repo, "tracked.txt", "local work\n");
  preserved(f, /Tracked local changes detected/);
});
test("staged changes and separately unstaged content are both preserved", () => {
  const f = fixture(); write(f.repo, "tracked.txt", "staged work\n"); git(f.repo, "add", "tracked.txt");
  write(f.repo, "tracked.txt", "additional unstaged work\n");
  preserved(f, /Tracked local changes detected/);
});
test("active conflicting merge is rejected without abort or reset", () => {
  const f = fixture(); git(f.repo, "checkout", "-b", "other");
  write(f.repo, "tracked.txt", "other branch\n"); git(f.repo, "commit", "-am", "other");
  git(f.repo, "checkout", "main"); write(f.repo, "tracked.txt", "main branch\n"); git(f.repo, "commit", "-am", "main");
  const merge = spawnSync("git", ["merge", "other"], { cwd: f.repo, env, encoding: "utf8" });
  assert.equal(merge.status, 1); assert.ok(fs.existsSync(path.join(f.repo, ".git/MERGE_HEAD")));
  preserved(f, /Unfinished Git operation detected \(MERGE_HEAD\)/);
});
test("non-colliding untracked reconciliation artifacts remain untouched", () => {
  const f = fixture();
  for (const name of [".agents/memory/local.md", ".github/workflows/sed8S3arA", "attached_assets/screenshots/local.png", "notes.txt"])
    write(f.repo, name, "must be preserved\n");
  const before = snapshot(f.repo), result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PREFLIGHT_OK/); assert.deepEqual(snapshot(f.repo), before);
});
test("untracked incoming-file collision is rejected with content preserved", () => {
  const f = fixture(); write(f.repo, "incoming.txt", "local untracked work\n");
  preserved(f, /Untracked files on the VPS collide/);
});
