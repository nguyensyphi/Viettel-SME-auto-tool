import { randomUUID } from "node:crypto";

export interface ContentLibraryDatabase {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
}

export interface UpsertGoogleDocumentInput {
  readonly connectionId: string;
  readonly documentId: string;
  readonly name: string;
  readonly revisionId?: string | null;
  readonly contentHash?: string | null;
  readonly postCount?: number;
  readonly modifiedAt?: Date | string | null;
}

export interface GoogleDocumentRecord {
  readonly id: string;
  readonly connectionId: string;
  readonly documentId: string;
  readonly name: string;
  readonly revisionId: string | null;
  readonly contentHash: string | null;
  readonly postCount: number;
  readonly modifiedAt: string | null;
  readonly syncedAt: string;
}

export interface UpsertPostInput {
  readonly workspaceId: string;
  readonly documentId?: string | null;
  readonly postCode: string;
  readonly title: string;
  readonly body: string;
  readonly topicCode: string;
  readonly targetAudience?: string;
  readonly platforms?: readonly string[];
  readonly status?: string;
  readonly priority?: string;
  readonly mediaHint?: string | null;
  readonly hashtags?: readonly string[];
  readonly contentHash: string;
  readonly validFrom?: Date | string | null;
  readonly validUntil?: Date | string | null;
}

export interface ContentPostRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string | null;
  readonly postCode: string;
  readonly title: string;
  readonly body: string;
  readonly topicCode: string;
  readonly targetAudience: string;
  readonly platforms: string[];
  readonly status: string;
  readonly priority: string;
  readonly mediaHint: string | null;
  readonly hashtags: string[];
  readonly version: number;
  readonly contentHash: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContentVersionRecord {
  readonly id: string;
  readonly contentId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly body: string;
  readonly topicCode: string;
  readonly hashtags: string[];
  readonly createdAt: string;
}

export interface ListPostsFilters {
  readonly topicCode?: string;
  readonly status?: string;
  readonly documentId?: string;
}

export interface UpsertMediaAssetInput {
  readonly workspaceId: string;
  readonly connectionId?: string | null;
  readonly driveFileId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly topicCode: string;
  readonly postCodeHint?: string | null;
  readonly platforms?: readonly string[];
  readonly status?: string;
  readonly isSharedMedia?: boolean;
}

export interface MediaAssetRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string | null;
  readonly driveFileId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly topicCode: string;
  readonly postCodeHint: string | null;
  readonly platforms: string[];
  readonly status: string;
  readonly version: number;
  readonly isSharedMedia: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MediaVersionRecord {
  readonly id: string;
  readonly mediaId: string;
  readonly version: number;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface LinkMediaToContentInput {
  readonly contentId: string;
  readonly mediaId: string;
  readonly position?: number;
  readonly matchMethod?: string;
  readonly matchScore?: number;
}

export interface ContentMediaLinkRecord {
  readonly id: string;
  readonly contentId: string;
  readonly mediaId: string;
  readonly position: number;
  readonly matchMethod: string;
  readonly matchScore: number;
  readonly createdAt: string;
}

export interface LinkedMediaAssetRecord extends MediaAssetRecord {
  readonly position: number;
  readonly matchMethod: string;
  readonly matchScore: number;
}

export interface RecordContentApprovalInput {
  readonly workspaceId: string;
  readonly contentId: string;
  readonly contentVersion: number;
  readonly mediaVersion?: number | null;
  readonly approvedBy: string;
  readonly status: string;
  readonly approvedPlatforms?: readonly string[];
  readonly notes?: string | null;
}

export interface ContentApprovalRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly contentId: string;
  readonly contentVersion: number;
  readonly mediaVersion: number | null;
  readonly approvedBy: string;
  readonly status: string;
  readonly approvedPlatforms: string[];
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface UpsertSocialAccountInput {
  readonly workspaceId: string;
  readonly accountCode: string;
  readonly platform: string;
  readonly displayName: string;
  readonly ownerUserId: string;
  readonly profileDir?: string;
  readonly assignedTopics?: readonly string[];
  readonly maxPostsPerDay?: number;
  readonly minIntervalMinutes?: number;
  readonly preferredWindows?: readonly string[];
  readonly status?: string;
}

export interface UpdateSocialAccountInput {
  readonly displayName?: string;
  readonly assignedTopics?: readonly string[];
  readonly maxPostsPerDay?: number;
  readonly minIntervalMinutes?: number;
  readonly preferredWindows?: readonly string[];
  readonly status?: string;
  readonly lastSessionCheckAt?: Date | string | null;
}

export interface SocialAccountRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly accountCode: string;
  readonly platform: string;
  readonly displayName: string;
  readonly ownerUserId: string;
  readonly profileDir: string;
  readonly assignedTopics: string[];
  readonly maxPostsPerDay: number;
  readonly minIntervalMinutes: number;
  readonly preferredWindows: string[];
  readonly status: string;
  readonly lastSessionCheckAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePublishingCampaignInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly topicCodes?: readonly string[];
  readonly accountIds?: readonly string[];
  readonly startDate?: Date | string | null;
  readonly endDate?: Date | string | null;
  readonly status?: string;
}

