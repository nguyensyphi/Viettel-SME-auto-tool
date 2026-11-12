import fs from "node:fs";

export interface FacebookGroupPublishInput {
  readonly page: any;
  readonly groupUrl: string;
  readonly content: string;
  readonly mediaPaths?: readonly string[] | undefined;
  readonly submit?: boolean | undefined;
  readonly onLog?: ((message: string) => void) | undefined;
}

export interface FacebookGroupPublishResult {
  readonly status: "PUBLISHED" | "PENDING_APPROVAL";
  readonly postUrl?: string | undefined;
  readonly details?: string | undefined;
}

const COMPOSER_SELECTORS = [
  "div[role='button']:has-text('Bạn viết gì đi...')",
  "div[role='button']:has-text('Bạn đang nghĩ gì?')",
  "div[role='button']:has-text('Tạo bài viết công khai')",
  "div[aria-label='Tạo bài viết công khai']",
  "div[role='button']:has-text('Create a public post')",
  "div[aria-label='Create a public post']",
  "div[role='button']:has-text('Write something...')",
  "div[role='button']:has-text('What\\'s on your mind')",
  "div[role='button']:has-text('Bán gì đó')",
  "div[role='button']:has-text('Sell something')",
  "div[role='button']:has-text('Thảo luận')",
  "div[role='button']:has-text('Discuss')",
];

const TEXTBOX_SELECTORS = [
  "div[role='dialog'] div[role='textbox'][contenteditable='true']",
  "div[role='textbox'][contenteditable='true'][aria-label*='gì']",
  "div[role='textbox'][contenteditable='true'][aria-label*='mind']",
  "div[role='textbox'][contenteditable='true'][aria-label*='thought']",
  "div[role='textbox'][contenteditable='true']",
];

const SUBMIT_SELECTORS = [
  "div[role='dialog'] div[aria-label='Đăng']",
  "div[role='dialog'] div[aria-label='Post']",
  "div[role='dialog'] button[aria-label='Đăng']",
  "div[role='dialog'] button[aria-label='Post']",
  "div[aria-label='Đăng']",
  "div[aria-label='Post']",
];

const PENDING_SELECTORS = [
  "text='chờ quản trị viên phê duyệt'",
  "text='chờ phê duyệt'",
  "text='pending admin approval'",
  "text='pending approval'",
];

function cleanPostUrl(raw: string): string {
  let cleaned = raw.split("?")[0] ?? raw;
  cleaned = cleaned.split("&")[0] ?? cleaned;
  if (cleaned.startsWith("/")) {
    cleaned = `https://www.facebook.com${cleaned}`;
  }
  return cleaned;
}

