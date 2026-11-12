import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runUISmokeAudit,
  formatUISmokeSummary,
} from "../packages/browser-automation/src/ui-smoke-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function isServerReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerReady(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

async function main() {
  const baseUrl = process.env["BASE_URL"] || "http://127.0.0.1:3000";
  let devServerProcess: ChildProcess | null = null;

  try {
    const alreadyRunning = await isServerReady(baseUrl);
    if (!alreadyRunning) {
      console.log(`Máy chủ ${baseUrl} chưa chạy. Đang tự động khởi động Next.js Web Dev Server...`);
      devServerProcess = spawn("pnpm", ["--filter", "@am-sme/web", "dev"], {
        shell: true,
        stdio: "pipe",
        cwd: path.resolve(__dirname, ".."),
      });

      const ready = await waitForServer(baseUrl, 35000);
      if (!ready) {
        throw new Error(`Máy chủ không phản hồi tại ${baseUrl} sau 35s khởi động.`);
      }
      console.log(`Máy chủ ${baseUrl} đã sẵn sàng.`);
    } else {
      console.log(`Đã phát hiện máy chủ đang chạy sẵn tại: ${baseUrl}`);
    }

    console.log(`Đang chạy Playwright Visual Smoke Runner trên: ${baseUrl}...`);
    const report = await runUISmokeAudit({
      baseUrl,
      reportDir: "storage/reports/ui-audit",
      headless: true,
      channel: "chrome",
    });

    console.log("\n" + formatUISmokeSummary(report));

    if (!report.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Lỗi thực thi UI Smoke Runner:", err);
    process.exit(1);
  } finally {
    if (devServerProcess && devServerProcess.pid) {
      console.log("Đang giải phóng và dừng máy chủ Next.js tạm thời...");
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", devServerProcess.pid.toString(), "/f", "/t"], { stdio: "ignore" });
        } else {
          devServerProcess.kill("SIGTERM");
        }
      } catch {
        // ignore shutdown error
      }
    }
  }
}

void main();

