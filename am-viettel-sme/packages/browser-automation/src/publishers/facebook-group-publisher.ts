import fs from "node:fs";
import path from "node:path";

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

const LOGIN_PROMPT_SELECTORS = [
  "input[name='email']",
  "input[name='pass']",
  "div[role='button']:has-text('Đăng nhập')",
  "div[role='button']:has-text('Log In')",
  "a:has-text('Đăng nhập')",
  "a:has-text('Log In')",
  "form[action*='login']",
];

const JOIN_GROUP_SELECTORS = [
  "div[role='button']:has-text('Tham gia nhóm')",
  "div[role='button']:has-text('Join group')",
  "div[aria-label='Tham gia nhóm']",
  "div[aria-label='Join group']",
  "button:has-text('Tham gia nhóm')",
  "button:has-text('Join group')",
];

const ADMIN_ONLY_SELECTORS = [
  "text='Chỉ quản trị viên mới có thể đăng'",
  "text='Only admins can post'",
  "text='Tính năng đăng bài bị tắt'",
  "text='Posting is turned off'",
];

const FB_ERROR_DIALOG_SELECTORS = [
  "div[role='dialog']:has-text('Bạn đang thực hiện thao tác này quá nhanh')",
  "div[role='dialog']:has-text('You’re going too fast')",
  "div[role='dialog']:has-text('Hành động này bị chặn')",
  "div[role='dialog']:has-text('This action was blocked')",
  "div[role='dialog']:has-text('tiêu chuẩn cộng đồng')",
  "div[role='dialog']:has-text('Community Standards')",
  "div[role='dialog']:has-text('Có lỗi xảy ra')",
  "div[role='dialog']:has-text('Something went wrong')",
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
      "[XÁC_MINH_DANH_TÍNH_2FA] CHECKPOINT_DETECTED: Account checkpoint or suspension detected on Facebook",
    );
  }

  if (
    currentUrl.toLowerCase().includes("login") ||
    currentUrl.toLowerCase().includes("/login/")
  ) {
    throw new Error(
      "[CHƯA_ĐĂNG_NHẬP] NEEDS_LOGIN: Tài khoản Facebook chưa đăng nhập. Vui lòng bấm 'Mở Chrome đăng nhập' trên bảng Tài khoản để đăng nhập trước khi chạy đăng bài!",
    );
  }

  // Pre-flight check: Login forms / buttons on page
  for (const loginSel of LOGIN_PROMPT_SELECTORS) {
    try {
      const loc = page.locator(loginSel);
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
        throw new Error(
          "[CHƯA_ĐĂNG_NHẬP] NEEDS_LOGIN: Tài khoản chưa đăng nhập Facebook (phát hiện form đăng nhập trên trang). Vui lòng bấm 'Mở Chrome đăng nhập'!",
        );
      }
    } catch (err: any) {
      if (err.message?.includes("[CHƯA_ĐĂNG_NHẬP]")) throw err;
    }
  }

  const pageContent = typeof page.content === "function" ? await page.content().catch(() => "") : "";
  if (
    pageContent.includes("Bạn hiện không xem được nội dung này") ||
    pageContent.includes("This content isn't available right now") ||
    pageContent.includes("Trang này không hiển thị")
  ) {
    throw new Error(
      "[NHÓM_KHÔNG_TỒN_TẠI] GROUP_NOT_ACCESSIBLE: Không thể truy cập nhóm này. Nhóm có thể là nhóm kín mà tài khoản chưa tham gia, hoặc URL nhóm không chính xác.",
    );
  }

  // Check if account has NOT joined group
  for (const joinSel of JOIN_GROUP_SELECTORS) {
    try {
      const loc = page.locator(joinSel);
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
        throw new Error(
          `[CHƯA_THAM_GIA_NHÓM] Tài khoản chưa là thành viên của nhóm (${groupUrl}). Vui lòng bấm tham gia nhóm trước khi chạy đăng bài tự động!`,
        );
      }
    } catch (err: any) {
      if (err.message?.includes("[CHƯA_THAM_GIA_NHÓM]")) throw err;
    }
  }

  // Check if admin only
  for (const adminSel of ADMIN_ONLY_SELECTORS) {
    try {
      const loc = page.locator(adminSel);
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
        throw new Error(
          `[NHÓM_KHÓA_ĐĂNG_BÀI] Nhóm này chỉ cho phép Quản trị viên đăng bài hoặc tài khoản của bạn bị hạn chế quyền đăng.`,
        );
      }
    } catch (err: any) {
      if (err.message?.includes("[NHÓM_KHÓA_ĐĂNG_BÀI]")) throw err;
    }
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

    // 8. Error Interception & Verify Outcome
    // Check Facebook error dialogs / alerts
    for (const errSel of FB_ERROR_DIALOG_SELECTORS) {
      try {
        const errLoc = page.locator(errSel);
        if ((await errLoc.count()) > 0 && (await errLoc.first().isVisible())) {
          let errText = "Facebook từ chối đăng bài do vi phạm chính sách hoặc tần suất.";
          try {
            if (typeof errLoc.first().innerText === "function") {
              errText = (await errLoc.first().innerText()).trim().replace(/\n+/g, " ");
            }
          } catch {}
          throw new Error(
            `[FACEBOOK_TỪ_CHỐI_ĐĂNG] Facebook trả về lỗi: "${errText}". Khuyến nghị kiểm tra nội dung bài viết hoặc tạm dừng đăng bài bằng nick này.`,
          );
        }
      } catch (err: any) {
        if (err.message?.includes("[FACEBOOK_TỪ_CHỐI_ĐĂNG]")) throw err;
      }
    }

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

    // Check if composer dialog remained open (Fail-closed)
    for (const tbSel of TEXTBOX_SELECTORS) {
      try {
        const tbLoc = page.locator(tbSel);
        if ((await tbLoc.count()) > 0 && (await tbLoc.first().isVisible())) {
          throw new Error(
            `[ĐĂNG_BÀI_CHƯA_HOÀN_TẤT] Khung soạn bài vẫn chưa đóng sau khi bấm gửi. Facebook có thể đang xử lý chậm hoặc yêu cầu thao tác bổ sung.`,
          );
        }
      } catch (err: any) {
        if (err.message?.includes("[ĐĂNG_BÀI_CHƯA_HOÀN_TẤT]")) throw err;
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

export interface RunFacebookGroupPublishSessionOptions {
  readonly accountId: string;
  readonly groupUrl: string;
  readonly content: string;
  readonly mediaPaths?: readonly string[] | undefined;
  readonly submit?: boolean | undefined;
  readonly storageRootDir?: string | undefined;
  readonly jobId?: string | undefined;
}

export interface RunFacebookGroupPublishSessionResult {
  readonly status: "PUBLISHED" | "PENDING_APPROVAL";
  readonly postUrl?: string | undefined;
  readonly details?: string | undefined;
  readonly proofPath?: string | undefined;
}

export async function runFacebookGroupPublishSession(
  options: RunFacebookGroupPublishSessionOptions,
): Promise<RunFacebookGroupPublishSessionResult> {
  const pw = await import("playwright-core");
  let browserOrContext: any = null;
  let page: any = null;
  let isCdp = false;

  try {
    // 1. Try connecting to already open Chrome with remote debugging port 9222
    try {
      const cdpBrowser = await pw.chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2500 });
      browserOrContext = cdpBrowser;
      const contexts = cdpBrowser.contexts();
      const defaultCtx = contexts[0] || (await cdpBrowser.newContext());
      page = await defaultCtx.newPage();
      isCdp = true;
    } catch {
      // 2. If Chrome not open with CDP, launch isolated persistent context
      const profileDir = path.resolve(options.storageRootDir ?? "storage", "browser_profiles", options.accountId);
      const context = await pw.chromium.launchPersistentContext(profileDir, {
        headless: false,
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
      });
      browserOrContext = context;
      page = context.pages()[0] || (await context.newPage());
    }

    // 3. Execute real group post via Playwright
    const publishResult = await publishToFacebookGroup({
      page,
      groupUrl: options.groupUrl,
      content: options.content,
      mediaPaths: options.mediaPaths,
      submit: options.submit ?? true,
    });

    // Capture screenshot proof
    let proofPath: string | undefined;
    try {
      const reportsDir = path.resolve(options.storageRootDir ?? "storage", "reports/ui-audit");
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      proofPath = path.join(reportsDir, `proof-${options.jobId ?? Date.now()}.png`);
      await page.screenshot({ path: proofPath, fullPage: false });
    } catch {
      // screenshot optional
    }

    return {
      status: publishResult.status,
      postUrl: publishResult.postUrl,
      details: publishResult.details,
      proofPath,
    };
  } catch (err: any) {
    let errorProofPath: string | undefined;
    if (page) {
      try {
        const reportsDir = path.resolve(options.storageRootDir ?? "storage", "reports/ui-audit");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        errorProofPath = path.join(reportsDir, `proof-error-${options.jobId ?? Date.now()}.png`);
        await page.screenshot({ path: errorProofPath, fullPage: false });
      } catch {
        // optional screenshot
      }
    }
    const enhancedError = new Error(err?.message || String(err));
    (enhancedError as any).errorProofPath = errorProofPath;
    throw enhancedError;
  } finally {
    if (page && isCdp) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    } else if (browserOrContext && !isCdp) {
      try {
        await browserOrContext.close();
      } catch {
        // ignore
      }
    }
  }
}

