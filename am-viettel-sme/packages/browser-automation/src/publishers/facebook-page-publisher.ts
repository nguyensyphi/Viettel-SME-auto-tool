import fs from "node:fs";

export type FacebookAccountHealth =
  | "ACTIVE_OK"
  | "CHECKPOINT_2FA"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED_BLOCK"
  | "WARMUP_NEW_NICK";

export interface PagePublishInput {
  readonly accountId: string;
  readonly targetType: "PERSONAL_WALL" | "FANPAGE";
  readonly targetUrl?: string | undefined; // Page URL or timeline
  readonly content: string;
  readonly mediaPaths?: readonly string[] | undefined;
  readonly callToActionUrl?: string | undefined;
  readonly submit?: boolean | undefined;
  readonly onLog?: ((msg: string) => void) | undefined;
}

export interface PagePublishResult {
  readonly success: boolean;
  readonly postUrl?: string | undefined;
  readonly screenshotProofPath?: string | undefined;
  readonly healthStatus: FacebookAccountHealth;
  readonly error?: string | undefined;
}

export function evaluateFacebookAccountHealth(currentUrl: string, bodyText: string = ""): FacebookAccountHealth {
  const urlLower = currentUrl.toLowerCase();
  const textLower = bodyText.toLowerCase();

  if (urlLower.includes("checkpoint") || urlLower.includes("suspended") || textLower.includes("xác nhận danh tính") || textLower.includes("phê duyệt đăng nhập")) {
    return "CHECKPOINT_2FA";
  }
  if (urlLower.includes("login") || urlLower.includes("/login/") || textLower.includes("đăng nhập vào facebook")) {
    return "SESSION_EXPIRED";
  }
  if (textLower.includes("bạn tạm thời bị chặn") || textLower.includes("you're temporarily blocked") || textLower.includes("bị hạn chế")) {
    return "RATE_LIMITED_BLOCK";
  }
  return "ACTIVE_OK";
}

export async function publishToFacebookPageOrWall(
  page: any,
  input: PagePublishInput,
): Promise<PagePublishResult> {
  const { targetType, targetUrl, content, mediaPaths, submit = true, onLog } = input;
  const destinationUrl = targetUrl && targetUrl.trim().length > 0
    ? targetUrl
    : "https://www.facebook.com/";

  onLog?.(`[${targetType}] Navigating to ${destinationUrl}`);
  await page.goto(destinationUrl, { waitUntil: "domcontentloaded" });

  const currentUrl = typeof page.url === "function" ? page.url() : String(page.url || "");
  const initialHealth = evaluateFacebookAccountHealth(currentUrl);

  if (initialHealth === "CHECKPOINT_2FA") {
    return {
      success: false,
      healthStatus: "CHECKPOINT_2FA",
      error: "CHECKPOINT_DETECTED: Account checkpoint or suspension detected on Facebook",
    };
  }

  if (initialHealth === "SESSION_EXPIRED") {
    return {
      success: false,
      healthStatus: "SESSION_EXPIRED",
      error: "SESSION_EXPIRED: Cookie expired, user needs to login again",
    };
  }

  // Open composer
  const openComposerCandidates = [
    "[role='button'][aria-label*='Bạn đang nghĩ gì']",
    "[role='button'][aria-label*='What']",
    "div[role='button']:has-text('Bạn đang nghĩ gì?')",
    "div[role='button']:has-text('Tạo bài viết')",
    "div[role='button']:has-text('Create post')",
  ];

  for (const sel of openComposerCandidates) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) {
        await loc.first().click();
        break;
      }
    } catch {
      // ignore
    }
  }

  // Type content
  const editorCandidates = [
    "div[role='dialog'] div[role='textbox'][contenteditable='true']",
    "div[role='textbox'][contenteditable='true']",
  ];
  let editorFound = false;
  for (const sel of editorCandidates) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) {
        await loc.first().pressSequentially(content, { delay: 25 });
        editorFound = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!editorFound) {
    return {
      success: false,
      healthStatus: initialHealth,
      error: "PAGE_COMPOSER_EDITOR_NOT_FOUND",
    };
  }

  // Attach media if provided
  if (mediaPaths && mediaPaths.length > 0) {
    const validPaths = mediaPaths.filter((p) => fs.existsSync(p));
    if (validPaths.length > 0) {
      try {
        const fileInput = page.locator("input[type='file']");
        if ((await fileInput.count()) > 0) {
          await fileInput.first().setInputFiles(validPaths);
        }
      } catch (err) {
        onLog?.(`Failed to attach media: ${err}`);
      }
    }
  }

  // Click Submit
  if (submit) {
    const submitCandidates = [
      "div[role='dialog'] div[aria-label='Đăng']",
      "div[role='dialog'] div[aria-label='Post']",
      "div[aria-label='Đăng']",
      "div[aria-label='Post']",
    ];
    for (const sel of submitCandidates) {
      try {
        const loc = page.locator(sel);
        if ((await loc.count()) > 0) {
          await loc.first().click();
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  // Final health & URL evaluation
  const finalUrl = typeof page.url === "function" ? page.url() : String(page.url || "");
  const finalHealth = evaluateFacebookAccountHealth(finalUrl);

  return {
    success: true,
    postUrl: destinationUrl,
    healthStatus: finalHealth,
  };
}

