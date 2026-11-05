import type { ClassificationResult, CustomerSegment } from "../classification/customer-classifier.js";

export interface AmConfirmationInput {
  amUserId: string;
  confirmedSegment: CustomerSegment;
  confirmedServices: string[];
  confirmedAt: string;
}

export interface AmConfirmedProfile {
  source: "AM_CONFIRMED";
  segment: CustomerSegment;
  services: string[];
  confirmedBy: string;
  confirmedAt: string;
  /** true when AM chose a segment different from the engine suggestion. */
  overridden: boolean;
}

/**
 * Converts an engine suggestion into a usable profile only through an explicit
 * AM decision. The engine never assigns segments/services on its own (P0 rule).
 */
export function confirmSuggestion(
  suggestion: Pick<ClassificationResult, "segment">,
  input: AmConfirmationInput,
): AmConfirmedProfile {
  const amUserId = input.amUserId?.trim() ?? "";
  if (!amUserId) {
    throw new Error("amUserId is required to confirm a suggestion");
  }

  const services = [...new Set(input.confirmedServices.map((s) => s.trim()).filter(Boolean))];
  if (services.length === 0) {
    throw new Error("confirmedServices must contain at least one service");
  }

  if (!Number.isFinite(Date.parse(input.confirmedAt))) {
    throw new Error("confirmedAt must be a valid ISO timestamp");
  }

  return {
    source: "AM_CONFIRMED",
    segment: input.confirmedSegment,
    services,
    confirmedBy: amUserId,
    confirmedAt: new Date(input.confirmedAt).toISOString(),
    overridden: input.confirmedSegment !== suggestion.segment,
  };
}

