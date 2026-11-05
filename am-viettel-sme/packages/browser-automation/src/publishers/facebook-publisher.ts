import fs from "node:fs";
import type { PlatformPublishInput } from "./zalo-publisher.js";

function computeNaturalTypingDelayMs(overrideDelayMs?: number | undefined): number {
  if (overrideDelayMs !== undefined && overrideDelayMs >= 20) {
    return overrideDelayMs;
  }
  return 25 + Math.floor(Math.random() * 41);
}

export async function publishToFacebook(input: PlatformPublishInput): Promise<void> {
  const { page, content, mediaPaths, submit } = input;
  const openComposerCandidates = [
    "[role='button'][aria-label*='What']",
    "[role='button'][aria-label*='Bạn đang nghĩ gì']",
  ];
  for (const openSelector of openComposerCandidates) {
    if ((await page.locator(openSelector).count()) > 0) {
      await page.locator(openSelector).first().click();
      break;
    }
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
    for (const mediaPath of mediaPaths) {
      if (!fs.existsSync(mediaPath)) {
        throw new Error(`MEDIA_FILE_NOT_FOUND:${mediaPath}`);
      }
    }
    const fileInputSelector = "input[type='file']";
    if ((await page.locator(fileInputSelector).count()) === 0) {
      throw new Error("FACEBOOK_FILE_INPUT_NOT_FOUND");
    }
    await page.locator(fileInputSelector).first().setInputFiles(mediaPaths);
  }

  if (submit) {
    const submitCandidates = ["[aria-label='Post']", "[aria-label='Đăng']"];
    let clickedSubmit = false;
    for (const submitSelector of submitCandidates) {
      if ((await page.locator(submitSelector).count()) > 0) {
        await page.locator(submitSelector).first().click();
        clickedSubmit = true;
        break;
      }
    }
    if (!clickedSubmit) {
      throw new Error("FACEBOOK_SUBMIT_BUTTON_NOT_FOUND");
    }
  }
}

