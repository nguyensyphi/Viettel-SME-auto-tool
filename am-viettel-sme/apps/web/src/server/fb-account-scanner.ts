import fs from "node:fs";
import path from "node:path";

export interface DiscoveredFacebookAccount {
  readonly accountId: string;
  readonly displayName: string;
  readonly folderName: string;
  readonly profileDir: string;
  readonly status: "CONNECTED" | "NEEDS_LOGIN";
  readonly platform: "FACEBOOK";
}

const KNOWN_DISPLAY_NAMES: Record<string, string> = {
  facebook_profile_nguyen_van_son: "Nguyễn Văn Sơn",
  facebook_profile_tin: "Tín",
  facebook_profile_tin_nguyen: "Tín Nguyễn",
  "Acc Chính": "Acc Chính",
  acc_chinh: "Acc Chính",
  clone: "Clone",
  clone_profile: "Clone Profile",
  fb_viettel_sme: "Viettel SME (Official)",
};

export function removeVietnameseTones(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function sanitizeAccountSlug(folderName: string): string {
  const normalized = removeVietnameseTones(folderName)
    .trim()
    .toLowerCase()
    .replace(/^facebook_profile_?/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const safeBody = normalized || "account";
  const slug = safeBody.startsWith("fb-") ? safeBody : `fb-${safeBody}`;
  return slug.slice(0, 60);
}

export function formatAccountDisplayName(folderName: string): string {
  const trimmed = folderName.trim();
  if (KNOWN_DISPLAY_NAMES[trimmed]) {
    return KNOWN_DISPLAY_NAMES[trimmed]!;
  }
  const cleanKey = trimmed.toLowerCase().replace(/[ -]/g, "_");
  if (KNOWN_DISPLAY_NAMES[cleanKey]) {
    return KNOWN_DISPLAY_NAMES[cleanKey]!;
  }

  // Handle generic facebook_profile_<name>
  let raw = trimmed;
  if (raw.startsWith("facebook_profile_")) {
    raw = raw.replace("facebook_profile_", "");
  } else if (raw.startsWith("facebook_profile")) {
    raw = raw.replace("facebook_profile", "");
  }

  const parts = raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return parts.length > 0 ? parts.join(" ") : trimmed;
}

export function resolveSessionsDirectory(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) {
    return path.resolve(customPath);
  }

  const candidates = [
    path.resolve(process.cwd(), "fb-auto-poster/sessions"),
    path.resolve(process.cwd(), "../fb-auto-poster/sessions"),
    path.resolve(process.cwd(), "../../fb-auto-poster/sessions"),
    path.resolve(process.cwd(), "am-viettel-sme/fb-auto-poster/sessions"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isSessionConnected(profileDir: string): boolean {
  if (!fs.existsSync(profileDir)) return false;

  const indicators = [
    path.join(profileDir, "Default"),
    path.join(profileDir, "Default", "Preferences"),
    path.join(profileDir, "Default", "Network", "Cookies"),
    path.join(profileDir, "Cookies"),
    path.join(profileDir, "Network"),
  ];

  for (const ind of indicators) {
    if (fs.existsSync(ind)) {
      return true;
    }
  }

  // If directory contains files like Preferences, Local State, etc.
  try {
    const entries = fs.readdirSync(profileDir);
    return entries.some((e) =>
      ["Local State", "Preferences", "Default", "Cookies"].includes(e),
    );
  } catch {
    return false;
  }
}

export function scanFacebookSessions(sessionsDir?: string): DiscoveredFacebookAccount[] {
  const resolvedDir = resolveSessionsDirectory(sessionsDir);
  if (!resolvedDir || !fs.existsSync(resolvedDir)) {
    return [];
  }

  const results: DiscoveredFacebookAccount[] = [];
  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;

    // Filter out backup folders, temp images, gemini profile, hidden folders
    if (
      name.startsWith(".") ||
      name.toLowerCase().includes("backup") ||
      name.toLowerCase().includes("temp") ||
      name.toLowerCase().includes("gemini")
    ) {
      continue;
    }

    const fullPath = path.resolve(resolvedDir, name);
    const accountId = sanitizeAccountSlug(name);
    const displayName = formatAccountDisplayName(name);
    const connected = isSessionConnected(fullPath);

    results.push({
      accountId,
      displayName,
      folderName: name,
      profileDir: fullPath,
      status: connected ? "CONNECTED" : "NEEDS_LOGIN",
      platform: "FACEBOOK",
    });
  }

  return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
