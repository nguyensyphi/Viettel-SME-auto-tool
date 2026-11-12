import fs from "node:fs";
import type { BrowserPageHandle } from "../types.js";

export type ZaloOutreachAction =
  | "SEARCH_ONLY"
  | "ADD_FRIEND"
  | "SEND_MESSAGE"
  | "ADD_FRIEND_AND_SEND_MESSAGE";

export type ZaloOutreachStatus =
  | "SUCCESS"
  | "ZALO_ACCOUNT_NOT_FOUND"
  | "NEEDS_LOGIN"
  | "ALREADY_FRIENDS"
  | "FRIEND_REQUEST_SENT"
  | "MESSAGE_SENT"
  | "FAILED";

export interface ZaloOutreachInput {
  page: BrowserPageHandle;
  phone: string;
  friendGreeting?: string | undefined;
  messageContent?: string | undefined;
  mediaPaths?: readonly string[] | undefined;
  action: ZaloOutreachAction;
  typingDelayMs?: number | undefined;
}

export interface ZaloOutreachResult {
  status: ZaloOutreachStatus;
  phone: string;
  details?: string | undefined;
}

function computeNaturalTypingDelayMs(overrideDelayMs?: number | undefined): number {
  if (overrideDelayMs !== undefined && overrideDelayMs >= 20) {
    return overrideDelayMs;
  }
  return 25 + Math.floor(Math.random() * 41);
}

export async function executeZaloOutreach(
  input: ZaloOutreachInput,
): Promise<ZaloOutreachResult> {
  const { page, phone, friendGreeting, messageContent, mediaPaths, action } = input;
  const currentUrl = page.url();

  // 1. Session & Login Check
  if (
    currentUrl.includes("login") ||
    (await page.locator(".qrcode-container").count()) > 0 ||
    (await page.locator(".login-container").count()) > 0
  ) {
    return {
      status: "NEEDS_LOGIN",
      phone,
      details: "Trang Zalo đang yêu cầu đăng nhập lại (mã QR/phiên hết hạn)",
    };
  }

  // 2. Search for Phone Number
  const searchInputCandidates = [
    "[data-id='search-input']",
    "#contact-search-input",
    "input[placeholder*='Tìm kiếm']",
  ];
  let searchInputSelector = "";
  for (const sel of searchInputCandidates) {
    if ((await page.locator(sel).count()) > 0) {
      searchInputSelector = sel;
      break;
    }
  }

  if (!searchInputSelector) {
    return {
      status: "FAILED",
      phone,
      details: "Không tìm thấy ô tìm kiếm liên hệ trên giao diện Zalo",
    };
  }

  const delay = computeNaturalTypingDelayMs(input.typingDelayMs);
  await page.locator(searchInputSelector).first().click();
  await page.locator(searchInputSelector).first().pressSequentially(phone, { delay });
  await page.waitForTimeout(500);

  // 3. Verify Account Existence
  const noResultCandidates = [
    ".search-no-result",
    "[data-testid='search-empty']",
    ".empty-result",
  ];
  for (const noResSel of noResultCandidates) {
    if ((await page.locator(noResSel).count()) > 0) {
      return {
        status: "ZALO_ACCOUNT_NOT_FOUND",
        phone,
        details: `Số điện thoại ${phone} không tìm thấy tài khoản Zalo tương ứng`,
      };
    }
  }

  // Open the found user's conversation / profile
  const userItemCandidates = [
    ".search-user-item",
    ".conv-item",
    "[data-testid='search-result-item']",
  ];
  for (const userSel of userItemCandidates) {
    if ((await page.locator(userSel).count()) > 0) {
      await page.locator(userSel).first().click();
      break;
    }
  }
  await page.waitForTimeout(300);

  if (action === "SEARCH_ONLY") {
    return {
      status: "SUCCESS",
      phone,
      details: `Đã tìm thấy tài khoản Zalo cho số ${phone}`,
    };
  }

  // 4. Handle Add Friend
  if (action === "ADD_FRIEND" || action === "ADD_FRIEND_AND_SEND_MESSAGE") {
    const addFriendBtnCandidates = [
      "[data-testid='btn-add-friend']",
      "button:has-text('Kết bạn')",
      ".btn-add-friend",
    ];
    let foundAddFriend = false;
    for (const btnSel of addFriendBtnCandidates) {
      if ((await page.locator(btnSel).count()) > 0) {
        await page.locator(btnSel).first().click();
        foundAddFriend = true;
        break;
      }
    }

    if (foundAddFriend && friendGreeting) {
      const greetingInputCandidates = [
        "[contenteditable='true']",
        "textarea",
        "[data-testid='input-greeting']",
      ];
      for (const inSel of greetingInputCandidates) {
        if ((await page.locator(inSel).count()) > 0) {
          await page.locator(inSel).first().click();
          await page
            .locator(inSel)
            .first()
            .pressSequentially(friendGreeting, { delay });
          break;
        }
      }

      const confirmBtnCandidates = [
        "[data-testid='btn-confirm-add-friend']",
        "button:has-text('Xác nhận')",
        "button:has-text('Gửi yêu cầu')",
      ];
      for (const confirmSel of confirmBtnCandidates) {
        if ((await page.locator(confirmSel).count()) > 0) {
          await page.locator(confirmSel).first().click();
          break;
        }
      }

      if (action === "ADD_FRIEND") {
        return {
          status: "FRIEND_REQUEST_SENT",
          phone,
          details: `Đã gửi lời mời kết bạn kèm lời chào tới ${phone}`,
        };
      }
    }
  }

  // 5. Handle Send Direct Message
  if (action === "SEND_MESSAGE" || action === "ADD_FRIEND_AND_SEND_MESSAGE") {
    if (messageContent) {
      const editorCandidates = ["#richInput", "[contenteditable='true']", "textarea"];
      let editorFound = false;
      for (const edSel of editorCandidates) {
        if ((await page.locator(edSel).count()) > 0) {
          await page.locator(edSel).first().click();
          await page
            .locator(edSel)
            .first()
            .pressSequentially(messageContent, { delay });
          editorFound = true;
          break;
        }
      }

      if (!editorFound) {
        return {
          status: "FAILED",
          phone,
          details: "Không tìm thấy khung soạn thảo tin nhắn Zalo",
        };
      }

      if (mediaPaths && mediaPaths.length > 0) {
        for (const p of mediaPaths) {
          if (!fs.existsSync(p)) {
            throw new Error(`MEDIA_FILE_NOT_FOUND:${p}`);
          }
        }
        const fileInputSelector = "input[type='file']";
        if ((await page.locator(fileInputSelector).count()) > 0) {
          await page.locator(fileInputSelector).first().setInputFiles(mediaPaths);
        }
      }

      const sendBtnCandidates = [
        "[data-testid='btn-send-message']",
        "button:has-text('Gửi')",
        ".btn-send",
      ];
      for (const sendSel of sendBtnCandidates) {
        if ((await page.locator(sendSel).count()) > 0) {
          await page.locator(sendSel).first().click();
          break;
        }
      }

      return {
        status: "MESSAGE_SENT",
        phone,
        details: `Đã gửi tin nhắn tư vấn thành công tới số ${phone}`,
      };
    }
  }

  return {
    status: "SUCCESS",
    phone,
    details: `Hoàn tất tác vụ tiếp cận cho ${phone}`,
  };
}

