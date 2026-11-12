export interface TelegramTransport {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export class TelegramHttpTransport implements TelegramTransport {
  private readonly baseUrl: string;

  constructor(
    private readonly botToken: string,
    options?: { apiBaseUrl?: string | undefined },
  ) {
    if (!botToken.trim()) {
      throw new Error("TELEGRAM_BOT_TOKEN_REQUIRED");
    }
    this.baseUrl = options?.apiBaseUrl ?? "https://api.telegram.org";
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    assertSafeTelegramText(text);
    const response = await fetch(
      `${this.baseUrl}/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`TELEGRAM_API_HTTP_${response.status}`);
    }
  }
}

const SECRET_OR_QR_PATTERN =
  /(?:\b(?:password|passwd|mật\s*khẩu|secret|bot_token|api[_-]?key)\s*[:=]|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bbot\d{6,}:[A-Za-z0-9_-]{15,}|data:image\/[a-zA-Z0-9.+-]+;base64,|https?:\/\/\S*(?:qr|qrcode)\S*\.(?:png|jpg|jpeg|webp|svg)\b)/iu;

const RAW_PII_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\r]{0,25}\b\d{9,12}\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|dob|birthdate)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/iu;

export function assertSafeTelegramText(text: string): void {
  if (SECRET_OR_QR_PATTERN.test(text) || RAW_PII_PATTERN.test(text)) {
    throw new Error(
      "FORBIDDEN_TELEGRAM_PAYLOAD: Never transmit passwords, QR login images, or CCCD/CMND PII over Telegram",
    );
  }
}

export type SystemAlertType =
  | "NEEDS_LOGIN"
  | "CIRCUIT_OPEN"
  | "DLQ_JOB"
  | "KILL_SWITCH_CHANGED"
  | "SECURITY_WARNING";

export interface SystemAlertInput {
  type: SystemAlertType;
  accountId?: string | undefined;
  platform?: "ZALO" | "FACEBOOK" | undefined;
  detail: string;
}

export interface TelegramAlertDispatcherOptions {
  adminChatIds: readonly string[];
  transport: TelegramTransport;
}

export type PublishingNotificationEvent =
  | "SESSION_EXPIRED"
  | "WAITING_CONFIRMATION"
  | "PUBLISHED"
  | "JOB_FAILED";

export interface PublishingNotificationInput {
  readonly event: PublishingNotificationEvent;
  readonly accountCode: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly postCode?: string | undefined;
  readonly postTitle?: string | undefined;
  readonly reason?: string | undefined;
  readonly dashboardUrl?: string | undefined;
}

export interface MorningDigestItem {
  readonly timeLabel: string;
  readonly accountCode: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly postCode: string;
  readonly topicCode: string;
}

export interface MorningScheduleDigestInput {
  readonly dateLabel: string;
  readonly scheduledCount: number;
  readonly waitingConfirmationCount: number;
  readonly expiredAccountsCount: number;
  readonly items: readonly MorningDigestItem[];
}

export class TelegramAlertDispatcher {
  private readonly adminChatIds: readonly string[];
  private readonly transport: TelegramTransport;

  constructor(options: TelegramAlertDispatcherOptions) {
    this.adminChatIds = [...options.adminChatIds];
    this.transport = options.transport;
  }

  async sendSystemAlert(alert: SystemAlertInput): Promise<void> {
    assertSafeTelegramText(alert.detail);

    const lines = [
      `[AM-SME ALERT] ${alert.type}`,
      ...(alert.accountId ? [`Account: ${alert.accountId}`] : []),
      ...(alert.platform ? [`Platform: ${alert.platform}`] : []),
      `Detail: ${alert.detail}`,
    ];
    const message = lines.join("\n");
    assertSafeTelegramText(message);

    for (const chatId of this.adminChatIds) {
      await this.transport.sendMessage(chatId, message);
    }
  }

  async sendPublishingNotification(input: PublishingNotificationInput): Promise<void> {
    const lines = [
      `[MOD-PB-002] ${input.event}`,
      `Account: ${input.accountCode} (${input.platform})`,
      ...(input.postCode ? [`Post: ${input.postCode}`] : []),
      ...(input.postTitle ? [`Title: ${input.postTitle}`] : []),
      ...(input.reason ? [`Reason: ${input.reason}`] : []),
      ...(input.dashboardUrl ? [`Dashboard: ${input.dashboardUrl}`] : []),
    ];
    const message = lines.join("\n");
    assertSafeTelegramText(message);

    for (const chatId of this.adminChatIds) {
      await this.transport.sendMessage(chatId, message);
    }
  }

  async sendMorningScheduleDigest(input: MorningScheduleDigestInput): Promise<void> {
    const itemLines = input.items.map(
      (item) =>
        `- ${item.timeLabel} | ${item.accountCode} (${item.platform}) | ${item.postCode} [${item.topicCode}]`,
    );
    const lines = [
      `=== LỊCH ĐĂNG BÀI NGÀY ${input.dateLabel} ===`,
      `Scheduled: ${input.scheduledCount} | Chờ xác nhận: ${input.waitingConfirmationCount} | Cần đăng nhập lại: ${input.expiredAccountsCount}`,
      ...itemLines,
    ];
    const message = lines.join("\n");
    assertSafeTelegramText(message);

    for (const chatId of this.adminChatIds) {
      await this.transport.sendMessage(chatId, message);
    }
  }
}

