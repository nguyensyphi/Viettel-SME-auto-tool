import { parseStructuredPosts, type ParsedPost } from "./content-parser.js";

export interface GoogleDocStructuralElement {
  paragraph?: {
    elements?: Array<{
      textRun?: {
        content?: string | undefined;
      } | undefined;
    }> | undefined;
  } | undefined;
}

export interface GoogleDocPayload {
  documentId: string;
  title?: string | undefined;
  revisionId?: string | undefined;
  body?: {
    content?: GoogleDocStructuralElement[] | undefined;
  } | undefined;
}

export interface GoogleDocsTransport {
  fetchDocument(documentId: string): Promise<GoogleDocPayload>;
}

export function createBearerGoogleDocsTransport(accessToken: string): GoogleDocsTransport {
  return {
    async fetchDocument(documentId: string): Promise<GoogleDocPayload> {
      const encoded = encodeURIComponent(documentId.trim());
      const res = await fetch(`https://docs.googleapis.com/v1/documents/${encoded}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Google Docs API failed with HTTP ${res.status}`);
      }
      return (await res.json()) as GoogleDocPayload;
    },
  };
}

export class GoogleDocsConnector {
  constructor(private readonly transport: GoogleDocsTransport) {}

  async importPostsFromDoc(documentId: string): Promise<ParsedPost[]> {
    const cleanId = documentId?.trim() ?? "";
    if (!cleanId) {
      throw new Error("documentId is required");
    }

    const doc = await this.transport.fetchDocument(cleanId);
    const chunks: string[] = [];

    for (const block of doc.body?.content ?? []) {
      for (const el of block.paragraph?.elements ?? []) {
        if (el.textRun?.content) {
          chunks.push(el.textRun.content);
        }
      }
    }

    return parseStructuredPosts(chunks.join(""));
  }

  async fetchDocumentWithText(documentId: string): Promise<{
    documentId: string;
    title: string;
    revisionId: string | null;
    rawText: string;
    posts: ParsedPost[];
  }> {
    const cleanId = documentId?.trim() ?? "";
    if (!cleanId) {
      throw new Error("documentId is required");
    }

    const doc = await this.transport.fetchDocument(cleanId);
    const chunks: string[] = [];

    for (const block of doc.body?.content ?? []) {
      for (const el of block.paragraph?.elements ?? []) {
        if (el.textRun?.content) {
          chunks.push(el.textRun.content);
        }
      }
    }

    const rawText = chunks.join("");
    const posts = parseStructuredPosts(rawText);

    return {
      documentId: cleanId,
      title: doc.title ?? `Google Doc ${cleanId}`,
      revisionId: doc.revisionId ?? null,
      rawText,
      posts,
    };
  }
}

