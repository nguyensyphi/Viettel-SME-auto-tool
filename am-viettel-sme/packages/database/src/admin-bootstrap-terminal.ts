import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import type { ReadStream, WriteStream } from "node:tty";

function requireTty(input: ReadStream, output: WriteStream): void {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("SAFE_TERMINAL_REQUIRED");
  }
}

async function promptEmailFromTty(
  label: string,
  input: ReadStream,
  output: WriteStream,
): Promise<string> {
  requireTty(input, output);
  const prompt = createInterface({ input, output, terminal: true });
  try {
    return await prompt.question(label);
  } finally {
    prompt.close();
  }
}

export async function promptAdminEmailFromTty(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  return promptEmailFromTty("Initial Admin email: ", input, output);
}

export async function promptRecoveryAdminEmailFromTty(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  return promptEmailFromTty("Admin email to recover: ", input, output);
}

async function promptPasswordMaskedFromTty(
  label: string,
  input: ReadStream,
  output: WriteStream,
): Promise<string> {
  requireTty(input, output);
  output.write(label);
  input.setRawMode(true);
  input.resume();
  const decoder = new StringDecoder("utf8");
  let password = "";
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(password);
    };
    const onEnd = (): void => finish(new Error("SAFE_TERMINAL_INPUT_ENDED"));
    const onData = (chunk: Buffer | string): void => {
      const characters =
        typeof chunk === "string" ? chunk : decoder.write(chunk);
      for (const character of characters) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          finish(new Error("SAFE_TERMINAL_INPUT_INTERRUPTED"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
          continue;
        }
        if (character.codePointAt(0)! < 32 || password.length >= 1024) {
          finish(new Error("SAFE_TERMINAL_INPUT_INVALID"));
          return;
        }
        password += character;
      }
    };

    input.on("data", onData);
    input.once("end", onEnd);
  });
}

export async function promptAdminPasswordMaskedFromTty(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  return promptPasswordMaskedFromTty(
    "Initial Admin password (input hidden): ",
    input,
    output,
  );
}

export async function promptRecoveryAdminPasswordMaskedFromTty(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  return promptPasswordMaskedFromTty(
    "New Admin password (input hidden): ",
    input,
    output,
  );
}
