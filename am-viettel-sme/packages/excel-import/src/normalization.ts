export type PhoneNormalizationResult =
  | {
      readonly status: "EMPTY";
      readonly value: null;
      readonly normalizedKey: null;
    }
  | {
      readonly status: "VALID";
      readonly value: string;
      readonly normalizedKey: string;
    }
  | {
      readonly status: "NEEDS_REVIEW";
      readonly value: string;
      readonly normalizedKey: null;
    }
  | {
      readonly status: "INVALID";
      readonly value: null;
      readonly normalizedKey: null;
      readonly errorCode: "PHONE_INVALID";
    };

export type EmailNormalizationResult =
  | {
      readonly status: "EMPTY";
      readonly value: null;
      readonly normalizedKey: null;
    }
  | {
      readonly status: "VALID";
      /** Trimmed input, retained for display; do not use as a match key. */
      readonly value: string;
      /** Lowercase key for exact matching in a later approved package. */
      readonly normalizedKey: string;
    }
  | {
      readonly status: "INVALID";
      readonly value: null;
      readonly normalizedKey: null;
      readonly errorCode: "EMAIL_INVALID";
    };

export interface NormalizedCompanyName {
  /** Readable, trimmed, whitespace-collapsed NFC display value. */
  readonly display: string;
  /** Case/punctuation-insensitive suggestion key; never an auto-merge decision. */
  readonly matchKey: string;
}

const EMPTY_PHONE: PhoneNormalizationResult = {
  status: "EMPTY",
  value: null,
  normalizedKey: null,
};

const INVALID_PHONE: PhoneNormalizationResult = {
  status: "INVALID",
  value: null,
  normalizedKey: null,
  errorCode: "PHONE_INVALID",
};

const EMPTY_EMAIL: EmailNormalizationResult = {
  status: "EMPTY",
  value: null,
  normalizedKey: null,
};

const INVALID_EMAIL: EmailNormalizationResult = {
  status: "INVALID",
  value: null,
  normalizedKey: null,
  errorCode: "EMAIL_INVALID",
};

/**
 * Normalize only explicitly recognized Vietnamese phone forms. Other
 * international E.164-like numbers are retained for review and get no key, so
 * callers cannot accidentally use them for automatic dedupe.
 */
export function normalizePhone(
  input: string | null | undefined,
): PhoneNormalizationResult {
  if (input === null || input === undefined) return EMPTY_PHONE;

  const compact = input.trim().replace(/[\s().-]/gu, "");
  if (compact === "") return EMPTY_PHONE;
  if (!/^\+?\d+$/u.test(compact)) return INVALID_PHONE;

  if (compact.startsWith("+84")) {
    const nationalNumber = compact.slice(3);
    if (!/^\d{9}$/u.test(nationalNumber)) return INVALID_PHONE;
    const localNumber = `0${nationalNumber}`;
    return {
      status: "VALID",
      value: localNumber,
      normalizedKey: localNumber,
    };
  }

  if (compact.startsWith("+")) {
    const internationalDigits = compact.slice(1);
    if (!/^\d{7,15}$/u.test(internationalDigits)) return INVALID_PHONE;
    return {
      status: "NEEDS_REVIEW",
      value: compact,
      normalizedKey: null,
    };
  }

  if (/^0\d{9}$/u.test(compact)) {
    return { status: "VALID", value: compact, normalizedKey: compact };
  }

  // The prefix 84 is treated as a country code only for the exact 11-digit
  // country-code form; other digit strings are not guessed or rewritten.
  if (/^84\d{9}$/u.test(compact)) {
    const localNumber = `0${compact.slice(2)}`;
    return {
      status: "VALID",
      value: localNumber,
      normalizedKey: localNumber,
    };
  }

  return INVALID_PHONE;
}

function isValidEmailAddress(value: string): boolean {
  if (value.length > 254) return false;
  const separator = value.indexOf("@");
  if (separator <= 0 || separator !== value.lastIndexOf("@")) return false;

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".")) {
    return false;
  }
  if (
    local.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
  ) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
  );
}

/** Trim and validate an email; retain the trimmed display value separately from its lowercase key. */
export function normalizeEmail(
  input: string | null | undefined,
): EmailNormalizationResult {
  if (input === null || input === undefined) return EMPTY_EMAIL;
  const value = input.trim();
  if (value === "") return EMPTY_EMAIL;
  if (!isValidEmailAddress(value)) return INVALID_EMAIL;
  return { status: "VALID", value, normalizedKey: value.toLowerCase() };
}

/** NFC display normalization plus a comparison key for later human-reviewed suggestions. */
export function normalizeCompanyName(input: string): NormalizedCompanyName {
  const display = input.normalize("NFC").replace(/\s+/gu, " ").trim();
  const matchKey = display
    .toLowerCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return { display, matchKey };
}

/** Mask all but the last two digits; null/blank values stay absent. */
export function maskPhoneForDisplay(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined || input.trim() === "") return null;
  const trimmed = input.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length <= 4)
    return `${prefix}${"*".repeat(Math.max(digits.length, 4))}`;
  return `${prefix}${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
}

/** Mask the mailbox and domain labels, retaining only initials and the final TLD. */
export function maskEmailForDisplay(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined || input.trim() === "") return null;
  const value = input.trim();
  const separator = value.lastIndexOf("@");
  if (separator <= 0)
    return "*".repeat(Math.min(Math.max(value.length, 4), 12));

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const maskedLocal = `${local.slice(0, 1)}${"*".repeat(Math.min(Math.max(local.length - 1, 3), 8))}`;
  const labels = domain.split(".");
  const topLevel = labels.length > 1 ? (labels.pop() ?? "") : "";
  const maskedDomain = labels
    .map((label) =>
      label === ""
        ? ""
        : `${label.slice(0, 1)}${"*".repeat(Math.min(Math.max(label.length - 1, 3), 8))}`,
    )
    .join(".");
  const suffix = topLevel === "" ? "" : `.${topLevel.toLowerCase()}`;
  return `${maskedLocal}@${maskedDomain}${suffix}`;
}
