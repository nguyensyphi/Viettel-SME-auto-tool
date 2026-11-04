import { PassThrough } from "node:stream";
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { promptRecoveryAdminPasswordMaskedFromTty } from "../src/admin-bootstrap-terminal.js";
function syntheticTty(isTTY = true) {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
  };
  input.isTTY = isTTY;
  input.setRawMode = vi.fn();
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  output.isTTY = isTTY;
  output.setEncoding("utf8");
  let rendered = "";
  output.on("data", (chunk: string) => {
    rendered += chunk;
  });
  return { input, output, rendered: () => rendered };
}
describe("secure recovery terminal input", () => {
  it("asks for a new password in raw mode without echoing its characters", async () => {
    const { input, output, rendered } = syntheticTty();
    const secret = `Synthetic-${randomBytes(24).toString("base64url")}!`;
    const pending = promptRecoveryAdminPasswordMaskedFromTty(
      input as never,
      output as never,
    );
    input.write(secret);
    input.write("\r");
    await expect(pending).resolves.toBe(secret);
    expect(rendered()).toContain("New Admin password (input hidden)");
    expect(rendered()).not.toContain(secret);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
  });
  it("fails closed if either stream is not a TTY", async () => {
    const { input, output } = syntheticTty(false);
    await expect(
      promptRecoveryAdminPasswordMaskedFromTty(input as never, output as never),
    ).rejects.toThrow("SAFE_TERMINAL_REQUIRED");
  });
});
