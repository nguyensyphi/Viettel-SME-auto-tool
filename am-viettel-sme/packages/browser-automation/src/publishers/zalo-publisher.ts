import type { BrowserPageHandle } from "../types.js";

export interface PlatformPublishInput {
  page: BrowserPageHandle;
  content: string;
  mediaPaths?: readonly string[] | undefined;
  submit: boolean;
  typingDelayMs?: number | undefined;
}

function computeNaturalTypingDelayMs(overrideDelayMs?: number | undefined): number {
  if (overrideDelayMs !== undefined && overrideDelayMs >= 20) {
    return overrideDelayMs;
  }
  return 25 + Math.floor(Math.random() * 41);
}

export async function publishToZalo(input: PlatformPublishInput): Promise<void> {
  const { page, content, mediaPaths, submit } = input;
  const openComposerSelector = "[data-testid='compose-post']";
  if ((await page.locator(openComposerSelector).count()) > 0) {
    await page.locator(openComposerSelector).first().click();
  }

  const editorCandidates = ["[contenteditable='true']", "#richInput"];
  let editorFound = false;
  for (const selector of editorCandidates) {
    if ((await page.locator(selector).count()) > 0) {
      const delay = computeNaturalTypingDelayMs(input.typingDelayMs);
      await page.locator(selector).first().pressSequentially(content, { delay });
      editorFound = true;
      break;
    }
  }

  if (!editorFound) {
    throw new Error("ZALO_COMPOSER_EDITOR_NOT_FOUND");
  }

  if (mediaPaths && mediaPaths.length > 0) {
    const fileInputSelector = "input[type='file']";
    if ((await page.locator(fileInputSelector).count()) > 0) {
      await page.locator(fileInputSelector).first().setInputFiles(mediaPaths);
    }
  }

  if (submit) {
    const submitSelector = "[data-testid='submit-post']";
    if ((await page.locator(submitSelector).count()) === 0) {
      throw new Error("ZALO_SUBMIT_BUTTON_NOT_FOUND");
    }
    await page.locator(submitSelector).first().click();
  }
}

