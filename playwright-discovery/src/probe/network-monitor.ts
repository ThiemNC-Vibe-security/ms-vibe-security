/**
 * Network Monitor (Phase 5)
 *
 * Captures XHR/fetch requests made by the browser during crawling via
 * Playwright's `page.on('request')` / `page.on('response')` listeners.
 *
 * Produces a deduplicated list of API endpoints observed across all pages,
 * plus a summary of methods and counts.
 *
 * Safety rules:
 *   - Never stores raw token/password values — sensitive fields are REDACTED.
 *   - Response bodies are NOT captured by default (high memory risk).
 *   - Request bodies are sampled up to `max_body_sample_size` bytes.
 *   - Binary / non-text responses are skipped entirely.
 *   - All errors in listeners are swallowed silently (non-fatal).
 *
 * Dedup key: `METHOD + normalizedPath`
 * Path normalization: numeric segments and UUID-like segments → `:id`
 */

import type { Page, Request, Response } from 'playwright';
import type { NetworkConfig } from '../config/schema.js';
import { logger } from '../utils/logger.js';

/* ------------------------------------------------------------------ */
/*  Public types (also exported for schema.ts)                         */
/* ------------------------------------------------------------------ */

export interface CapturedEndpoint {
  method: string;
  url: string;
  path: string;
  normalized_path: string;
  resource_type: string;
  initiator_page_url: string;
  request_headers: Record<string, string>;
  request_body_sample: unknown;
  response_status: number | null;
  response_content_type: string | null;
  response_body_sample: unknown;
  query_parameters: Array<{ name: string; value: string }>;
  auth_related: boolean;
  sensitive_data_detected: string[];
  discovered_at: string;
}

export interface NetworkSummary {
  total_requests: number;
  total_api_endpoints: number;
  methods: {
    GET: number;
    POST: number;
    PUT: number;
    DELETE: number;
    PATCH: number;
    OTHER: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Sensitive field patterns — values matching these keys are redacted  */
/* ------------------------------------------------------------------ */

const SENSITIVE_KEY_PATTERN =
  /password|passwd|pass|secret|token|access.?token|refresh.?token|authorization|auth|cookie|api.?key|apikey|jwt|session|csrf|xsrf|nonce|private.?key|client.?secret/i;

const SENSITIVE_VALUE_PATTERN =
  /^(Bearer\s|Basic\s|eyJ)/i; // JWT / Bearer / Basic auth values

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Replace sensitive values in a parsed JSON-like object. */
function redactObject(
  obj: unknown,
  detectedKeys: Set<string>,
): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((v) => redactObject(v, detectedKeys));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        detectedKeys.add(k);
        result[k] = 'REDACTED';
      } else if (typeof v === 'string' && SENSITIVE_VALUE_PATTERN.test(v)) {
        detectedKeys.add(k);
        result[k] = 'REDACTED';
      } else {
        result[k] = redactObject(v, detectedKeys);
      }
    }
    return result;
  }

  return obj;
}

/** Redact sensitive headers (Authorization, Cookie, Set-Cookie). */
function redactHeaders(
  headers: Record<string, string>,
  detectedKeys: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      detectedKeys.add(k.toLowerCase());
      out[k] = 'REDACTED';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Parse a request body string → JSON object or form-urlencoded map.
 * Returns null if unparseable.
 */
function parseBody(raw: string | null, contentType: string | null): unknown {
  if (!raw || raw.length === 0) return null;

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Return truncated raw string on parse failure
      return raw.slice(0, 200);
    }
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(raw);
      const obj: Record<string, string> = {};
      for (const [k, v] of params) obj[k] = v;
      return obj;
    } catch {
      return raw.slice(0, 200);
    }
  }

  // Unknown content type — return truncated raw
  return raw.slice(0, 200);
}

/**
 * Normalize a URL path: replace numeric segments and UUID-like segments with `:id`.
 *
 * /api/users/123        → /api/users/:id
 * /api/items/abc-123-def → /api/items/:id
 */
export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
        return ':id';
      // ObjectId-like (MongoDB 24-char hex)
      if (/^[0-9a-f]{24}$/i.test(segment)) return ':id';
      return segment;
    })
    .join('/');
}

/** Extract query parameters from a URL string. */
function extractQueryParams(url: string): Array<{ name: string; value: string }> {
  try {
    const parsed = new URL(url);
    const params: Array<{ name: string; value: string }> = [];
    for (const [name, value] of parsed.searchParams) {
      params.push({ name, value: SENSITIVE_KEY_PATTERN.test(name) ? 'REDACTED' : value });
    }
    return params;
  } catch {
    return [];
  }
}

const AUTH_PATH_PATTERN =
  /\/(auth|login|logout|signin|signup|register|token|refresh|oauth|session|password|account\/verify)/i;

const AUTH_HEADER_PATTERN = /authorization|x-auth-token|x-access-token/i;

/* ------------------------------------------------------------------ */
/*  NetworkMonitor class                                                */
/* ------------------------------------------------------------------ */

/**
 * Attach to a Playwright Page, listen to requests/responses, and accumulate
 * deduplicated endpoints. Call `flush()` to get the final endpoint list.
 */
export class NetworkMonitor {
  private readonly config: NetworkConfig;
  private readonly pageUrl: string;

  /** Dedup key → endpoint (latest response info wins) */
  private readonly endpointMap = new Map<string, CapturedEndpoint>();

