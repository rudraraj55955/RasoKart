import { execFileSync } from "child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ASKPASS_TOKEN_ENV = "RASOKART_GITHUB_API_ASKPASS_TOKEN";

export function runAuthenticatedGit(
  token: string,
  args: string[],
  options: { cwd: string },
): Buffer {
  const askpassDir = mkdtempSync(join(tmpdir(), "rasokart-github-api-askpass-"));
  const askpassPath = join(askpassDir, "askpass.sh");

  try {
    writeFileSync(
      askpassPath,
      `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$${ASKPASS_TOKEN_ENV}" ;;
  *) exit 1 ;;
esac
`,
      { encoding: "utf-8", mode: 0o700 },
    );
    chmodSync(askpassPath, 0o700);

    return execFileSync("git", args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        [ASKPASS_TOKEN_ENV]: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(askpassDir, { recursive: true, force: true });
  }
}