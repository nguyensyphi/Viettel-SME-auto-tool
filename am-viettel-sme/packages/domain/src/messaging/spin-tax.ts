/**
 * Spin-tax Parser and Variable Substitution Engine
 * Formats:
 *  - Simple: {Variant A|Variant B|Variant C}
 *  - Nested: {A|{B1|B2}|C}
 *  - Dynamic variables: [TÊN_NHÓM], [NGÀY_THÁNG], [MST]
 */

export function resolveSpinTax(
  template: string,
  variables: Record<string, string> = {},
  randomFn: () => number = Math.random,
): string {
  let result = template;

  // Substitute variables first e.g. [TÊN_NHÓM] -> Hội Doanh Nhân
  for (const [key, val] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\[${key}\\]`, "g");
    result = result.replace(placeholder, val);
  }

  // Iteratively resolve innermost spin-tax groups: {[^{}]+}
  const spinRegex = /\{([^{}]+)\}/;
  let match = spinRegex.exec(result);
  let maxIterations = 50;

  while (match && maxIterations > 0) {
    const fullMatch = match[0];
    const choices = match[1]!.split("|");
    const chosenIndex = Math.min(
      Math.floor(randomFn() * choices.length),
      choices.length - 1,
    );
    const chosen = choices[chosenIndex] ?? "";
    result = result.replace(fullMatch, chosen);
    match = spinRegex.exec(result);
    maxIterations--;
  }

  return result;
}

export function extractSpinTaxVariationsCount(template: string): number {
  const spinRegex = /\{([^{}]+)\}/g;
  let total = 1;
  let match;
  let hasMatches = false;

  while ((match = spinRegex.exec(template)) !== null) {
    hasMatches = true;
    const choices = match[1]!.split("|");
    total *= choices.length;
  }

  return hasMatches ? total : 1;
}

