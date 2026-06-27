/**
 * Detect security-relevant components on a DiscoveredPage.
 *
 * For each component returned, downstream LLMs use:
 *   - component.type            → matches `applies_to` in knowledge YAMLs
 *   - component.selector        → where to inject payloads in generated tests
 *   - component.applicable_attacks → attack ids from the knowledge base that
 *                                    are likely candidates (a hint to the
 *                                    planner, not a hard constraint).
 *   - component.owasp           → mapping to OWASP Top 10 (2025 + 2021)
 *
 * Component types emitted here must match the `applies_to` values used in
 * test-generator/knowledge/attacks/*.yml so the planner can join them.
 */

import type { DiscoveredPage, SecurityComponent } from '../output/schema.js';
import type {
  ExtractedButton,
  ExtractedForm,
  ExtractedInput,
} from '../extractors/types.js';

/**
 * Authoritative map: component type → likely attack ids + OWASP refs.
 * Attack ids must match knowledge/attacks/*.yml `id` fields.
 */
const ATTACK_MAP = {
  login_form: {
    attacks: [
      'sql_injection',
      'nosql_injection',
      'broken_auth',
      'rate_limit',
      'session_fixation',
      'session_cookie_flags',
      'sensitive_data_in_url',
      'default_credentials',
    ],
    owasp: ['A07:2025', 'A05:2025', 'A07:2021', 'A03:2021'],
  },
  admin_login_form: {
    attacks: [
      'sql_injection',
      'broken_auth',
      'default_credentials',
      'rate_limit',
      'session_fixation',
    ],
    owasp: ['A07:2025', 'A02:2025', 'A07:2021'],
  },
  registration_form: {
    attacks: [
      'sql_injection',
      'xss_stored',
      'weak_password_policy',
      'rate_limit',
      'csrf',
    ],
    owasp: ['A07:2025', 'A05:2025', 'A07:2021', 'A03:2021'],
  },
  password_recovery: {
    attacks: ['rate_limit', 'open_redirect', 'sensitive_data_in_url'],
    owasp: ['A07:2025', 'A01:2025', 'A07:2021'],
  },
  password_change_form: {
    attacks: ['weak_password_policy', 'csrf', 'rate_limit', 'session_fixation'],
    owasp: ['A07:2025'],
  },
  password_field: {
    attacks: ['weak_password_policy', 'sensitive_data_in_url', 'broken_auth'],
    owasp: ['A07:2025', 'A07:2021'],
  },
  search_box: {
    attacks: [
      'xss_reflected',
      'xss_dom',
      'sql_injection',
      'nosql_injection',
      'command_injection',
      'ssti',
      'stack_trace_leak',
    ],
    owasp: ['A05:2025', 'A03:2021'],
  },
  comment_form: {
    attacks: ['xss_stored', 'xss_reflected', 'csrf', 'rate_limit'],
    owasp: ['A05:2025', 'A03:2021'],
  },
  profile_form: {
    attacks: ['xss_stored', 'csrf', 'idor'],
    owasp: ['A05:2025', 'A01:2025'],
  },
  generic_form: {
    attacks: [
      'xss_reflected',
      'xss_stored',
      'sql_injection',
      'command_injection',
      'csrf',
      'stack_trace_leak',
    ],
    owasp: ['A05:2025', 'A07:2025', 'A03:2021'],
  },
  file_upload: {
    attacks: ['xss_stored', 'path_traversal', 'command_injection'],
    owasp: ['A05:2025', 'A01:2025', 'A04:2021'],
  },
  file_download: {
    attacks: ['idor', 'path_traversal'],
    owasp: ['A01:2025', 'A01:2021'],
  },
  payment_form: {
    attacks: [
      'csrf',
      'sensitive_data_in_url',
      'mixed_content',
      'security_headers_missing',
    ],
    owasp: ['A04:2025', 'A07:2025', 'A02:2025'],
  },
  admin_function: {
    attacks: ['idor', 'csrf', 'security_headers_missing', 'default_credentials'],
    owasp: ['A01:2025', 'A02:2025', 'A01:2021'],
  },
  csrf_protected_form: {
    attacks: ['csrf'],
    owasp: ['A07:2025', 'A01:2021'],
  },
  form_without_csrf: {
    attacks: ['csrf'],
    owasp: ['A07:2025', 'A01:2021'],
  },
} as const;

