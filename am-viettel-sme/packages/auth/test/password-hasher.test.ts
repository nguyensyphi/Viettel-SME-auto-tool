import { describe, expect, it } from "vitest";
import { Argon2idPasswordHasher } from "../src/index.js";

describe("Argon2idPasswordHasher", () => {
  it("hashes with a salted Argon2id PHC string and verifies only the correct password", async () => {
    const hasher = new Argon2idPasswordHasher({
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
    });
    const encoded = await hasher.hash("synthetic local password phrase");

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(
      await hasher.verify(encoded, "synthetic local password phrase"),
    ).toBe(true);
    expect(await hasher.verify(encoded, "incorrect password phrase")).toBe(
      false,
    );
  });

  it("rejects malformed hashes and does not accept weaker parameter profiles", async () => {
    const hasher = new Argon2idPasswordHasher({
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
    });
    expect(await hasher.verify("not-a-phc-hash", "some password here")).toBe(
      false,
    );
    expect(
      () =>
        new Argon2idPasswordHasher({
          memoryKiB: 1_024,
          iterations: 1,
          parallelism: 1,
        }),
    ).toThrow("UNSAFE_ARGON2ID_PARAMETERS");
  });
});
