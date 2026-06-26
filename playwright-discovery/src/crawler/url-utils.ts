/**
 * URL normalization and validation utilities.
 * Normalized URLs are used as the dedup key for the crawl queue.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_eid',
  'mc_cid',
  '_ga',
  'ref',
  'ref_src',
]);

const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.mp4',
  '.mp3',
  '.wav',
  '.avi',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]);

const SKIP_PROTOCOLS = ['mailto:', 'tel:', 'sms:', 'javascript:', 'data:', 'blob:'];

/**
 * Normalize a URL to its canonical form used as the dedup key.
 *
 * Steps:
 * 1. Resolve relative URLs against base.
 * 2. Lowercase scheme + host.
 * 3. Strip fragment (#section).
 * 4. Drop common tracking params.
 * 5. Sort remaining query params alphabetically.
 * 6. Trim trailing slash except for the root path.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    return null;
  }

  if (SKIP_PROTOCOLS.some((p) => parsed.protocol === p.replace(':', ':'))) {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // Drop fragment
  parsed.hash = '';

  // Drop tracking params and sort the rest
  const filteredParams: [string, string][] = [];
  for (const [key, value] of parsed.searchParams) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      filteredParams.push([key, value]);
    }
  }
  filteredParams.sort(([a], [b]) => a.localeCompare(b));

  // Rebuild search string
  parsed.search = '';
  for (const [k, v] of filteredParams) {
    parsed.searchParams.append(k, v);
  }

  // Lowercase host (URL already does this, but ensure)
  parsed.host = parsed.host.toLowerCase();

  // Trim trailing slash except for root
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }
  parsed.pathname = pathname || '/';

  return parsed.toString();
}

/**
 * Check if a path looks like a static asset we should skip.
 */
export function isAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.toLowerCase();
    const dot = lastSegment.lastIndexOf('.');
    if (dot === -1) return false;
    const ext = lastSegment.slice(dot);
    return SKIP_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

export interface ScopeRules {
  base_url: string;
  same_domain_only: boolean;
  follow_subdomains: boolean;
  include: string[];
  exclude: string[];
}

/**
 * Check if a URL is in scope per the configuration.
 * include/exclude patterns are simple glob-style (* matches any segment, ** matches any path).
 */
export function isInScope(url: string, rules: ScopeRules): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(rules.base_url);
  } catch {
    return false;
  }

  // Domain check
  if (rules.same_domain_only) {
    const targetHost = target.host.toLowerCase();
    const baseHost = base.host.toLowerCase();
    if (targetHost !== baseHost) {
      if (!rules.follow_subdomains) return false;
      // Allow same registrable domain
      if (!targetHost.endsWith(`.${baseHost}`) && targetHost !== baseHost) {
        return false;
      }
    }
  }

  const path = target.pathname;

  // Exclude takes precedence
  if (rules.exclude.length > 0) {
    if (rules.exclude.some((p) => matchGlob(p, path))) return false;
  }

  // If include list is set, URL must match at least one
  if (rules.include.length > 0) {
    return rules.include.some((p) => matchGlob(p, path));
  }

  return true;
}

/**
 * Tiny glob matcher.
 * - '*'  matches any chars except '/'
 * - '**' matches any chars including '/'
 * - paths starting with '/' match path exactly from root
 */
export function matchGlob(pattern: string, path: string): boolean {
  // Convert glob to regex
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped
    .replace(/\*\*/g, '.+')
    .replace(/(?<!\.)\*/g, '[^/]*');
  const regex = new RegExp(`^${regexBody}$`);
  return regex.test(path);
}

/**
 * Extract path + query for display / matching purposes.
 */
export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}
