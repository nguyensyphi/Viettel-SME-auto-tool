export interface QueueJobOptions {
  idempotencyKey: string;
  maxRetries?: number;
  backoffDelayMs?: number;
  [key: string]: unknown;
}

export interface SanitizedJobOptions {
  jobId: string;
  maxRetries: number;
  backoff: {
    type: "exponential";
    delay: number;
  };
}

export interface EnqueueJobPayload<T = unknown> {
  idempotencyKey: string;
  payload: T;
  maxRetries?: number;
  backoffDelayMs?: number;
}

export interface JobSubmissionResult {
  status: "enqueued" | "duplicate_ignored";
  jobId: string;
}

export interface SafeQueueManagerOptions {
  defaultMaxRetries?: number;
  defaultBackoffMs?: number;
  deduplicationWindowMs?: number;
}

export class SafeQueueManager {
  private readonly defaultMaxRetries: number;
  private readonly defaultBackoffMs: number;
  private readonly maxRetriesCap: number = 3;
  private readonly processedKeys = new Map<string, number>();
  private readonly deduplicationWindowMs: number;

  constructor(options?: SafeQueueManagerOptions) {
    this.defaultMaxRetries = options?.defaultMaxRetries ?? 3;
    this.defaultBackoffMs = options?.defaultBackoffMs ?? 1000;
    this.deduplicationWindowMs = options?.deduplicationWindowMs ?? 60_000;
  }

  sanitizeJobOptions(options: QueueJobOptions): SanitizedJobOptions {
    if (!options.idempotencyKey || typeof options.idempotencyKey !== "string") {
      throw new Error("idempotencyKey is required and must be a non-empty string");
    }

    const requestedRetries = options.maxRetries ?? this.defaultMaxRetries;
    const cappedRetries = Math.min(requestedRetries, this.maxRetriesCap);
    const delay = options.backoffDelayMs ?? this.defaultBackoffMs;

    return {
      jobId: options.idempotencyKey,
      maxRetries: cappedRetries,
      backoff: {
        type: "exponential",
        delay,
      },
    };
  }

  async submitJob<T>(
    queueName: string,
    jobPayload: EnqueueJobPayload<T>,
  ): Promise<JobSubmissionResult> {
    if (!jobPayload.idempotencyKey || typeof jobPayload.idempotencyKey !== "string") {
      throw new Error("idempotencyKey is required and must be a non-empty string");
    }

    const key = `${queueName}:${jobPayload.idempotencyKey}`;
    const now = Date.now();
    const existingTimestamp = this.processedKeys.get(key);

    if (existingTimestamp && now - existingTimestamp < this.deduplicationWindowMs) {
      return {
        status: "duplicate_ignored",
        jobId: jobPayload.idempotencyKey,
      };
    }

    this.processedKeys.set(key, now);

    return {
      status: "enqueued",
      jobId: jobPayload.idempotencyKey,
    };
  }
}
