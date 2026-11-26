import { execFileSync } from "child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ASKPASS_TOKEN_ENV = "RASOKART_GITHUB_SYNC_ASKPASS_TOKEN";

export interface AuthenticatedGitRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  tempDirectory?: string;
}

export interface AuthenticatedGitRunner {
  run(args: string[]): Buffer;
  dispose(): void;
}

/**
 * Creates a process-local Git runner that answers HTTPS credential prompts
 * through GIT_ASKPASS. The token is kept out of remote URLs, command
 * arguments, and captured command output.
 */
export function createAuthenticatedGitRunner(
  token: string,
  options: AuthenticatedGitRunnerOptions = {},
): AuthenticatedGitRunner {
  const askpassDir = mkdtempSync(
    join(options.tempDirectory ?? tmpdir(), "rasokart-github-askpass-"),
  );
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
  } catch (error) {
    rmSync(askpassDir, { recursive: true, force: true });
    throw error;
  }

  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    [ASKPASS_TOKEN_ENV]: token,
  };
  let disposed = false;

  return {
    run(args: string[]) {
      if (disposed) {
        throw new Error("Authenticated Git runner has already been disposed.");
      }
      return execFileSync("git", args, {
        cwd: options.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rmSync(askpassDir, { recursive: true, force: true });
    },
  };
}