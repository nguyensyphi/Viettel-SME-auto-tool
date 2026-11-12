import { describe, it, expect, vi } from "vitest";
import {
  publishToFacebookPageOrWall,
  evaluateFacebookAccountHealth,
  type PagePublishInput,
  type FacebookAccountHealth,
} from "../src/publishers/facebook-page-publisher.js";

describe("Facebook Page & Personal Wall Publisher", () => {
  it("should evaluate account health as CHECKPOINT_2FA when URL contains checkpoint", () => {
    const health = evaluateFacebookAccountHealth("https://www.facebook.com/checkpoint/1501092823525282");
    expect(health).toBe("CHECKPOINT_2FA");
  });

  it("should evaluate account health as SESSION_EXPIRED when URL contains login", () => {
    const health = evaluateFacebookAccountHealth("https://www.facebook.com/login/?next=...");
    expect(health).toBe("SESSION_EXPIRED");
  });

  it("should evaluate account health as ACTIVE_OK when on feed or page normally", () => {
    const health = evaluateFacebookAccountHealth("https://www.facebook.com/");
    expect(health).toBe("ACTIVE_OK");
  });

  it("should publish content to personal wall or page successfully with mocked page", async () => {
    const mockLocator = {
      count: vi.fn().mockResolvedValue(1),
      first: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        pressSequentially: vi.fn().mockResolvedValue(undefined),
        setInputFiles: vi.fn().mockResolvedValue(undefined),
        isVisible: vi.fn().mockResolvedValue(true),
      }),
    };

    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://www.facebook.com/"),
      locator: vi.fn().mockReturnValue(mockLocator),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("mock")),
    };

    const input: PagePublishInput = {
      accountId: "fb-viettel-sme",
      targetType: "PERSONAL_WALL",
      content: "Giải pháp chuyển đổi số cho doanh nghiệp SME Viettel",
      submit: true,
    };

    const result = await publishToFacebookPageOrWall(mockPage as any, input);

    expect(result.success).toBe(true);
    expect(result.healthStatus).toBe("ACTIVE_OK");
    expect(mockPage.goto).toHaveBeenCalledWith("https://www.facebook.com/", expect.any(Object));
  });
});

