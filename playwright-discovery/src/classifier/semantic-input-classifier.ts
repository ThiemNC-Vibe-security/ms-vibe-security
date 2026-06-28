/**
 * Semantic Input Classifier (Phase 3)
 *
 * Rule-based classification of the security-relevant meaning of an input field.
 * No LLM, no network calls — deterministic and synchronous.
 *
 * Produces three fields per input:
 *   - semantic_type     : what the input represents (email, password, amount, …)
 *   - data_category     : what category of data it holds (credential, pii, financial, …)
 *   - security_relevance: how interesting it is for security testing (high/medium/low)
 *
 * Rules are evaluated in priority order; the first match wins.
 * The fallback is always `unknown / user_input / low`.
 *
 * This layer is intentionally separate from security-detector.ts which works at
 * the form/component level. Here we annotate every individual input field.
 */

/* ------------------------------------------------------------------ */
/*  Public types                                                        */
/* ------------------------------------------------------------------ */

export type SemanticType =
  | 'email'
  | 'password'
  | 'username'
  | 'search'
  | 'amount'
  | 'date'
  | 'file'
  | 'phone'
  | 'id'
  | 'comment'
  | 'hidden_token'
  | 'url'
  | 'otp'
  | 'unknown';

export type DataCategory =
  | 'credential'
  | 'pii'
  | 'financial'
  | 'user_input'
  | 'identifier'
  | 'security_token'
  | 'unknown';

export type SecurityRelevance = 'high' | 'medium' | 'low';

export interface SemanticClassification {
  semantic_type: SemanticType;
  data_category: DataCategory;
  security_relevance: SecurityRelevance;
}

/* ------------------------------------------------------------------ */
/*  Input signals (subset of ExtractedInput — no circular import)      */
/* ------------------------------------------------------------------ */

export interface InputSignals {
  type: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  label: string | null;
  autocomplete: string | null;
}

/* ------------------------------------------------------------------ */
/*  Rule table                                                          */
/* ------------------------------------------------------------------ */

interface ClassifyRule {
  /** Human-readable description for debugging */
  description: string;
  match: (s: InputSignals) => boolean;
  result: SemanticClassification;
}

// Helpers ─────────────────────────────────────────────────────────────

const nameIdLike = (s: InputSignals) =>
  `${s.name ?? ''} ${s.id ?? ''}`.toLowerCase().trim();

const allText = (s: InputSignals) =>
  `${s.type ?? ''} ${s.name ?? ''} ${s.id ?? ''} ${s.placeholder ?? ''} ${s.label ?? ''} ${s.autocomplete ?? ''}`
    .toLowerCase();

const has = (text: string, pattern: RegExp) => pattern.test(text);

// ─────────────────────────────────────────────────────────────────────