export interface PublishingCampaignRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly topicCodes: string[];
  readonly accountIds: string[];
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePublishingScheduleInput {
  readonly workspaceId: string;
  readonly campaignId?: string | null;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly scheduledAt: Date | string;
  readonly publishMode?: string;
  readonly status?: string;
}

export interface PublishingScheduleRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly campaignId: string | null;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly scheduledAt: string;
  readonly publishMode: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePublishingJobInput {
  readonly workspaceId: string;
  readonly scheduleId?: string | null;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly publishMode?: string;
  readonly scheduledAt: Date | string;
  readonly idempotencyKey: string;
  readonly status?: string;
}

export interface PublishingJobRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly scheduleId: string | null;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly publishMode: string;
  readonly scheduledAt: string;
  readonly idempotencyKey: string;
  readonly status: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AppendPublishingJobStepInput {
  readonly jobId: string;
  readonly stepName: string;
  readonly status: string;
  readonly details?: string | null;
}

export interface PublishingJobStepRecord {
  readonly id: string;
  readonly jobId: string;
  readonly stepName: string;
  readonly status: string;
  readonly details: string | null;
  readonly createdAt: string;
}

export interface RecordPublishingResultInput {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly status: string;
  readonly publishedUrl?: string | null;
  readonly screenshotPath?: string | null;
  readonly confirmedBy?: string | null;
}

export interface PublishingResultRecord {
  readonly id: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly contentId: string;
  readonly accountId: string;
  readonly platform: string;
  readonly status: string;
  readonly publishedUrl: string | null;
  readonly screenshotPath: string | null;
  readonly confirmedBy: string | null;
  readonly publishedAt: string;
}

export class ContentLibraryRepository {
  constructor(private readonly db: ContentLibraryDatabase) {}

  async upsertGoogleDocument(input: UpsertGoogleDocumentInput): Promise<GoogleDocumentRecord> {
    const existing = await this.getGoogleDocument(input.connectionId, input.documentId);
    if (existing) {
      const rows = await this.db.query<GoogleDocumentRecord>(
        `UPDATE "GoogleDocument"
         SET "name" = $1,
             "revisionId" = $2,
             "contentHash" = $3,
             "postCount" = $4,
             "modifiedAt" = $5,
             "syncedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $6
         RETURNING "id", "connectionId", "documentId", "name", "revisionId", "contentHash",
                   "postCount", "modifiedAt", "syncedAt"`,
        [
          input.name,
          input.revisionId ?? null,
          input.contentHash ?? null,
          input.postCount ?? 0,
          input.modifiedAt ? new Date(input.modifiedAt).toISOString() : null,
          existing.id,
        ],
      );
      return rows[0]!;
    }

    const id = randomUUID();
    const rows = await this.db.query<GoogleDocumentRecord>(
      `INSERT INTO "GoogleDocument" (
         "id", "connectionId", "documentId", "name", "revisionId",
         "contentHash", "postCount", "modifiedAt", "syncedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING "id", "connectionId", "documentId", "name", "revisionId", "contentHash",
                 "postCount", "modifiedAt", "syncedAt"`,
      [
        id,
        input.connectionId,
        input.documentId,
        input.name,
        input.revisionId ?? null,
        input.contentHash ?? null,
        input.postCount ?? 0,
        input.modifiedAt ? new Date(input.modifiedAt).toISOString() : null,
      ],
    );
    return rows[0]!;
  }

  async getGoogleDocument(connectionId: string, documentId: string): Promise<GoogleDocumentRecord | null> {
    const rows = await this.db.query<GoogleDocumentRecord>(
      `SELECT "id", "connectionId", "documentId", "name", "revisionId", "contentHash",
              "postCount", "modifiedAt", "syncedAt"
       FROM "GoogleDocument"
       WHERE "connectionId" = $1 AND "documentId" = $2`,
      [connectionId, documentId],
    );
    return rows[0] ?? null;
  }

  async listGoogleDocuments(connectionId: string): Promise<GoogleDocumentRecord[]> {
    return this.db.query<GoogleDocumentRecord>(
      `SELECT "id", "connectionId", "documentId", "name", "revisionId", "contentHash",
              "postCount", "modifiedAt", "syncedAt"
       FROM "GoogleDocument"
       WHERE "connectionId" = $1
       ORDER BY "syncedAt" DESC`,
      [connectionId],
    );
  }