export async function publishToFacebookGroup(
  input: FacebookGroupPublishInput,
): Promise<FacebookGroupPublishResult> {
  const { page, groupUrl, content, mediaPaths, submit = true, onLog } = input;

  // 1. Sniff GraphQL responses to capture permalink
  let capturedUrl = "";
  if (typeof page.on === "function") {
    page.on("response", async (response: any) => {
      try {
        const respUrl =
          typeof response.url === "function" ? response.url() : String(response.url || "");
        if (respUrl.includes("/api/graphql/")) {
          const text = typeof response.text === "function" ? await response.text() : "";
          const match =
            /"url"\s*:\s*"(https:[^"]*facebook\.com[^"]*groups[^"]*(?:permalink|posts|videos)[^"]*[0-9]+[^"]*)"/u.exec(
              text,
            );
          if (match?.[1]) {
            capturedUrl = match[1].replace(/\\/g, "");
          }
        }
      } catch {
        // ignore background parsing errors
      }
    });
  }

  // 2. Navigate to group URL
  onLog?.(`Navigating to group ${groupUrl}`);
  await page.goto(groupUrl, { waitUntil: "domcontentloaded" });

  const currentUrl = typeof page.url === "function" ? page.url() : String(page.url || "");
  if (
    currentUrl.toLowerCase().includes("checkpoint") ||
    currentUrl.toLowerCase().includes("suspended")
  ) {
    throw new Error(
      "CHECKPOINT_DETECTED: Account checkpoint or suspension detected on Facebook",
    );
  }

  // 3. Confirm identity modal if present ("Tiếp tục dưới tên...")
  const continueCandidates = [
    "div[role='button']:has-text('Tiếp tục dưới tên')",
    "div[role='button']:has-text('Continue as')",
  ];
  for (const sel of continueCandidates) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
        onLog?.("Detected confirm identity modal, clicking continue...");
        await loc.first().click();
        break;
      }
    } catch {
      // ignore
    }
  }

  // 4. Open composer using multi-selector fallback
  let foundComposer = false;
  for (const sel of COMPOSER_SELECTORS) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) {
        await loc.first().click();
        foundComposer = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!foundComposer) {
    throw new Error("FACEBOOK_GROUP_COMPOSER_NOT_FOUND");
  }

  // 5. Enter content using React activation trick
  let textboxFound = false;
  for (const sel of TEXTBOX_SELECTORS) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) {
        await loc.first().click();
        if (page.keyboard?.insertText) {
          await page.keyboard.insertText(content);
          if (page.keyboard.press) {
            await page.keyboard.press("Space");
            await page.keyboard.press("Backspace");
          }
        } else if (loc.first().pressSequentially) {
          await loc.first().pressSequentially(content);
        }
        textboxFound = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!textboxFound) {
    throw new Error("FACEBOOK_GROUP_TEXTBOX_NOT_FOUND");
  }

  // 6. Attach media if provided
  if (mediaPaths && mediaPaths.length > 0) {
    for (const p of mediaPaths) {
      if (!fs.existsSync(p)) {
        throw new Error(`MEDIA_FILE_NOT_FOUND:${p}`);
      }
    }
    const fileInputSel = "div[role='dialog'] input[type='file'], input[type='file']";
    const fileLoc = page.locator(fileInputSel);
    if ((await fileLoc.count()) > 0) {
      await fileLoc.first().setInputFiles(mediaPaths);
    }
  }

  // 7. Submit post
  if (submit) {
    let clickedSubmit = false;
    for (const sel of SUBMIT_SELECTORS) {
      try {
        const loc = page.locator(sel);
        if ((await loc.count()) > 0) {
          await loc.first().click();
          clickedSubmit = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!clickedSubmit) {
      throw new Error("FACEBOOK_SUBMIT_BUTTON_NOT_FOUND");
    }

    // 8. Verify post outcome
    if (capturedUrl) {
      return {
        status: "PUBLISHED",
        postUrl: cleanPostUrl(capturedUrl),
        details: "Direct GraphQL post URL captured",
      };
    }

    // Check toast
    const toastSelectors = [
      "a:has-text('Xem bài viết')",
      "a:has-text('View Post')",
      "a[href*='/posts/']",
      "a[href*='/permalink/']",
    ];
    for (const toastSel of toastSelectors) {
      try {
        const toast = page.locator(toastSel);
        if ((await toast.count()) > 0 && (await toast.first().isVisible())) {
          const href = await toast.first().getAttribute("href");
          if (href) {
            return {
              status: "PUBLISHED",
              postUrl: cleanPostUrl(href),
              details: "Captured post URL from toast notification",
            };
          }
        }
      } catch {
        // ignore
      }
    }

    // Check pending moderation
    for (const pendingSel of PENDING_SELECTORS) {
      try {
        const pendingLoc = page.locator(pendingSel);
        if ((await pendingLoc.count()) > 0 && (await pendingLoc.first().isVisible())) {
          return {
            status: "PENDING_APPROVAL",
            postUrl: groupUrl,
            details: "Bài viết đã gửi và đang chờ quản trị viên phê duyệt",
          };
        }
      } catch {
        // ignore
      }
    }

    return {
      status: "PUBLISHED",
      postUrl: groupUrl,
      details: "Bài viết đã được gửi lên nhóm thành công",
    };
  }

  return {
    status: "PUBLISHED",
    details: "Đã chuẩn bị nội dung soạn thảo bài viết trên nhóm",
  };
}
