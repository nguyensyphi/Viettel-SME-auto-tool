import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface LaunchBrowserOptions {
  readonly profileDir: string;
  readonly url?: string | undefined;
  readonly spawnFn?: typeof spawn | undefined;
}

export interface LaunchBrowserResult {
  readonly launched: boolean;
  readonly pid?: number | undefined;
  readonly executable?: string | undefined;
  readonly profileDir: string;
  readonly error?: string | undefined;
}

const COMMON_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function getDesktopBrowserExecutable(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  for (const p of COMMON_CHROME_PATHS) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to "chrome" or "msedge" in PATH
  return "chrome";
}

export function buildDesktopLoginArgs(
  profileDir: string,
  url = "https://www.facebook.com",
): { executable: string; args: string[] } {
  const executable = getDesktopBrowserExecutable();
  const absoluteProfileDir = path.resolve(profileDir);

  const args = [
    `--user-data-dir=${absoluteProfileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];

  return { executable, args };
}

export function launchDesktopLoginBrowser(
  options: LaunchBrowserOptions,
): LaunchBrowserResult {
  const url = options.url || "https://www.facebook.com";
  const profileDir = path.resolve(options.profileDir);

  // Ensure directory exists
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const { executable, args } = buildDesktopLoginArgs(profileDir, url);
  const spawnCaller = options.spawnFn ?? spawn;

  try {
    const child = spawnCaller(executable, args, {
      detached: true,
      stdio: "ignore",
    });

    if (typeof child.unref === "function") {
      child.unref();
    }

    return {
      launched: true,
      pid: child.pid,
      executable,
      profileDir,
    };
  } catch (err: any) {
    return {
      launched: false,
      profileDir,
      error: err?.message || String(err),
    };
  }
}