export interface VerifyFacebookSessionOptions {
  readonly accountId: string;
  readonly storageRootDir?: string | undefined;
}

export interface VerifyFacebookSessionResult {
  readonly status: "CONNECTED" | "NEEDS_LOGIN" | "CHECKPOINT_2FA";
  readonly reason: string;
  readonly checkedAt: string;
}

export async function verifyFacebookSession(
  options: VerifyFacebookSessionOptions,
): Promise<VerifyFacebookSessionResult> {
  const pw = await import("playwright-core");
  let browserOrContext: any = null;
  let page: any = null;
  let isCdp = false;

  try {
    try {
      const cdpBrowser = await pw.chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2500 });
      browserOrContext = cdpBrowser;
      const contexts = cdpBrowser.contexts();
      const defaultCtx = contexts[0] || (await cdpBrowser.newContext());
      page = await defaultCtx.newPage();
      isCdp = true;
    } catch {
      const profileDir = path.resolve(options.storageRootDir ?? "storage", "browser_profiles", options.accountId);
      const context = await pw.chromium.launchPersistentContext(profileDir, {
        headless: true,
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
      });
      browserOrContext = context;
      page = context.pages()[0] || (await context.newPage());
    }

    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    const currentUrl = (typeof page.url === "function" ? page.url() : String(page.url || "")).toLowerCase();

    if (currentUrl.includes("/checkpoint") || currentUrl.includes("/recover") || currentUrl.includes("/suspended")) {
      return {
        status: "CHECKPOINT_2FA",
        reason: "Tài khoản đang yêu cầu xác minh bảo mật (2FA / Checkpoint)",
        checkedAt: new Date().toISOString(),
      };
    }

    if (currentUrl.includes("/login") || currentUrl.includes("login.php")) {
      return {
        status: "NEEDS_LOGIN",
        reason: "Chưa đăng nhập Facebook (Bị chuyển hướng về trang đăng nhập)",
        checkedAt: new Date().toISOString(),
      };
    }

    for (const loginSel of LOGIN_PROMPT_SELECTORS) {
      const cnt = await page.locator(loginSel).count().catch(() => 0);
      if (cnt > 0) {
        return {
          status: "NEEDS_LOGIN",
          reason: "Chưa đăng nhập Facebook (Phát hiện form đăng nhập trên trang)",
          checkedAt: new Date().toISOString(),
        };
      }
    }

    const authIndicators = [
      "[aria-label='Tài khoản của bạn']",
      "[aria-label='Your profile']",
      "[aria-label='Facebook']",
      "[role='navigation']",
      "[data-pagelet='LeftRail']",
    ];
    for (const ind of authIndicators) {
      const cnt = await page.locator(ind).count().catch(() => 0);
      if (cnt > 0) {
        return {
          status: "CONNECTED",
          reason: "Tài khoản đã đăng nhập và sẵn sàng tác nghiệp",
          checkedAt: new Date().toISOString(),
        };
      }
    }

    return {
      status: "NEEDS_LOGIN",
      reason: "Không tìm thấy phiên đăng nhập Facebook hợp lệ",
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (page && isCdp) {
      try {
        await page.close();
      } catch {}
    } else if (browserOrContext && !isCdp) {
      try {
        await browserOrContext.close();
      } catch {}
    }
  }
}