  async upsertPost(input: UpsertPostInput): Promise<ContentPostRecord> {
    const existing = await this.getPostByCode(input.workspaceId, input.postCode);

    if (!existing) {
      const id = randomUUID();
      const versionId = randomUUID();
      const rows = await this.db.query<ContentPostRecord>(
        `INSERT INTO "ContentPost" (
           "id", "workspaceId", "documentId", "postCode", "title", "body",
           "topicCode", "targetAudience", "platforms", "status", "priority",
           "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil"
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, 1, $14, $15, $16
         )
         RETURNING "id", "workspaceId", "documentId", "postCode", "title", "body",
                   "topicCode", "targetAudience", "platforms", "status", "priority",
                   "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
                   "createdAt", "updatedAt"`,
        [
          id,
          input.workspaceId,
          input.documentId ?? null,
          input.postCode,
          input.title,
          input.body,
          input.topicCode,
          input.targetAudience ?? "BUSINESS_OWNER",
          input.platforms ?? [],
          input.status ?? "DRAFT",
          input.priority ?? "NORMAL",
          input.mediaHint ?? null,
          input.hashtags ?? [],
          input.contentHash,
          input.validFrom ? new Date(input.validFrom).toISOString() : null,
          input.validUntil ? new Date(input.validUntil).toISOString() : null,
        ],
      );

      await this.db.execute(
        `INSERT INTO "ContentVersion" (
           "id", "contentId", "version", "contentHash", "title", "body", "topicCode", "hashtags"
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
        [
          versionId,
          id,
          input.contentHash,
          input.title,
          input.body,
          input.topicCode,
          input.hashtags ?? [],
        ],
      );

      return rows[0]!;
    }

    // Existing post: check content hash
    if (existing.contentHash === input.contentHash) {
      // Content has not changed: update non-versioning metadata if provided, keep same version
      const rows = await this.db.query<ContentPostRecord>(
        `UPDATE "ContentPost"
         SET "documentId" = COALESCE($1, "documentId"),
             "targetAudience" = $2,
             "platforms" = $3,
             "priority" = $4,
             "mediaHint" = $5,
             "validFrom" = $6,
             "validUntil" = $7,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $8
         RETURNING "id", "workspaceId", "documentId", "postCode", "title", "body",
                   "topicCode", "targetAudience", "platforms", "status", "priority",
                   "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
                   "createdAt", "updatedAt"`,
        [
          input.documentId ?? null,
          input.targetAudience ?? existing.targetAudience,
          input.platforms ?? existing.platforms,
          input.priority ?? existing.priority,
          input.mediaHint ?? existing.mediaHint,
          input.validFrom ? new Date(input.validFrom).toISOString() : existing.validFrom,
          input.validUntil ? new Date(input.validUntil).toISOString() : existing.validUntil,
          existing.id,
        ],
      );
      return rows[0]!;
    }

    // Content changed: increment version and append to ContentVersion history
    const nextVersion = existing.version + 1;
    const versionId = randomUUID();

    const rows = await this.db.query<ContentPostRecord>(
      `UPDATE "ContentPost"
       SET "documentId" = COALESCE($1, "documentId"),
           "title" = $2,
           "body" = $3,
           "topicCode" = $4,
           "targetAudience" = $5,
           "platforms" = $6,
           "priority" = $7,
           "mediaHint" = $8,
           "hashtags" = $9,
           "version" = $10,
           "contentHash" = $11,
           "validFrom" = $12,
           "validUntil" = $13,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $14
       RETURNING "id", "workspaceId", "documentId", "postCode", "title", "body",
                 "topicCode", "targetAudience", "platforms", "status", "priority",
                 "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
                 "createdAt", "updatedAt"`,
      [
        input.documentId ?? null,
        input.title,
        input.body,
        input.topicCode,
        input.targetAudience ?? existing.targetAudience,
        input.platforms ?? existing.platforms,
        input.priority ?? existing.priority,
        input.mediaHint ?? existing.mediaHint,
        input.hashtags ?? existing.hashtags,
        nextVersion,
        input.contentHash,
        input.validFrom ? new Date(input.validFrom).toISOString() : existing.validFrom,
        input.validUntil ? new Date(input.validUntil).toISOString() : existing.validUntil,
        existing.id,
      ],
    );

    await this.db.execute(
      `INSERT INTO "ContentVersion" (
         "id", "contentId", "version", "contentHash", "title", "body", "topicCode", "hashtags"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        versionId,
        existing.id,
        nextVersion,
        input.contentHash,
        input.title,
        input.body,
        input.topicCode,
        input.hashtags ?? existing.hashtags,
      ],
    );

    return rows[0]!;
  }

  async getPostById(workspaceId: string, id: string): Promise<ContentPostRecord | null> {
    const rows = await this.db.query<ContentPostRecord>(
      `SELECT "id", "workspaceId", "documentId", "postCode", "title", "body",
              "topicCode", "targetAudience", "platforms", "status", "priority",
              "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
              "createdAt", "updatedAt"
       FROM "ContentPost"
       WHERE "workspaceId" = $1 AND "id" = $2`,
      [workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async getPostByCode(workspaceId: string, postCode: string): Promise<ContentPostRecord | null> {
    const rows = await this.db.query<ContentPostRecord>(
      `SELECT "id", "workspaceId", "documentId", "postCode", "title", "body",
              "topicCode", "targetAudience", "platforms", "status", "priority",
              "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
              "createdAt", "updatedAt"
       FROM "ContentPost"
       WHERE "workspaceId" = $1 AND "postCode" = $2`,
      [workspaceId, postCode],
    );
    return rows[0] ?? null;
  }

  async listPosts(workspaceId: string, filters?: ListPostsFilters): Promise<ContentPostRecord[]> {
    const conditions: string[] = ['"workspaceId" = $1'];
    const values: unknown[] = [workspaceId];

    if (filters?.topicCode) {
      values.push(filters.topicCode);
      conditions.push(`"topicCode" = $${values.length}`);
    }

    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`"status" = $${values.length}`);
    }

    if (filters?.documentId) {
      values.push(filters.documentId);
      conditions.push(`"documentId" = $${values.length}`);
    }

    return this.db.query<ContentPostRecord>(
      `SELECT "id", "workspaceId", "documentId", "postCode", "title", "body",
              "topicCode", "targetAudience", "platforms", "status", "priority",
              "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
              "createdAt", "updatedAt"
       FROM "ContentPost"
       WHERE ${conditions.join(" AND ")}
       ORDER BY "createdAt" DESC`,
      values,
    );
  }

  async listPostVersions(contentId: string): Promise<ContentVersionRecord[]> {
    return this.db.query<ContentVersionRecord>(
      `SELECT "id", "contentId", "version", "contentHash", "title", "body", "topicCode", "hashtags", "createdAt"
       FROM "ContentVersion"
       WHERE "contentId" = $1
       ORDER BY "version" ASC`,
      [contentId],
    );
  }

  async updatePostStatus(
    workspaceId: string,
    id: string,
    status: string,
  ): Promise<ContentPostRecord | null> {
    const rows = await this.db.query<ContentPostRecord>(
      `UPDATE "ContentPost"
       SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $2 AND "id" = $3
       RETURNING "id", "workspaceId", "documentId", "postCode", "title", "body",
                 "topicCode", "targetAudience", "platforms", "status", "priority",
                 "mediaHint", "hashtags", "version", "contentHash", "validFrom", "validUntil",
                 "createdAt", "updatedAt"`,
      [status, workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async upsertMediaAsset(input: UpsertMediaAssetInput): Promise<MediaAssetRecord> {
    const existing = await this.getMediaByDriveFileId(input.workspaceId, input.driveFileId);
    if (!existing) {
      const id = randomUUID();
      const versionId = randomUUID();
      const rows = await this.db.query<MediaAssetRecord>(
        `INSERT INTO "MediaAsset" (
           "id", "workspaceId", "connectionId", "driveFileId", "fileName",
           "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
           "platforms", "status", "version", "isSharedMedia"
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, 1, $13
         )
         RETURNING "id", "workspaceId", "connectionId", "driveFileId", "fileName",
                   "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
                   "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"`,
        [
          id,
          input.workspaceId,
          input.connectionId ?? null,
          input.driveFileId,
          input.fileName,
          input.mimeType,
          input.sizeBytes,
          input.checksum,
          input.topicCode,
          input.postCodeHint ?? null,
          input.platforms ?? ["ZALO", "FACEBOOK"],
          input.status ?? "PENDING",
          input.isSharedMedia ?? false,
        ],
      );

      await this.db.execute(
        `INSERT INTO "MediaVersion" (
           "id", "mediaId", "version", "checksum", "sizeBytes"
         ) VALUES ($1, $2, 1, $3, $4)`,
        [versionId, id, input.checksum, input.sizeBytes],
      );

      return rows[0]!;
    }

    if (existing.checksum === input.checksum) {
      const rows = await this.db.query<MediaAssetRecord>(
        `UPDATE "MediaAsset"
         SET "fileName" = $1,
             "topicCode" = $2,
             "postCodeHint" = $3,
             "platforms" = $4,
             "status" = $5,
             "isSharedMedia" = $6,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $7
         RETURNING "id", "workspaceId", "connectionId", "driveFileId", "fileName",
                   "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
                   "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"`,
        [
          input.fileName,
          input.topicCode,
          input.postCodeHint ?? existing.postCodeHint,
          input.platforms ?? existing.platforms,
          input.status ?? existing.status,
          input.isSharedMedia ?? existing.isSharedMedia,
          existing.id,
        ],
      );
      return rows[0]!;
    }

    const nextVersion = existing.version + 1;
    const versionId = randomUUID();
    const rows = await this.db.query<MediaAssetRecord>(
      `UPDATE "MediaAsset"
       SET "fileName" = $1,
           "mimeType" = $2,
           "sizeBytes" = $3,
           "checksum" = $4,
           "topicCode" = $5,
           "postCodeHint" = $6,
           "platforms" = $7,
           "status" = $8,
           "version" = $9,
           "isSharedMedia" = $10,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $11
       RETURNING "id", "workspaceId", "connectionId", "driveFileId", "fileName",
                 "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
                 "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"`,
      [
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.checksum,
        input.topicCode,
        input.postCodeHint ?? existing.postCodeHint,
        input.platforms ?? existing.platforms,
        input.status ?? existing.status,
        nextVersion,
        input.isSharedMedia ?? existing.isSharedMedia,
        existing.id,
      ],
    );

    await this.db.execute(
      `INSERT INTO "MediaVersion" (
         "id", "mediaId", "version", "checksum", "sizeBytes"
       ) VALUES ($1, $2, $3, $4, $5)`,
      [versionId, existing.id, nextVersion, input.checksum, input.sizeBytes],
    );

    return rows[0]!;
  }

  async getMediaById(workspaceId: string, id: string): Promise<MediaAssetRecord | null> {
    const rows = await this.db.query<MediaAssetRecord>(
      `SELECT "id", "workspaceId", "connectionId", "driveFileId", "fileName",
              "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
              "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"
       FROM "MediaAsset"
       WHERE "workspaceId" = $1 AND "id" = $2`,
      [workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async getMediaByDriveFileId(workspaceId: string, driveFileId: string): Promise<MediaAssetRecord | null> {
    const rows = await this.db.query<MediaAssetRecord>(
      `SELECT "id", "workspaceId", "connectionId", "driveFileId", "fileName",
              "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
              "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"
       FROM "MediaAsset"
       WHERE "workspaceId" = $1 AND "driveFileId" = $2`,
      [workspaceId, driveFileId],
    );
    return rows[0] ?? null;
  }

  async findMediaByChecksum(workspaceId: string, checksum: string): Promise<MediaAssetRecord | null> {
    const rows = await this.db.query<MediaAssetRecord>(
      `SELECT "id", "workspaceId", "connectionId", "driveFileId", "fileName",
              "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
              "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"
       FROM "MediaAsset"
       WHERE "workspaceId" = $1 AND "checksum" = $2
       LIMIT 1`,
      [workspaceId, checksum],
    );
    return rows[0] ?? null;
  }

  async listMediaAssets(
    workspaceId: string,
    filters?: { topicCode?: string; status?: string },
  ): Promise<MediaAssetRecord[]> {
    const conditions: string[] = ['"workspaceId" = $1'];
    const values: unknown[] = [workspaceId];

    if (filters?.topicCode) {
      values.push(filters.topicCode);
      conditions.push(`"topicCode" = $${values.length}`);
    }

    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`"status" = $${values.length}`);
    }

    return this.db.query<MediaAssetRecord>(
      `SELECT "id", "workspaceId", "connectionId", "driveFileId", "fileName",
              "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
              "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"
       FROM "MediaAsset"
       WHERE ${conditions.join(" AND ")}
       ORDER BY "createdAt" DESC`,
      values,
    );
  }

  async listMediaVersions(mediaId: string): Promise<MediaVersionRecord[]> {
    return this.db.query<MediaVersionRecord>(
      `SELECT "id", "mediaId", "version", "checksum", "sizeBytes", "createdAt"
       FROM "MediaVersion"
       WHERE "mediaId" = $1
       ORDER BY "version" ASC`,
      [mediaId],
    );
  }

  async updateMediaStatus(
    workspaceId: string,
    id: string,
    status: string,
  ): Promise<MediaAssetRecord | null> {
    const rows = await this.db.query<MediaAssetRecord>(
      `UPDATE "MediaAsset"
       SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $2 AND "id" = $3
       RETURNING "id", "workspaceId", "connectionId", "driveFileId", "fileName",
                 "mimeType", "sizeBytes", "checksum", "topicCode", "postCodeHint",
                 "platforms", "status", "version", "isSharedMedia", "createdAt", "updatedAt"`,
      [status, workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async linkMediaToContent(input: LinkMediaToContentInput): Promise<ContentMediaLinkRecord> {
    const id = randomUUID();
    const rows = await this.db.query<ContentMediaLinkRecord>(
      `INSERT INTO "ContentMediaLink" (
         "id", "contentId", "mediaId", "position", "matchMethod", "matchScore"
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("contentId", "mediaId")
       DO UPDATE SET
         "position" = EXCLUDED."position",
         "matchMethod" = EXCLUDED."matchMethod",
         "matchScore" = EXCLUDED."matchScore"
       RETURNING "id", "contentId", "mediaId", "position", "matchMethod", "matchScore", "createdAt"`,
      [
        id,
        input.contentId,
        input.mediaId,
        input.position ?? 0,
        input.matchMethod ?? "TOPIC",
        input.matchScore ?? 1.0,
      ],
    );
    return rows[0]!;
  }

  async listMediaForContent(contentId: string): Promise<LinkedMediaAssetRecord[]> {
    return this.db.query<LinkedMediaAssetRecord>(
      `SELECT m."id", m."workspaceId", m."connectionId", m."driveFileId", m."fileName",
              m."mimeType", m."sizeBytes", m."checksum", m."topicCode", m."postCodeHint",
              m."platforms", m."status", m."version", m."isSharedMedia", m."createdAt", m."updatedAt",
              l."position", l."matchMethod", l."matchScore"
       FROM "ContentMediaLink" l
       JOIN "MediaAsset" m ON m."id" = l."mediaId"
       WHERE l."contentId" = $1
       ORDER BY l."position" ASC`,
      [contentId],
    );
  }

  async recordContentApproval(input: RecordContentApprovalInput): Promise<ContentApprovalRecord> {
    const id = randomUUID();
    const rows = await this.db.query<ContentApprovalRecord>(
      `INSERT INTO "ContentApproval" (
         "id", "workspaceId", "contentId", "contentVersion", "mediaVersion",
         "approvedBy", "status", "approvedPlatforms", "notes"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING "id", "workspaceId", "contentId", "contentVersion", "mediaVersion",
                 "approvedBy", "status", "approvedPlatforms", "notes", "createdAt"`,
      [
        id,
        input.workspaceId,
        input.contentId,
        input.contentVersion,
        input.mediaVersion ?? null,
        input.approvedBy,
        input.status,
        input.approvedPlatforms ?? ["ZALO", "FACEBOOK"],
        input.notes ?? null,
      ],
    );

    await this.updatePostStatus(input.workspaceId, input.contentId, input.status);
    return rows[0]!;
  }

  async listContentApprovals(contentId: string): Promise<ContentApprovalRecord[]> {
    return this.db.query<ContentApprovalRecord>(
      `SELECT "id", "workspaceId", "contentId", "contentVersion", "mediaVersion",
              "approvedBy", "status", "approvedPlatforms", "notes", "createdAt"
       FROM "ContentApproval"
       WHERE "contentId" = $1
       ORDER BY "createdAt" ASC`,
      [contentId],
    );
  }

  async upsertSocialAccount(input: UpsertSocialAccountInput): Promise<SocialAccountRecord> {
    const cleanCode = input.accountCode.trim();
    const profileDir = input.profileDir ?? `storage/browser_profiles/${cleanCode}`;
    const existing = await this.getSocialAccountByCode(input.workspaceId, cleanCode);

    if (existing) {
      const rows = await this.db.query<SocialAccountRecord>(
        `UPDATE "SocialAccount"
         SET "displayName" = $1,
             "assignedTopics" = $2,
             "maxPostsPerDay" = $3,
             "minIntervalMinutes" = $4,
             "preferredWindows" = $5,
             "status" = $6,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $7
         RETURNING "id", "workspaceId", "accountCode", "platform", "displayName",
                   "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
                   "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
                   "createdAt", "updatedAt"`,
        [
          input.displayName,
          input.assignedTopics ?? existing.assignedTopics,
          input.maxPostsPerDay ?? existing.maxPostsPerDay,
          input.minIntervalMinutes ?? existing.minIntervalMinutes,
          input.preferredWindows ?? existing.preferredWindows,
          input.status ?? existing.status,
          existing.id,
        ],
      );
      return rows[0]!;
    }

    const id = randomUUID();
    const rows = await this.db.query<SocialAccountRecord>(
      `INSERT INTO "SocialAccount" (
         "id", "workspaceId", "accountCode", "platform", "displayName",
         "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
         "minIntervalMinutes", "preferredWindows", "status"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING "id", "workspaceId", "accountCode", "platform", "displayName",
                 "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
                 "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
                 "createdAt", "updatedAt"`,
      [
        id,
        input.workspaceId,
        cleanCode,
        input.platform,
        input.displayName,
        input.ownerUserId,
        profileDir,
        input.assignedTopics ?? [],
        input.maxPostsPerDay ?? 2,
        input.minIntervalMinutes ?? 180,
        input.preferredWindows ?? [],
        input.status ?? "NEEDS_AUTH",
      ],
    );
    return rows[0]!;
  }

  async getSocialAccountById(workspaceId: string, id: string): Promise<SocialAccountRecord | null> {
    const rows = await this.db.query<SocialAccountRecord>(
      `SELECT "id", "workspaceId", "accountCode", "platform", "displayName",
              "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
              "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
              "createdAt", "updatedAt"
       FROM "SocialAccount"
       WHERE "workspaceId" = $1 AND "id" = $2`,
      [workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async getSocialAccountByCode(
    workspaceId: string,
    accountCode: string,
  ): Promise<SocialAccountRecord | null> {
    const rows = await this.db.query<SocialAccountRecord>(
      `SELECT "id", "workspaceId", "accountCode", "platform", "displayName",
              "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
              "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
              "createdAt", "updatedAt"
       FROM "SocialAccount"
       WHERE "workspaceId" = $1 AND "accountCode" = $2`,
      [workspaceId, accountCode],
    );
    return rows[0] ?? null;
  }

  async listSocialAccounts(
    workspaceId: string,
    filters?: { platform?: string; status?: string },
  ): Promise<SocialAccountRecord[]> {
    const conditions: string[] = [`"workspaceId" = $1`];
    const values: unknown[] = [workspaceId];

    if (filters?.platform) {
      values.push(filters.platform);
      conditions.push(`"platform" = $${values.length}`);
    }
    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`"status" = $${values.length}`);
    }

    return this.db.query<SocialAccountRecord>(
      `SELECT "id", "workspaceId", "accountCode", "platform", "displayName",
              "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
              "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
              "createdAt", "updatedAt"
       FROM "SocialAccount"
       WHERE ${conditions.join(" AND ")}
       ORDER BY "createdAt" DESC`,
      values,
    );
  }

  async updateSocialAccount(
    workspaceId: string,
    id: string,
    input: UpdateSocialAccountInput,
  ): Promise<SocialAccountRecord | null> {
    const existing = await this.getSocialAccountById(workspaceId, id);
    if (!existing) return null;

    const rows = await this.db.query<SocialAccountRecord>(
      `UPDATE "SocialAccount"
       SET "displayName" = $1,
           "assignedTopics" = $2,
           "maxPostsPerDay" = $3,
           "minIntervalMinutes" = $4,
           "preferredWindows" = $5,
           "status" = $6,
           "lastSessionCheckAt" = $7,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $8 AND "id" = $9
       RETURNING "id", "workspaceId", "accountCode", "platform", "displayName",
                 "ownerUserId", "profileDir", "assignedTopics", "maxPostsPerDay",
                 "minIntervalMinutes", "preferredWindows", "status", "lastSessionCheckAt",
                 "createdAt", "updatedAt"`,
      [
        input.displayName ?? existing.displayName,
        input.assignedTopics ?? existing.assignedTopics,
        input.maxPostsPerDay ?? existing.maxPostsPerDay,
        input.minIntervalMinutes ?? existing.minIntervalMinutes,
        input.preferredWindows ?? existing.preferredWindows,
        input.status ?? existing.status,
        input.lastSessionCheckAt !== undefined
          ? input.lastSessionCheckAt
            ? new Date(input.lastSessionCheckAt).toISOString()
            : null
          : existing.lastSessionCheckAt,
        workspaceId,
        id,
      ],
    );
    return rows[0] ?? null;
  }

  async createPublishingCampaign(
    input: CreatePublishingCampaignInput,
  ): Promise<PublishingCampaignRecord> {
    const id = randomUUID();
    const rows = await this.db.query<PublishingCampaignRecord>(
      `INSERT INTO "PublishingCampaign" (
         "id", "workspaceId", "name", "topicCodes", "accountIds",
         "startDate", "endDate", "status"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING "id", "workspaceId", "name", "topicCodes", "accountIds",
                 "startDate", "endDate", "status", "createdAt", "updatedAt"`,
      [
        id,
        input.workspaceId,
        input.name,
        input.topicCodes ?? [],
        input.accountIds ?? [],
        input.startDate ? new Date(input.startDate).toISOString() : null,
        input.endDate ? new Date(input.endDate).toISOString() : null,
        input.status ?? "ACTIVE",
      ],
    );
    return rows[0]!;
  }

  async listPublishingCampaigns(workspaceId: string): Promise<PublishingCampaignRecord[]> {
    return this.db.query<PublishingCampaignRecord>(
      `SELECT "id", "workspaceId", "name", "topicCodes", "accountIds",
              "startDate", "endDate", "status", "createdAt", "updatedAt"
       FROM "PublishingCampaign"
       WHERE "workspaceId" = $1
       ORDER BY "createdAt" DESC`,
      [workspaceId],
    );
  }

  async createPublishingSchedule(
    input: CreatePublishingScheduleInput,
  ): Promise<PublishingScheduleRecord> {
    const id = randomUUID();
    const rows = await this.db.query<PublishingScheduleRecord>(
      `INSERT INTO "PublishingSchedule" (
         "id", "workspaceId", "campaignId", "contentId", "accountId",
         "platform", "scheduledAt", "publishMode", "status"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING "id", "workspaceId", "campaignId", "contentId", "accountId",
                 "platform", "scheduledAt", "publishMode", "status", "createdAt", "updatedAt"`,
      [
        id,
        input.workspaceId,
        input.campaignId ?? null,
        input.contentId,
        input.accountId,
        input.platform,
        new Date(input.scheduledAt).toISOString(),
        input.publishMode ?? "ASSISTED_PUBLISH",
        input.status ?? "SCHEDULED",
      ],
    );
    return rows[0]!;
  }

  async listPublishingSchedules(
    workspaceId: string,
    filters?: { accountId?: string; status?: string },
  ): Promise<PublishingScheduleRecord[]> {
    const conditions: string[] = [`"workspaceId" = $1`];
    const values: unknown[] = [workspaceId];

    if (filters?.accountId) {
      values.push(filters.accountId);
      conditions.push(`"accountId" = $${values.length}`);
    }
    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`"status" = $${values.length}`);
    }

    return this.db.query<PublishingScheduleRecord>(
      `SELECT "id", "workspaceId", "campaignId", "contentId", "accountId",
              "platform", "scheduledAt", "publishMode", "status", "createdAt", "updatedAt"
       FROM "PublishingSchedule"
       WHERE ${conditions.join(" AND ")}
       ORDER BY "scheduledAt" ASC`,
      values,
    );
  }

  async createPublishingJob(input: CreatePublishingJobInput): Promise<PublishingJobRecord> {
    const id = randomUUID();
    const rows = await this.db.query<PublishingJobRecord>(
      `INSERT INTO "PublishingJob" (
         "id", "workspaceId", "scheduleId", "contentId", "accountId",
         "platform", "publishMode", "scheduledAt", "idempotencyKey", "status"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING "id", "workspaceId", "scheduleId", "contentId", "accountId",
                 "platform", "publishMode", "scheduledAt", "idempotencyKey", "status",
                 "errorCode", "errorMessage", "retryCount", "createdAt", "updatedAt"`,
      [
        id,
        input.workspaceId,
        input.scheduleId ?? null,
        input.contentId,
        input.accountId,
        input.platform,
        input.publishMode ?? "ASSISTED_PUBLISH",
        new Date(input.scheduledAt).toISOString(),
        input.idempotencyKey,
        input.status ?? "QUEUED",
      ],
    );
    return rows[0]!;
  }

  async getPublishingJobById(
    workspaceId: string,
    id: string,
  ): Promise<PublishingJobRecord | null> {
    const rows = await this.db.query<PublishingJobRecord>(
      `SELECT "id", "workspaceId", "scheduleId", "contentId", "accountId",
              "platform", "publishMode", "scheduledAt", "idempotencyKey", "status",
              "errorCode", "errorMessage", "retryCount", "createdAt", "updatedAt"
       FROM "PublishingJob"
       WHERE "workspaceId" = $1 AND "id" = $2`,
      [workspaceId, id],
    );
    return rows[0] ?? null;
  }

  async listPublishingJobs(
    workspaceId: string,
    filters?: { accountId?: string; status?: string },
  ): Promise<PublishingJobRecord[]> {
    const conditions: string[] = [`"workspaceId" = $1`];
    const values: unknown[] = [workspaceId];

    if (filters?.accountId) {
      values.push(filters.accountId);
      conditions.push(`"accountId" = $${values.length}`);
    }
    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`"status" = $${values.length}`);
    }

    return this.db.query<PublishingJobRecord>(
      `SELECT "id", "workspaceId", "scheduleId", "contentId", "accountId",
              "platform", "publishMode", "scheduledAt", "idempotencyKey", "status",
              "errorCode", "errorMessage", "retryCount", "createdAt", "updatedAt"
       FROM "PublishingJob"
       WHERE ${conditions.join(" AND ")}
       ORDER BY "scheduledAt" ASC`,
      values,
    );
  }

  async updatePublishingJobStatus(
    workspaceId: string,
    id: string,
    input: {
      status: string;
      errorCode?: string | null;
      errorMessage?: string | null;
      retryCount?: number;
    },
  ): Promise<PublishingJobRecord | null> {
    const existing = await this.getPublishingJobById(workspaceId, id);
    if (!existing) return null;

    const rows = await this.db.query<PublishingJobRecord>(
      `UPDATE "PublishingJob"
       SET "status" = $1,
           "errorCode" = $2,
           "errorMessage" = $3,
           "retryCount" = $4,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $5 AND "id" = $6
       RETURNING "id", "workspaceId", "scheduleId", "contentId", "accountId",
                 "platform", "publishMode", "scheduledAt", "idempotencyKey", "status",
                 "errorCode", "errorMessage", "retryCount", "createdAt", "updatedAt"`,
      [
        input.status,
        input.errorCode !== undefined ? input.errorCode : existing.errorCode,
        input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
        input.retryCount ?? existing.retryCount,
        workspaceId,
        id,
      ],
    );
    return rows[0] ?? null;
  }

  async appendPublishingJobStep(
    input: AppendPublishingJobStepInput,
  ): Promise<PublishingJobStepRecord> {
    const id = randomUUID();
    const rows = await this.db.query<PublishingJobStepRecord>(
      `INSERT INTO "PublishingJobStep" (
         "id", "jobId", "stepName", "status", "details"
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING "id", "jobId", "stepName", "status", "details", "createdAt"`,
      [id, input.jobId, input.stepName, input.status, input.details ?? null],
    );
    return rows[0]!;
  }

  async listPublishingJobSteps(jobId: string): Promise<PublishingJobStepRecord[]> {
    return this.db.query<PublishingJobStepRecord>(
      `SELECT "id", "jobId", "stepName", "status", "details", "createdAt"
       FROM "PublishingJobStep"
       WHERE "jobId" = $1
       ORDER BY "createdAt" ASC`,
      [jobId],
    );
  }

  async recordPublishingResult(
    input: RecordPublishingResultInput,
  ): Promise<PublishingResultRecord> {
    const id = randomUUID();
    const rows = await this.db.query<PublishingResultRecord>(
      `INSERT INTO "PublishingResult" (
         "id", "jobId", "workspaceId", "contentId", "accountId",
         "platform", "status", "publishedUrl", "screenshotPath", "confirmedBy"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ("jobId")
       DO UPDATE SET
         "status" = EXCLUDED."status",
         "publishedUrl" = EXCLUDED."publishedUrl",
         "screenshotPath" = EXCLUDED."screenshotPath",
         "confirmedBy" = EXCLUDED."confirmedBy",
         "publishedAt" = CURRENT_TIMESTAMP
       RETURNING "id", "jobId", "workspaceId", "contentId", "accountId",
                 "platform", "status", "publishedUrl", "screenshotPath", "confirmedBy", "publishedAt"`,
      [
        id,
        input.jobId,
        input.workspaceId,
        input.contentId,
        input.accountId,
        input.platform,
        input.status,
        input.publishedUrl ?? null,
        input.screenshotPath ?? null,
        input.confirmedBy ?? null,
      ],
    );
    return rows[0]!;
  }

  async getPublishingResultByJobId(jobId: string): Promise<PublishingResultRecord | null> {
    const rows = await this.db.query<PublishingResultRecord>(
      `SELECT "id", "jobId", "workspaceId", "contentId", "accountId",
              "platform", "status", "publishedUrl", "screenshotPath", "confirmedBy", "publishedAt"
       FROM "PublishingResult"
       WHERE "jobId" = $1`,
      [jobId],
    );
    return rows[0] ?? null;
  }
}

