const rules: [RegExp, string][] = [
  [
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
    "private-key",
  ],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "aws-key"],
  [
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    "github-token",
  ],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "api-key"],
  [
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
    "stripe-key",
  ],
  [/\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, "google-api-key"],
  [/\bnpm_[A-Za-z0-9]{36,}(?![A-Za-z0-9])/g, "npm-token"],
  [/\bglpat-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, "gitlab-token"],
  [
    /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
    "sendgrid-key",
  ],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "slack-token"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "jwt"],
  [/\bAuthorization\s*:\s*Bearer\s+[^\s"'<>]+/gi, "bearer"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi, "url-credentials"],
  [
    /["']?\b[A-Za-z_][A-Za-z0-9_]{0,63}(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]{0,63}["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
    "assignment",
  ],
  [
    /\b(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
    "assignment",
  ],
  [
    /\b(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\b[ \t]+[A-Za-z0-9_+/=-]{24,}(?=\s|["',;)}\]]|$)/gi,
    "adjacent-secret",
  ],
];

// Includes every ordered pattern, flags and replacement label.
export const REDACTION_RULE_VERSION = JSON.stringify(
  rules.map(([pattern, label]) => [pattern.source, pattern.flags, label]),
);

export function redact(text: string): string {
  let result = text;
  for (const [pattern, kind] of rules) {
    result = result.replace(pattern, `[REDACTED:${kind}]`);
  }
  return result;
}

export function redactTree<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactTree) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redact(key),
        redactTree(entry),
      ]),
    ) as T;
  }
  return value;
}

export function countRedactionMarkers(text: string) {
  return (text.match(/\[REDACTED:[\w-]+\]/g) ?? []).length;
}