  /** Pending: request object waiting for its response */
  private readonly pendingRequests = new Map<Request, { bodyRaw: string | null; ct: string | null }>();

  constructor(config: NetworkConfig, pageUrl: string) {
    this.config = config;
    this.pageUrl = pageUrl;
  }

  /**
   * Attach request/response listeners to a Playwright page.
   * Returns a cleanup function — call it before page.close().
   */
  attach(page: Page): () => void {
    const onRequest = (req: Request) => {
      try {
        this.handleRequest(req);
      } catch {
        /* non-fatal */
      }
    };

    const onResponse = (resp: Response) => {
      // Use void + catch to handle the async response processing
      void this.handleResponse(resp).catch(() => {/* non-fatal */});
    };

    page.on('request', onRequest);
    page.on('response', onResponse);

    return () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    };
  }

  private handleRequest(req: Request): void {
    const resourceType = req.resourceType();

    // Skip non-API resources when xhr_only is enabled
    if (this.config.xhr_only && resourceType !== 'xhr' && resourceType !== 'fetch') {
      return;
    }

    // Skip static assets regardless
    if (['image', 'stylesheet', 'font', 'media', 'websocket', 'manifest'].includes(resourceType)) {
      return;
    }

    let bodyRaw: string | null = null;
    try {
      bodyRaw = req.postData();
    } catch {
      bodyRaw = null;
    }

    // Trim to max_body_sample_size
    if (bodyRaw && bodyRaw.length > this.config.max_body_sample_size) {
      bodyRaw = bodyRaw.slice(0, this.config.max_body_sample_size);
    }

    const ct = req.headers()['content-type'] ?? null;
    this.pendingRequests.set(req, { bodyRaw, ct });
  }

  private async handleResponse(resp: Response): Promise<void> {
    const req = resp.request();
    const pending = this.pendingRequests.get(req);
    if (!pending) return; // not tracked

    this.pendingRequests.delete(req);

    const method = req.method().toUpperCase();
    const rawUrl = req.url();
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return;
    }

    const path = parsed.pathname;
    const normalizedPath = normalizePath(path);
    const dedupKey = `${method}::${normalizedPath}`;

    const detectedSensitive = new Set<string>();

    // Process request body
    let requestBodySample: unknown = null;
    if (this.config.capture_request_body && pending.bodyRaw) {
      const parsed = parseBody(pending.bodyRaw, pending.ct);
      requestBodySample = this.config.redact_sensitive_values
        ? redactObject(parsed, detectedSensitive)
        : parsed;
    }

    // Process request headers (redact auth headers)
    const rawHeaders = req.headers();
    const requestHeaders = this.config.redact_sensitive_values
      ? redactHeaders(rawHeaders, detectedSensitive)
      : rawHeaders;

    // Check if auth-related
    const authRelated =
      AUTH_PATH_PATTERN.test(path) ||
      Object.keys(rawHeaders).some((h) => AUTH_HEADER_PATTERN.test(h));

    if (authRelated) detectedSensitive.add('auth_endpoint');

    // Process response body (only if enabled and text content type)
    let responseBodySample: unknown = null;
    const respContentType = resp.headers()['content-type'] ?? null;

    if (
      this.config.capture_response_body &&
      respContentType &&
      (respContentType.includes('application/json') || respContentType.includes('text/'))
    ) {
      try {
        const text = await resp.text();
        const truncated = text.slice(0, this.config.max_body_sample_size);
        const bodyParsed = parseBody(truncated, respContentType);
        responseBodySample = this.config.redact_sensitive_values
          ? redactObject(bodyParsed, detectedSensitive)
          : bodyParsed;
      } catch {
        responseBodySample = null;
      }
    }

    // Query parameters
    const queryParameters = extractQueryParams(rawUrl);

    const endpoint: CapturedEndpoint = {
      method,
      url: `${parsed.origin}${parsed.pathname}`, // strip query string from stored URL
      path,
      normalized_path: normalizedPath,
      resource_type: req.resourceType(),
      initiator_page_url: this.pageUrl,
      request_headers: requestHeaders,
      request_body_sample: requestBodySample,
      response_status: resp.status(),
      response_content_type: respContentType,
      response_body_sample: responseBodySample,
      query_parameters: queryParameters,
      auth_related: authRelated,
      sensitive_data_detected: Array.from(detectedSensitive),
      discovered_at: new Date().toISOString(),
    };

    // Dedup: keep latest (updates response_status and body sample)
    this.endpointMap.set(dedupKey, endpoint);
  }

  /** Return all captured endpoints as an array. */
  flush(): CapturedEndpoint[] {
    return Array.from(this.endpointMap.values());
  }
}

/* ------------------------------------------------------------------ */
/*  Summary builder                                                     */
/* ------------------------------------------------------------------ */

export function buildNetworkSummary(
  endpoints: CapturedEndpoint[],
  totalRequestCount: number,
): NetworkSummary {
  const methods = { GET: 0, POST: 0, PUT: 0, DELETE: 0, PATCH: 0, OTHER: 0 };
  for (const ep of endpoints) {
    const m = ep.method as keyof typeof methods;
    if (m in methods) {
      methods[m]++;
    } else {
      methods.OTHER++;
    }
  }

  return {
    total_requests: totalRequestCount,
    total_api_endpoints: endpoints.length,
    methods,
  };
}
