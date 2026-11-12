export type GroupPlatform = "ZALO" | "FACEBOOK";

export type GroupCategory =
  | "ACCOUNTING_TAX"
  | "BANKING_FINANCE"
  | "BUSINESS_ASSOCIATION"
  | "STARTUP_SME"
  | "OTHER";

export type GroupPostingPermission =
  | "ALLOWED"
  | "MODERATED_ALLOWED"
  | "READ_ONLY"
  | "PENDING_JOIN"
  | "BLOCKED";

export interface RegisterGroupInput {
  groupId: string;
  platform: GroupPlatform;
  name: string;
  url: string;
  postingPermission: GroupPostingPermission;
  category?: GroupCategory | undefined;
  minHoursBetweenPosts?: number | undefined;
  active?: boolean | undefined;
}

export interface GroupRecord {
  groupId: string;
  platform: GroupPlatform;
  name: string;
  url: string;
  category: GroupCategory;
  postingPermission: GroupPostingPermission;
  minHoursBetweenPosts: number;
  active: boolean;
  lastPostedAt?: string | undefined;
}

export interface GroupEligibilityResult {
  eligible: boolean;
  reason?: string | undefined;
}

function foldVietnamese(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export function inferGroupCategory(name: string): GroupCategory {
  const folded = foldVietnamese(name);

  if (
    folded.includes("ke toan") ||
    folded.includes("thue") ||
    folded.includes("kiem toan") ||
    folded.includes("hoa don")
  ) {
    return "ACCOUNTING_TAX";
  }

  if (
    folded.includes("ngan hang") ||
    folded.includes("tin dung") ||
    folded.includes("tai chinh") ||
    folded.includes("bank")
  ) {
    return "BANKING_FINANCE";
  }

  if (
    folded.includes("hiep hoi") ||
    folded.includes("doanh nghiep") ||
    folded.includes("doanh nhan") ||
    folded.includes("bni")
  ) {
    return "BUSINESS_ASSOCIATION";
  }

  if (folded.includes("khoi nghiep") || folded.includes("startup")) {
    return "STARTUP_SME";
  }

  return "OTHER";
}

export class GroupManager {
  private readonly groups = new Map<string, GroupRecord>();

  registerGroup(input: RegisterGroupInput): GroupRecord {
    const groupId = input.groupId.trim();
    const name = input.name.trim();
    const url = input.url.trim();
    if (!groupId || !name || !url) {
      throw new Error("INVALID_GROUP_INPUT: groupId, name, and url are required");
    }

    const minHoursBetweenPosts = input.minHoursBetweenPosts ?? 24;
    if (minHoursBetweenPosts <= 0) {
      throw new Error("INVALID_GROUP_COOLDOWN: minHoursBetweenPosts must be > 0");
    }

    const record: GroupRecord = {
      groupId,
      platform: input.platform,
      name,
      url,
      category: input.category ?? inferGroupCategory(name),
      postingPermission: input.postingPermission,
      minHoursBetweenPosts,
      active: input.active ?? true,
    };

    this.groups.set(groupId, record);
    return { ...record };
  }

  getGroup(groupId: string): GroupRecord | null {
    const found = this.groups.get(groupId);
    return found ? { ...found } : null;
  }

  deleteGroup(groupId: string): boolean {
    return this.groups.delete(groupId.trim());
  }

  listGroups(filter?: {
    categories?: readonly GroupCategory[] | undefined;
    platform?: GroupPlatform | undefined;
  }): GroupRecord[] {
    const categorySet = filter?.categories ? new Set(filter.categories) : null;
    const result: GroupRecord[] = [];
    for (const group of this.groups.values()) {
      if (categorySet && !categorySet.has(group.category)) continue;
      if (filter?.platform && group.platform !== filter.platform) continue;
      result.push({ ...group });
    }
    return result;
  }

  canPostToGroup(
    groupId: string,
    now: Date = new Date(),
  ): GroupEligibilityResult {
    const group = this.groups.get(groupId);
    if (!group) {
      return { eligible: false, reason: "GROUP_NOT_FOUND" };
    }
    if (!group.active) {
      return { eligible: false, reason: "GROUP_INACTIVE" };
    }
    if (
      group.postingPermission !== "ALLOWED" &&
      group.postingPermission !== "MODERATED_ALLOWED"
    ) {
      return {
        eligible: false,
        reason: `POSTING_NOT_PERMITTED:${group.postingPermission}`,
      };
    }

    if (group.lastPostedAt) {
      const lastMs = new Date(group.lastPostedAt).getTime();
      const cooldownMs = group.minHoursBetweenPosts * 3_600_000;
      if (now.getTime() - lastMs < cooldownMs) {
        return { eligible: false, reason: "GROUP_COOLDOWN_ACTIVE" };
      }
    }

    return { eligible: true };
  }

  recordGroupPost(groupId: string, postedAt: Date = new Date()): GroupRecord {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`GROUP_NOT_FOUND:${groupId}`);
    }
    const updated: GroupRecord = {
      ...group,
      lastPostedAt: postedAt.toISOString(),
    };
    this.groups.set(groupId, updated);
    return { ...updated };
  }
}

