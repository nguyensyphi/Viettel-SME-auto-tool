import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
  readonly debugPort?: number | undefined;
  readonly error?: string | undefined;
}

export function getProfileDebugPort(profileDir: string): number {
  const normalized = path.resolve(profileDir).toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return 9222 + (hash % 178);
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
): { executable: string; args: string[]; debugPort: number } {
  const executable = getDesktopBrowserExecutable();
  const absoluteProfileDir = path.resolve(profileDir);
  const debugPort = getProfileDebugPort(absoluteProfileDir);

  const args = [
    `--user-data-dir=${absoluteProfileDir}`,
    `--remote-debugging-port=${debugPort}`,
    "--new-window",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];

  return { executable, args, debugPort };
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

  const { executable, args, debugPort } = buildDesktopLoginArgs(profileDir, url);
  const spawnCaller = options.spawnFn ?? spawn;

  // On Windows in live runtime (when not using mock spawnFn), use Start-Process -WindowStyle Normal
  // so that Chrome always opens a visible foreground window (SW_SHOWNORMAL) and cleans up any stuck headless/hidden processes.
  if (
    !options.spawnFn &&
    process.platform === "win32" &&
    process.env.NODE_ENV !== "test" &&
    process.env.VITEST !== "true"
  ) {
    try {
      const psScript = `
        $ErrorActionPreference = 'SilentlyContinue'
        $exe = $env:AGY_CHROME_EXE
        $prof = $env:AGY_CHROME_PROFILE
        $port = $env:AGY_CHROME_PORT
        $url = $env:AGY_CHROME_URL
        if ($prof) {
          Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($prof, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
          Start-Sleep -Milliseconds 250
        }
        $argList = @(
          "--user-data-dir=\`"$prof\`"",
          "--remote-debugging-port=$port",
          "--new-window",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "\`"$url\`""
        )
        $proc = Start-Process -FilePath $exe -ArgumentList $argList -WindowStyle Normal -PassThru
        if ($proc) { Write-Output $proc.Id }
      `;
      for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]) {
        const lockPath = path.join(profileDir, lockName);
        if (fs.existsSync(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // ignore if locked
          }
        }
      }
      const res = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psScript],
        {
          env: {
            ...process.env,
            AGY_CHROME_EXE: executable,
            AGY_CHROME_PROFILE: profileDir,
            AGY_CHROME_PORT: String(debugPort),
            AGY_CHROME_URL: url,
          },
          encoding: "utf8",
          timeout: 8000,
          windowsHide: true,
        },
      );
      const parsedPid = Number.parseInt((res.stdout || "").trim(), 10);
      if (Number.isFinite(parsedPid) && parsedPid > 0) {
        return {
          launched: true,
          pid: parsedPid,
          executable,
          profileDir,
          debugPort,
        };
      }
    } catch {
      // Fallback to standard spawn below
    }
  }

  try {
    const child = spawnCaller(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    if (typeof child.unref === "function") {
      child.unref();
    }

    return {
      launched: true,
      pid: child.pid,
      executable,
      profileDir,
      debugPort,
    };
  } catch (err: any) {
    return {
      launched: false,
      profileDir,
      debugPort,
      error: err?.message || String(err),
    };
  }
}

