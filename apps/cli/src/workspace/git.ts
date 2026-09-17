import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitObservation } from "@otter/core";
import { writePrivate } from "./registry.js";

const exec = promisify(execFile);
const SCP_USER = /^[^/@\s]+@/;
const GIT_SUFFIX = /\.git$/;
export async function git(path: string, args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never", "-C", path, ...args],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      // biome-ignore lint/style/useNamingConvention: Git environment variable names
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    },
  );
  return stdout.trimEnd();
}
export function sanitizeRemote(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(SCP_USER, "");
  }
}
function parseStatus(status: string, observation: GitObservation): void {
  const records = status.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as string;
    switch (record[0]) {
      case "#":
        applyHeader(record, observation);
        break;
      case "?":
        observation.untracked++;
        break;
      case "u":
        observation.conflicts++;
        break;
      case "1":
      case "2":
        if (record[2] !== ".") observation.staged++;
        if (record[3] !== ".") observation.unstaged++;
        if (record[0] === "2") i++; // Rename source is a separate NUL record.
        break;
    }
  }
}
function applyHeader(record: string, observation: GitObservation): void {
  if (record.startsWith("# branch.oid ")) {
    observation.unborn = record.slice(13) === "(initial)";
    if (!observation.unborn) observation.commit = record.slice(13);
  } else if (record.startsWith("# branch.head ")) {
    observation.branch = record.slice(14);
    observation.detached = observation.branch === "(detached)";
  } else if (record.startsWith("# branch.upstream ")) observation.upstream = record.slice(18);
  else if (record.startsWith("# branch.ab ")) {
    const [ahead, behind] = record.slice(12).split(" ");
    observation.ahead = Number(ahead?.slice(1));
    observation.behind = Number(behind?.slice(1));
  }
}
export async function observeGit(
  path: string,
  directory: string,
  id: string,
  fetch = false,
): Promise<GitObservation> {
  const observation: GitObservation = {
    checkedAt: new Date().toISOString(),
    repository: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    detached: false,
    unborn: false,
  };
  try {
    await git(path, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    const marker = await lstat(join(path, ".git")).catch(() => undefined);
    observation.repository = !!marker;
    if (marker || !String((error as { stderr?: string }).stderr).includes("not a git repository")) {
      observation.error = "Cannot inspect Git repository; check the folder and Git metadata";
    }
    return observation;
  }
  observation.repository = true;
  const receiptPath = join(directory, `git-${createHash("sha256").update(id).digest("hex")}.json`);
  try {
    const previous = JSON.parse(await readFile(receiptPath, "utf8")) as {
      remoteCheckedAt?: string;
      fetchError?: string;
    };
    Object.assign(observation, previous);
  } catch {
    /* No remote observation yet. Local tracking refs do not prove remote freshness. */
  }
  if (fetch) {
    try {
      await git(path, ["fetch", "--all", "--no-tags", "--no-recurse-submodules"]);
      observation.remoteCheckedAt = new Date().toISOString();
      // biome-ignore lint/performance/noDelete: a successful fetch clears the optional prior failure
      delete observation.fetchError;
    } catch {
      observation.fetchError =
        "Fetch failed; retained the previous remote observation. Check remote access in your Git client.";
    }
    await writePrivate(receiptPath, {
      remoteCheckedAt: observation.remoteCheckedAt,
      fetchError: observation.fetchError,
    });
  }
  try {
    const status = await git(path, [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ]);
    parseStatus(status, observation);
    try {
      const remoteName = observation.branch
        ? await git(path, ["config", "--get", `branch.${observation.branch}.remote`]).catch(
            () => "origin",
          )
        : "origin";
      observation.remote = sanitizeRemote(await git(path, ["remote", "get-url", remoteName]));
      observation.repoKey = createHash("sha256")
        .update(observation.remote.replace(GIT_SUFFIX, ""))
        .digest("hex");
    } catch {
      /* Local repository with no remote. */
    }
  } catch {
    observation.error = "Cannot read Git status";
  }
  return observation;
}
