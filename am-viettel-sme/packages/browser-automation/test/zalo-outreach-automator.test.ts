import { describe, it, expect, vi } from "vitest";
import type { BrowserPageHandle } from "../src/types.js";
import {
  executeZaloOutreach,
  type ZaloOutreachInput,
} from "../src/publishers/zalo-outreach-automator.js";

function createOutreachMockPage(options: {
  visibleSelectors: string[];
  url?: string;
}) {
  const visible = new Set(options.visibleSelectors);
  const clickedSelectors: string[] = [];
  const typedEntries: Array<{ selector: string; text: string; delay?: number }> = [];

  const page: BrowserPageHandle = {
    url: () => options.url ?? "https://chat.zalo.me/",
    goto: vi.fn(async () => {}),
    locator: (selector: string) => ({
      count: async () => (visible.has(selector) ? 1 : 0),
      first: () => ({
        click: vi.fn(async () => {
          clickedSelectors.push(selector);
        }),
        fill: vi.fn(async (text: string) => {
          typedEntries.push({ selector, text });
        }),
        pressSequentially: vi.fn(async (text: string, opts?: { delay?: number }) => {
          typedEntries.push({
            selector,
            text,
            ...(opts?.delay !== undefined ? { delay: opts.delay } : {}),
          });
        }),
        setInputFiles: vi.fn(async () => {}),
        isVisible: async () => visible.has(selector),
      }),
    }),
    screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    waitForTimeout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  return { page, clickedSelectors, typedEntries };
}

describe("Task 2: Playwright Zalo Outreach Automator", () => {
  it("detects unauthenticated page and returns NEEDS_LOGIN", async () => {
    const { page } = createOutreachMockPage({
      url: "https://id.zalo.me/account/login",
      visibleSelectors: [".qrcode-container"],
    });

    const result = await executeZaloOutreach({
      page,
      phone: "0988123456",
      action: "SEARCH_ONLY",
    });

    expect(result.status).toBe("NEEDS_LOGIN");
  });

  it("returns ZALO_ACCOUNT_NOT_FOUND when phone search yields no results", async () => {
    const { page, typedEntries } = createOutreachMockPage({
      visibleSelectors: ["[data-id='search-input']", ".search-no-result"],
    });

    const result = await executeZaloOutreach({
      page,
      phone: "0911000999",
      action: "SEARCH_ONLY",
    });

    expect(result.status).toBe("ZALO_ACCOUNT_NOT_FOUND");
    expect(typedEntries.some((e) => e.text === "0911000999")).toBe(true);
  });

  it("finds contact and sends friend request with greeting message", async () => {
    const { page, clickedSelectors, typedEntries } = createOutreachMockPage({
      visibleSelectors: [
        "[data-id='search-input']",
        ".search-user-item",
        "[data-testid='btn-add-friend']",
        "[contenteditable='true']",
        "[data-testid='btn-confirm-add-friend']",
      ],
    });

    const result = await executeZaloOutreach({
      page,
      phone: "0976543210",
      friendGreeting: "Chào anh/chị, em là AM Viettel muốn kết nối tư vấn chữ ký số.",
      action: "ADD_FRIEND",
    });

    expect(result.status).toBe("FRIEND_REQUEST_SENT");
    expect(clickedSelectors).toContain("[data-testid='btn-add-friend']");
    expect(
      typedEntries.some((e) =>
        e.text.includes("Chào anh/chị, em là AM Viettel muốn kết nối"),
      ),
    ).toBe(true);
  });

  it("opens conversation and types direct outreach message into chat input", async () => {
    const { page, clickedSelectors, typedEntries } = createOutreachMockPage({
      visibleSelectors: [
        "[data-id='search-input']",
        ".search-user-item",
        "#richInput",
        "[data-testid='btn-send-message']",
      ],
    });

    const result = await executeZaloOutreach({
      page,
      phone: "0976543210",
      messageContent: "Em chào anh, em gửi bảng báo giá Chữ ký số Viettel-CA + S-Invoice.",
      action: "SEND_MESSAGE",
    });

    expect(result.status).toBe("MESSAGE_SENT");
    expect(clickedSelectors).toContain("[data-testid='btn-send-message']");
    expect(
      typedEntries.some((e) =>
        e.text.includes("Em chào anh, em gửi bảng báo giá Chữ ký số"),
      ),
    ).toBe(true);
  });
});
