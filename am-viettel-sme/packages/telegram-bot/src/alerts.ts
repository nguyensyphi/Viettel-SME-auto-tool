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
  /(?:\b(?:password|passwd|mật\s*khẩu|secret|bot_token|api[_-]?key)\s*[:=]|data:image\/[a-zA-Z0-9.+-]+;base64,)/iu;

const RAW_PII_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\r]{0,25}\b\d{9,12}\b|\b0\d{11}\b)/iu;

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
}

