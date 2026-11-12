import { createHash } from "node:crypto";
import { GoogleDocsConnector } from "./google-docs-connector.js";
import { TopicClassifier } from "./topic-classifier.js";
import { calculateContentHash, type ParsedPost } from "./content-parser.js";

export interface ContentLibraryStore {
  upsertGoogleDocument(input: {
    connectionId: string;
    documentId: string;
    name: string;
    revisionId?: string | null;
    contentHash?: string | null;
    postCount?: number;
    modifiedAt?: Date | string | null;
  }): Promise<{ id: string; name: string; documentId?: string }>;

  upsertPost(input: {
    workspaceId: string;
    documentId?: string | null;
    postCode: string;
    title: string;
    body: string;
    topicCode: string;
    targetAudience?: string;
    platforms?: readonly string[];
    status?: string;
    priority?: string;
    mediaHint?: string | null;
    hashtags?: readonly string[];
    contentHash: string;
    validFrom?: Date | string | null;
    validUntil?: Date | string | null;
  }): Promise<{ id: string; postCode: string; version: number; status: string; topicCode?: string }>;
}

export interface SyncDocumentOptions {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly documentId: string;
}

export interface SyncDocumentResult {
  readonly success: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly document?: { id: string; name: string };
  readonly postsCount?: number;
  readonly posts?: Array<{ id: string; postCode: string; version: number; status: string }>;
}

export class GoogleDocsSyncService {
  constructor(
    private readonly connector: GoogleDocsConnector,
    private readonly classifier: TopicClassifier,
    private readonly store: ContentLibraryStore,
  ) {}

  async syncDocument(options: SyncDocumentOptions): Promise<SyncDocumentResult> {
    try {
      const fetched = await this.connector.fetchDocumentWithText(options.documentId);
      const documentHash = createHash("sha256").update(fetched.rawText).digest("hex");

      const docRecord = await this.store.upsertGoogleDocument({
        connectionId: options.connectionId,
        documentId: fetched.documentId,
        name: fetched.title,
        revisionId: fetched.revisionId,
        contentHash: documentHash,
        postCount: fetched.posts.length,
      });

      const savedPosts: Array<{ id: string; postCode: string; version: number; status: string }> = [];

      for (let i = 0; i < fetched.posts.length; i++) {
        const post = fetched.posts[i]!;
        
        // Topic classification
        let topicCode = post.topic?.trim() || "";
        if (!topicCode || topicCode === "AUTO" || topicCode === "NEEDS_CLASSIFICATION") {
          const classified = this.classifier.classify(post);
          topicCode = classified.topic;
        }

        const contentHash = post.contentHash || calculateContentHash(post);

        const saved = await this.store.upsertPost({
          workspaceId: options.workspaceId,
          documentId: docRecord.id,
          postCode: post.postId ?? `PB_${i + 1}`,
          title: post.title ?? post.contentId,
          body: post.content,
          topicCode,
          targetAudience: post.target ?? "BUSINESS_OWNER",
          platforms: post.platforms ?? ["ZALO", "FACEBOOK"],
          status: post.status ?? "DRAFT",
          priority: post.publishPriority ?? "NORMAL",
          mediaHint: post.media ?? null,
          hashtags: post.hashtags ?? [],
          contentHash,
          validFrom: post.publishFrom ? new Date(post.publishFrom) : null,
          validUntil: post.publishUntil ? new Date(post.publishUntil) : null,
        });

        savedPosts.push(saved);
      }

      return {
        success: true,
        document: docRecord,
        postsCount: savedPosts.length,
        posts: savedPosts,
      };
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      if (msg.includes("PII_DETECTED")) {
        return {
          success: false,
          errorCode: "PII_DETECTED",
          errorMessage: msg,
        };
      }
      return {
        success: false,
        errorCode: "SYNC_DOCUMENT_FAILED",
        errorMessage: msg,
      };
    }
  }
}

