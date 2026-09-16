import { execFileSync } from "child_process";

export function containsHttpUserinfo(url: string): boolean {
  return /^https?:\/\/[^/?#\s]*@/i.test(url.trim());
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function verifyGitRemotes(): void {
  const remotes = git(["remote"]).split("\n").filter(Boolean);
  const unsafe: Array<{ remote: string; kind: "fetch" | "push" }> = [];

  for (const remote of remotes) {
    const fetchUrls = git(["config", "--get-all", `remote.${remote}.url`])
      .split("\n")
      .filter(Boolean);
    let pushUrls: string[] = [];
    try {
      pushUrls = git(["config", "--get-all", `remote.${remote}.pushurl`])
        .split("\n")
        .filter(Boolean);
    } catch {
      // With no pushurl configured, Git uses the fetch URL for pushes.
      pushUrls = fetchUrls;
    }

    if (fetchUrls.some(containsHttpUserinfo)) unsafe.push({ remote, kind: "fetch" });
    if (pushUrls.some(containsHttpUserinfo)) unsafe.push({ remote, kind: "push" });
  }

  if (unsafe.length > 0) {
    console.error("Git remote credential check failed.");
    for (const finding of unsafe) {
      console.error(`- ${finding.remote} ${finding.kind} URL contains HTTP userinfo (value redacted)`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Git remote credential check passed (${remotes.length} remotes checked; URL values withheld).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyGitRemotes();
}
