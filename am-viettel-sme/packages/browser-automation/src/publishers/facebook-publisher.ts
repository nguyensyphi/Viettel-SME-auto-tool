import type { BrowserPageHandle } from "../types.js";
import type { PlatformPublishInput } from "./zalo-publisher.js";

function computeNaturalTypingDelayMs(overrideDelayMs?: number | undefined): number {
  if (overrideDelayMs !== undefined && overrideDelayMs >= 20) {
    return overrideDelayMs;
  }
  return 25 + Math.floor(Math.random() * 41);
}

export async function publishToFacebook(input: PlatformPublishInput): Promise<void> {
  const { page, content, mediaPaths, submit } = input;
  const openComposerSelector = "[role='button'][aria-label*='What']";
  if ((await page.locator(openComposerSelector).count()) > 0) {
    await page.locator(openComposerSelector).first().click();
  }

  const editorCandidates = ["[role='textbox']", "[contenteditable='true']"];
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
    throw new Error("FACEBOOK_COMPOSER_EDITOR_NOT_FOUND");
  }

  if (mediaPaths && mediaPaths.length > 0) {
    const fileInputSelector = "input[type='file']";
    if ((await page.locator(fileInputSelector).count()) > 0) {
      await page.locator(fileInputSelector).first().setInputFiles(mediaPaths);
    }
  }

  if (submit) {
    const submitSelector = "[aria-label='Post']";
    if ((await page.locator(submitSelector).count()) === 0) {
      throw new Error("FACEBOOK_SUBMIT_BUTTON_NOT_FOUND");
    }
    await page.locator(submitSelector).first().click();
  }
}
