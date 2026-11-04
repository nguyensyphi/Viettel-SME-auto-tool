import { randomBytes, timingSafeEqual } from "node:crypto";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import type { PasswordHasher } from "./index.js";

export interface Argon2idOptions {
  memoryKiB?: number;
  iterations?: number;
  parallelism?: number;
}

const DEFAULTS = { memoryKiB: 65_536, iterations: 3, parallelism: 1 };
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MIN_MEMORY_KIB = 19_456;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly params: typeof DEFAULTS;

  constructor(options: Argon2idOptions = {}) {
    this.params = {
      memoryKiB: options.memoryKiB ?? DEFAULTS.memoryKiB,
      iterations: options.iterations ?? DEFAULTS.iterations,
      parallelism: options.parallelism ?? DEFAULTS.parallelism,
    };
    if (
      !Number.isInteger(this.params.memoryKiB) ||
      this.params.memoryKiB < MIN_MEMORY_KIB ||
      this.params.memoryKiB > 65_536 ||
      !Number.isInteger(this.params.iterations) ||
      this.params.iterations < 2 ||
      this.params.iterations > 6 ||
      this.params.parallelism !== 1
    ) {
      throw new Error("UNSAFE_ARGON2ID_PARAMETERS");
    }
  }

  async hash(password: string): Promise<string> {
    if (password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    const salt = randomBytes(SALT_BYTES);
    const derived = await argon2idAsync(password, salt, {
      m: this.params.memoryKiB,
      t: this.params.iterations,
      p: this.params.parallelism,
      dkLen: HASH_BYTES,
      maxmem: this.params.memoryKiB * 1024 + 1024 * 1024,
    });
    return `$argon2id$v=19$m=${this.params.memoryKiB},t=${this.params.iterations},p=${this.params.parallelism}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    const match = encoded.match(
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/,
    );
    if (!match) return false;
    const [, memoryValue, iterationValue, parallelValue, saltValue, hashValue] =
      match;
    if (
      !memoryValue ||
      !iterationValue ||
      !parallelValue ||
      !saltValue ||
      !hashValue
    ) {
      return false;
    }
    const memoryKiB = Number(memoryValue);
    const iterations = Number(iterationValue);
    const parallelism = Number(parallelValue);
    if (
      memoryKiB !== this.params.memoryKiB ||
      iterations !== this.params.iterations ||
      parallelism !== this.params.parallelism
    ) {
      return false;
    }
    const salt = fromBase64Url(saltValue);
    const expected = fromBase64Url(hashValue);
    if (salt.length !== SALT_BYTES || expected.length !== HASH_BYTES)
      return false;
    const actual = await argon2idAsync(password, salt, {
      m: memoryKiB,
      t: iterations,
      p: parallelism,
      dkLen: HASH_BYTES,
      maxmem: memoryKiB * 1024 + 1024 * 1024,
    });
    return timingSafeEqual(Buffer.from(actual), expected);
  }
}