/* ---------------------------- Heuristics ---------------------------- */

function isLoginForm(form: ExtractedForm): boolean {
  const hasPassword = form.inputs.some((i) => i.type === 'password');
  if (!hasPassword) return false;
  // Login forms have few fields; registration has more.
  return form.inputs.length <= 3;
}

function isPasswordChangeForm(form: ExtractedForm, url: string): boolean {
  if (/change[-_]?password|update[-_]?password|password[-_]?change/i.test(url)) {
    return form.inputs.some((i) => i.type === 'password');
  }
  // Also: 2+ password fields and a likely "current password" first
  const passwordCount = form.inputs.filter((i) => i.type === 'password').length;
  if (passwordCount < 2) return false;
  const firstPassword = form.inputs.find((i) => i.type === 'password');
  return !!firstPassword && /current|old/i.test(firstPassword.name ?? firstPassword.label ?? '');
}

function isRegistrationForm(form: ExtractedForm): boolean {
  const passwordCount = form.inputs.filter((i) => i.type === 'password').length;
  if (passwordCount >= 2) return true;
  if (passwordCount === 1 && form.inputs.length >= 4) {
    const hasEmail = form.inputs.some((i) => i.type === 'email' || /email/i.test(i.name ?? ''));
    const hasName = form.inputs.some((i) => /name|username|user/i.test(i.name ?? ''));
    return hasEmail || hasName;
  }
  return false;
}

function isCommentForm(form: ExtractedForm, url: string): boolean {
  if (/comment|reply|discuss|post|review/i.test(url)) {
    return form.inputs.some((i) => i.tag === 'textarea');
  }
  // Detect inputs named comment/message
  return form.inputs.some((i) => {
    const id = (i.name ?? i.id ?? '').toLowerCase();
    return /comment|reply|message|body|content/i.test(id) && i.tag === 'textarea';
  });
}

function isProfileForm(form: ExtractedForm, url: string): boolean {
  if (/profile|settings|account|preferences/i.test(url)) {
    return form.inputs.length >= 2;
  }
  return form.inputs.some((i) => /avatar|bio|display[-_]?name|first[-_]?name|last[-_]?name/i.test(i.name ?? ''));
}

function isSearchBox(input: ExtractedInput): boolean {
  if (input.type === 'search') return true;
  if (input.name && /search|query|^q$/i.test(input.name)) return true;
  if (input.placeholder && /search/i.test(input.placeholder)) return true;
  return false;
}

function isFileUploadInput(input: ExtractedInput): boolean {
  return input.type === 'file';
}

function isDownloadButton(button: ExtractedButton): boolean {
  return !!button.text && /download|export|save\s+as|get\s+pdf/i.test(button.text);
}

function isPasswordRecoveryForm(form: ExtractedForm, url: string): boolean {
  if (/forgot|reset[-_]?password|recover/i.test(url)) return true;
  const hasOnlyEmail = form.inputs.length === 1 && form.inputs[0].type === 'email';
  const submitText = form.submit?.text ?? '';
  if (hasOnlyEmail && /reset|recover|forgot/i.test(submitText)) return true;
  return false;
}

function isPaymentForm(form: ExtractedForm, url: string): boolean {
  if (/payment|checkout|billing|cart|order/i.test(url)) return true;
  return form.inputs.some((i) => {
    const id = (i.name ?? i.id ?? '').toLowerCase();
    return (
      /card[-_]?number|cc[-_]?number|cvv|cvc|expir|cardholder/i.test(id) ||
      /card[-_]?number|cvv/i.test(i.placeholder ?? '')
    );
  });
}