const RULES: ClassifyRule[] = [
  // ── Password ───────────────────────────────────────────────────────
  {
    description: 'input[type=password]',
    match: (s) => s.type === 'password',
    result: { semantic_type: 'password', data_category: 'credential', security_relevance: 'high' },
  },

  // ── OTP / verification code ────────────────────────────────────────
  {
    description: 'OTP / verification code field',
    match: (s) =>
      has(nameIdLike(s), /(otp|totp|mfa|two.?factor|verification.?code|auth.?code|\bpin\b)/i) ||
      has(s.autocomplete ?? '', /one-time-code/i),
    result: { semantic_type: 'otp', data_category: 'security_token', security_relevance: 'high' },
  },

  // ── Hidden CSRF / security tokens ─────────────────────────────────
  {
    description: 'hidden input with csrf/token name',
    match: (s) =>
      s.type === 'hidden' &&
      has(nameIdLike(s), /(csrf|xsrf|_token|authenticity.?token|nonce|state)/i),
    result: {
      semantic_type: 'hidden_token',
      data_category: 'security_token',
      security_relevance: 'high',
    },
  },

  // ── Email ──────────────────────────────────────────────────────────
  {
    description: 'type=email or name/id/label contains email',
    match: (s) =>
      s.type === 'email' ||
      has(nameIdLike(s), /\b(email|e.?mail)\b/i) ||
      has(s.autocomplete ?? '', /email/i) ||
      has(s.label ?? '', /email/i) ||
      has(s.placeholder ?? '', /email/i),
    result: { semantic_type: 'email', data_category: 'pii', security_relevance: 'high' },
  },

  // ── Username / login identifier ────────────────────────────────────
  {
    description: 'username / login field',
    match: (s) =>
      has(nameIdLike(s), /\b(username|user.?name|login|user.?login|handle|account.?name)\b/i) ||
      has(s.autocomplete ?? '', /username/i),
    result: { semantic_type: 'username', data_category: 'credential', security_relevance: 'high' },
  },

  // ── Financial amount ───────────────────────────────────────────────
  {
    description: 'financial amount / price / balance',
    match: (s) =>
      has(nameIdLike(s), /\b(amount|price|cost|balance|total|subtotal|fee|charge|payment)\b/i) ||
      has(s.placeholder ?? '', /amount|price|balance/i),
    result: {
      semantic_type: 'amount',
      data_category: 'financial',
      security_relevance: 'high',
    },
  },

  // ── File upload ────────────────────────────────────────────────────
  {
    description: 'type=file',
    match: (s) => s.type === 'file',
    result: { semantic_type: 'file', data_category: 'user_input', security_relevance: 'high' },
  },

  // ── URL / redirect field ───────────────────────────────────────────
  {
    description: 'URL / redirect input',
    match: (s) =>
      s.type === 'url' ||
      has(
        nameIdLike(s),
        /\b(url|redirect|redirect.?uri|redirect.?url|next|return.?url|callback)\b/i,
      ),
    result: { semantic_type: 'url', data_category: 'user_input', security_relevance: 'high' },
  },

  // ── Search ─────────────────────────────────────────────────────────
  {
    description: 'type=search or name/placeholder suggests search',
    match: (s) =>
      s.type === 'search' ||
      has(nameIdLike(s), /^(q|s|query|search|keyword|term|find)$/i) ||
      has(s.placeholder ?? '', /search|find/i) ||
      has(s.label ?? '', /search|find/i),
    result: {
      semantic_type: 'search',
      data_category: 'user_input',
      security_relevance: 'high',
    },
  },

  // ── Phone ──────────────────────────────────────────────────────────
  {
    description: 'phone number field',
    match: (s) =>
      s.type === 'tel' ||
      has(nameIdLike(s), /\b(phone|mobile|tel|cell|contact.?no)\b/i) ||
      has(s.autocomplete ?? '', /tel/i),
    result: { semantic_type: 'phone', data_category: 'pii', security_relevance: 'medium' },
  },

  // ── Date ───────────────────────────────────────────────────────────
  {
    description: 'date / datetime field',
    match: (s) =>
      s.type === 'date' ||
      s.type === 'datetime-local' ||
      s.type === 'month' ||
      s.type === 'week' ||
      has(nameIdLike(s), /\b(date|dob|birth.?date|expir)/i),
    result: { semantic_type: 'date', data_category: 'pii', security_relevance: 'medium' },
  },

  // ── Numeric ID / record reference ─────────────────────────────────
  {
    description: 'numeric ID / record reference',
    match: (s) =>
      has(
        nameIdLike(s),
        /\b(user.?id|account.?id|order.?id|record.?id|item.?id|resource.?id|invoice.?id)\b/i,
      ),
    result: {
      semantic_type: 'id',
      data_category: 'identifier',
      security_relevance: 'high',
    },
  },

  // ── Comment / free-text ───────────────────────────────────────────
  {
    description: 'comment / message / free-text textarea',
    match: (s) =>
      has(nameIdLike(s), /\b(comment|message|body|content|description|note|review|reply)\b/i),
    result: {
      semantic_type: 'comment',
      data_category: 'user_input',
      security_relevance: 'high',
    },
  },

  // ── Generic textarea → comment-like ───────────────────────────────
  {
    description: 'textarea without specific classification',
    match: (s) => s.type === 'textarea',
    result: {
      semantic_type: 'comment',
      data_category: 'user_input',
      security_relevance: 'medium',
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Classifier entry point                                              */
/* ------------------------------------------------------------------ */

const FALLBACK: SemanticClassification = {
  semantic_type: 'unknown',
  data_category: 'unknown',
  security_relevance: 'low',
};

/**
 * Classify a single input field by its DOM signals.
 * Returns the first matching rule result, or the fallback unknown classification.
 */
export function classifyInput(signals: InputSignals): SemanticClassification {
  // Normalise type: select and textarea are treated as their own "type"
  const normSignals: InputSignals = {
    ...signals,
    type: signals.type?.toLowerCase() ?? null,
  };

  for (const rule of RULES) {
    if (rule.match(normSignals)) {
      return { ...rule.result };
    }
  }

  // Heuristic: any remaining text-like input with a meaningful name that
  // contains injection-prone characters in its context → medium relevance
  const combined = allText(normSignals);
  if (
    normSignals.type !== 'hidden' &&
    normSignals.type !== 'checkbox' &&
    normSignals.type !== 'radio' &&
    normSignals.type !== 'submit' &&
    normSignals.type !== 'reset' &&
    normSignals.type !== 'button' &&
    normSignals.type !== 'image' &&
    combined.length > 4
  ) {
    return {
      semantic_type: 'unknown',
      data_category: 'user_input',
      security_relevance: 'medium',
    };
  }

  return { ...FALLBACK };
}
