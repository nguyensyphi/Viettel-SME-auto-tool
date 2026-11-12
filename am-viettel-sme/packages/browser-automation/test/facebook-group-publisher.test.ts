import { describe, expect, it, vi } from "vitest";
import { publishToFacebookGroup } from "../src/publishers/facebook-group-publisher.js";

function createMockGroupPage(options: {
  url: string;
  visibleSelectors?: string[];
  responsePayloads?: Array<{ url: string; text: string }>;
  toastVisible?: boolean;
  pendingVisible?: boolean;
}) {
  const visible = new Set(options.visibleSelectors ?? []);
  const clickedSelectors: string[] = [];
  const insertedTexts: string[] = [];
  const keypresses: string[] = [];
  const uploadedFiles: Array<string | readonly string[]> = [];
  let responseListener: ((res: any) => Promise<void> | void) | null = null;

  const page = {
    url: () => options.url,
    goto: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: any) => {
      if (event === "response") {
        responseListener = handler;
      }
    }),
    locator: (selector: string) => ({
      count: async () => (visible.has(selector) ? 1 : 0),
      first: () => ({
        click: vi.fn(async () => {
          clickedSelectors.push(selector);
          if (selector.includes("Post") || selector.includes("Đăng")) {
            await triggerResponses();
          }
        }),
        fill: vi.fn(async () => {}),
        isVisible: async () => visible.has(selector),
        setInputFiles: vi.fn(async (files: string | readonly string[]) => {
          uploadedFiles.push(files);
        }),
        getAttribute: async (attr: string) => {
          if (attr === "href" && options.toastVisible) {
            return "https://www.facebook.com/groups/dian_sme/posts/999888777/";
          }
          return null;
        },
        waitFor: vi.fn(async () => {}),
      }),
      elementHandles: vi.fn(async () => []),
    }),
    keyboard: {
      insertText: vi.fn(async (text: string) => {
        insertedTexts.push(text);
      }),
      press: vi.fn(async (key: string) => {
        keypresses.push(key);
      }),
    },
    waitForTimeout: vi.fn(async () => {}),
  };

  async function triggerResponses() {
    if (responseListener && options.responsePayloads) {
      for (const res of options.responsePayloads) {
        await responseListener({
          url: res.url,
          request: () => ({ method: () => "POST" }),
          text: async () => res.text,
        });
      }
    }
  }

  return {
    page,
    clickedSelectors,
    insertedTexts,
    keypresses,
    uploadedFiles,
    triggerResponses,
  };
}

describe("publishToFacebookGroup Engine (MOD-PC-003 & fb-auto-poster parity)", () => {
  it("detects and throws CHECKPOINT_DETECTED if Facebook navigates to checkpoint or account suspension", async () => {
    const mock = createMockGroupPage({
      url: "https://www.facebook.com/checkpoint/150870234/",
    });

    await expect(
      publishToFacebookGroup({
        page: mock.page as any,
        groupUrl: "https://www.facebook.com/groups/sme_dian",
        content: "Viettel SME Solution",
        submit: true,
      }),
    ).rejects.toThrow(/CHECKPOINT_DETECTED/i);
  });

  it("handles 'Tiếp tục dưới tên...' confirmation modal automatically if presented", async () => {
    const continueSelector = "div[role='button']:has-text('Tiếp tục dưới tên')";
    const composerSelector = "div[role='button']:has-text('Bạn viết gì đi...')";
    const textboxSelector = "div[role='dialog'] div[role='textbox'][contenteditable='true']";
    const submitSelector = "div[role='dialog'] div[aria-label='Đăng']";

    const mock = createMockGroupPage({
      url: "https://www.facebook.com/groups/sme_dian",
      visibleSelectors: [
        continueSelector,
        composerSelector,
        textboxSelector,
        submitSelector,
        "a:has-text('Xem bài viết')",
      ],
      toastVisible: true,
    });

    const result = await publishToFacebookGroup({
      page: mock.page as any,
      groupUrl: "https://www.facebook.com/groups/sme_dian",
      content: "Ưu đãi Chữ ký số Viettel-CA Cloud",
      submit: true,
    });

    expect(mock.clickedSelectors).toContain(continueSelector);
    expect(mock.clickedSelectors).toContain(composerSelector);
    expect(mock.insertedTexts).toContain("Ưu đãi Chữ ký số Viettel-CA Cloud");
    expect(mock.keypresses).toContain("Space");
    expect(mock.keypresses).toContain("Backspace");
    expect(result.status).toBe("PUBLISHED");
    expect(result.postUrl).toContain("999888777");
  });

  it("captures direct GraphQL permalink from network response stream", async () => {
    const composerSelector = "div[role='button']:has-text('Tạo bài viết công khai')";
    const textboxSelector = "div[role='textbox'][contenteditable='true'][aria-label*='gì']";
    const submitSelector = "div[role='dialog'] button[aria-label='Post']";

    const mock = createMockGroupPage({
      url: "https://www.facebook.com/groups/sme_dian",
      visibleSelectors: [composerSelector, textboxSelector, submitSelector],
      responsePayloads: [
        {
          url: "https://www.facebook.com/api/graphql/",
          text: JSON.stringify({
            data: {
              story_create: {
                story: {
                  url: "https:\\/\\/www.facebook.com\\/groups\\/sme_dian\\/posts\\/123456789\\/?substory_index=0",
                },
              },
            },
          }),
        },
      ],
    });

    const result = await publishToFacebookGroup({
      page: mock.page as any,
      groupUrl: "https://www.facebook.com/groups/sme_dian",
      content: "Hóa đơn điện tử S-Invoice",
      submit: true,
    });

    expect(result.status).toBe("PUBLISHED");
    expect(result.postUrl).toBe(
      "https://www.facebook.com/groups/sme_dian/posts/123456789/",
    );
  });

  it("identifies PENDING_APPROVAL status when post requires group admin moderation", async () => {
    const composerSelector = "div[role='button']:has-text('Thảo luận')";
    const textboxSelector = "div[role='dialog'] div[role='textbox'][contenteditable='true']";
    const submitSelector = "div[role='dialog'] div[aria-label='Đăng']";
    const pendingSelector = "text='chờ quản trị viên phê duyệt'";

    const mock = createMockGroupPage({
      url: "https://www.facebook.com/groups/sme_dian",
      visibleSelectors: [
        composerSelector,
        textboxSelector,
        submitSelector,
        pendingSelector,
      ],
      pendingVisible: true,
    });

    const result = await publishToFacebookGroup({
      page: mock.page as any,
      groupUrl: "https://www.facebook.com/groups/sme_dian",
      content: "Giải pháp vContract",
      submit: true,
    });

    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.details).toContain("chờ quản trị viên phê duyệt");
  });
});
