import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { containsHttpUserinfo } from "./verify-git-remotes.js";

const require = createRequire(import.meta.url);
const tsxLoaderPath = require.resolve("tsx/esm");

test("detects HTTP userinfo without relying on a credential format", () => {
  assert.equal(containsHttpUserinfo("https://github.com/example/repo.git"), false);
  assert.equal(containsHttpUserinfo("git@github.com:example/repo.git"), false);
  assert.equal(containsHttpUserinfo("ssh://git@github.com/example/repo.git"), false);
  assert.equal(containsHttpUserinfo("https://user:secret@github.com/example/repo.git"), true);
  assert.equal(containsHttpUserinfo("http://token@github.com/example/repo.git"), true);
});

test("validation reports only the remote name and URL kind", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "git-remote-validation-"));
  const secretMarker = "must-not-appear-in-validation-output";
  const scriptPath = fileURLToPath(new URL("./verify-git-remotes.ts", import.meta.url));

  try {
    execFileSync("git", ["init", "-q", repoDir]);
    execFileSync("git", [
      "-C",
      repoDir,
      "remote",
      "add",
      "unsafe-example",
      `https://user:${secretMarker}@github.com/example/repo.git`,
    ]);

    const result = spawnSync(
      process.execPath,
      ["--import", tsxLoaderPath, scriptPath],
      { cwd: repoDir, encoding: "utf-8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /unsafe-example fetch URL contains HTTP userinfo \(value redacted\)/);
    assert.match(output, /unsafe-example push URL contains HTTP userinfo \(value redacted\)/);
    assert.doesNotMatch(output, new RegExp(secretMarker));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