function isAdminPage(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/admin(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function classifyForm(
  form: ExtractedForm,
  url: string,
  onAdminPage: boolean,
): keyof typeof ATTACK_MAP | null {
  if (isPaymentForm(form, url)) return 'payment_form';
  if (isPasswordChangeForm(form, url)) return 'password_change_form';
  if (isPasswordRecoveryForm(form, url)) return 'password_recovery';
  if (isLoginForm(form)) return onAdminPage ? 'admin_login_form' : 'login_form';
  if (isRegistrationForm(form)) return 'registration_form';
  if (isCommentForm(form, url)) return 'comment_form';
  if (isProfileForm(form, url)) return 'profile_form';
  // Fallback: any form with at least one input becomes a generic_form so the
  // planner can still consider XSS / injection on it.
  if (form.inputs.length > 0) return 'generic_form';
  return null;
}

/* ---------------------------- Entry point ---------------------------- */

/**
 * Detect all security components on a discovered page.
 */
export function detectSecurityComponents(page: DiscoveredPage): SecurityComponent[] {
  const components: SecurityComponent[] = [];
  const onAdminPage = isAdminPage(page.url);

  // Forms
  for (const form of page.forms) {
    const primaryType = classifyForm(form, page.url, onAdminPage);

    if (primaryType) {
      const meta = ATTACK_MAP[primaryType];
      components.push({
        type: primaryType,
        selector: form.selector,
        applicable_attacks: [...meta.attacks],
        owasp: [...meta.owasp],
        description: `Auto-detected ${primaryType} (${form.inputs.length} inputs)`,
      });
    }

    // CSRF status — flag POST forms regardless of primary classification
    if (form.method.toUpperCase() === 'POST') {
      if (form.csrf_token.present) {
        components.push({
          type: 'csrf_protected_form',
          selector: form.selector,
          applicable_attacks: [...ATTACK_MAP.csrf_protected_form.attacks],
          owasp: [...ATTACK_MAP.csrf_protected_form.owasp],
        });
      } else {
        components.push({
          type: 'form_without_csrf',
          selector: form.selector,
          applicable_attacks: [...ATTACK_MAP.form_without_csrf.attacks],
          owasp: [...ATTACK_MAP.form_without_csrf.owasp],
          description: 'POST form without detectable CSRF token',
        });
      }
    }

    // Password fields and file uploads inside forms
    for (const input of form.inputs) {
      if (input.type === 'password') {
        components.push({
          type: 'password_field',
          selector: input.selector,
          applicable_attacks: [...ATTACK_MAP.password_field.attacks],
          owasp: [...ATTACK_MAP.password_field.owasp],
        });
      }
      if (isFileUploadInput(input)) {
        components.push({
          type: 'file_upload',
          selector: input.selector,
          applicable_attacks: [...ATTACK_MAP.file_upload.attacks],
          owasp: [...ATTACK_MAP.file_upload.owasp],
        });
      }
    }
  }

  // Standalone inputs (outside forms)
  for (const input of page.inputs) {
    if (isSearchBox(input)) {
      components.push({
        type: 'search_box',
        selector: input.selector,
        applicable_attacks: [...ATTACK_MAP.search_box.attacks],
        owasp: [...ATTACK_MAP.search_box.owasp],
      });
    }
    if (isFileUploadInput(input)) {
      components.push({
        type: 'file_upload',
        selector: input.selector,
        applicable_attacks: [...ATTACK_MAP.file_upload.attacks],
        owasp: [...ATTACK_MAP.file_upload.owasp],
      });
    }
    if (input.type === 'password') {
      components.push({
        type: 'password_field',
        selector: input.selector,
        applicable_attacks: [...ATTACK_MAP.password_field.attacks],
        owasp: [...ATTACK_MAP.password_field.owasp],
      });
    }
  }

  // Search inputs inside forms
  for (const form of page.forms) {
    for (const input of form.inputs) {
      if (isSearchBox(input)) {
        components.push({
          type: 'search_box',
          selector: input.selector,
          applicable_attacks: [...ATTACK_MAP.search_box.attacks],
          owasp: [...ATTACK_MAP.search_box.owasp],
        });
      }
    }
  }

  // Download buttons
  for (const button of page.buttons) {
    if (isDownloadButton(button)) {
      components.push({
        type: 'file_download',
        selector: button.selector,
        applicable_attacks: [...ATTACK_MAP.file_download.attacks],
        owasp: [...ATTACK_MAP.file_download.owasp],
      });
    }
  }

  // Admin pages
  if (onAdminPage) {
    components.push({
      type: 'admin_function',
      selector: 'body',
      applicable_attacks: [...ATTACK_MAP.admin_function.attacks],
      owasp: [...ATTACK_MAP.admin_function.owasp],
      description: 'Page under /admin path',
    });
  }

  return dedupComponents(components);
}

function dedupComponents(components: SecurityComponent[]): SecurityComponent[] {
  const seen = new Set<string>();
  const out: SecurityComponent[] = [];
  for (const c of components) {
    const key = `${c.type}::${c.selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
