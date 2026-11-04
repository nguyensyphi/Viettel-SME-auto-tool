import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.APP_ENV !== "local") {
  throw new Error("Synthetic seed is restricted to APP_ENV=local.");
}

if (process.env.DATA_MODE !== "synthetic") {
  throw new Error("Synthetic seed requires DATA_MODE=synthetic.");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a local PostgreSQL instance.");
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL);
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
}

if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)
) {
  throw new Error("Synthetic seed is restricted to loopback PostgreSQL hosts.");
}

execFileSync(
  "pnpm",
  ["exec", "prisma", "db", "execute", "--file", "prisma/seed.synthetic.sql"],
  { cwd: packageRoot, stdio: "inherit" },
);
