/**
 * Detect security-relevant components on a DiscoveredPage.
 *
 * For each component returned, downstream LLMs use:
 *   - component.type            → which attack categories to consider
 *   - component.selector        → where to inject payloads in generated tests
 *   - component.applicable_attacks → narrow attack list
 *   - component.owasp           → mapping to OWASP Top 10
 */

import type { DiscoveredPage, SecurityComponent } from '../output/schema.js';
import type {
  ExtractedButton,
  ExtractedForm,
  ExtractedInput,
} from '../extractors/types.js';

const ATTACK_MAP = {
  login_form: {
    attacks: [
      'sql_injection',
      'broken_auth',
      'credential_stuffing',
      'brute_force',
      'no_rate_limit',
      'username_enumeration',
      'auth_bypass',
    ],
    owasp: ['A07:2021', 'A03:2021'],
  },
  registration_form: {
    attacks: [
      'sql_injection',
      'xss_stored',
      'weak_password_accepted',
      'mass_assignment',
      'no_email_verification',
      'username_enumeration',
    ],
    owasp: ['A04:2021', 'A03:2021', 'A07:2021'],
  },
  password_recovery: {
    attacks: [
      'username_enumeration',
      'no_rate_limit',
      'predictable_token',
      'open_redirect',
    ],
    owasp: ['A07:2021', 'A01:2021'],
  },
  password_field: {
    attacks: ['weak_password_accepted', 'password_in_url', 'no_password_complexity'],
    owasp: ['A07:2021'],
  },
  search_box: {
    attacks: ['xss_reflected', 'sql_injection', 'open_redirect'],
    owasp: ['A03:2021'],
  },
  file_upload: {
    attacks: [
      'malicious_file_upload',
      'unrestricted_file_type',
      'path_traversal',
      'oversized_file',
      'svg_xss',
    ],
    owasp: ['A04:2021', 'A05:2021'],
  },
  file_download: {
    attacks: ['idor', 'path_traversal'],
    owasp: ['A01:2021'],
  },
  payment_form: {
    attacks: [
      'price_tampering',
      'no_https',
      'pci_violation',
      'replay_attack',
      'csrf',
    ],
    owasp: ['A04:2021', 'A02:2021', 'A01:2021'],
  },
  admin_function: {
    attacks: ['broken_access_control', 'privilege_escalation', 'csrf'],
    owasp: ['A01:2021'],
  },
  csrf_protected_form: {
    attacks: ['csrf_token_validation', 'token_reuse'],
    owasp: ['A01:2021'],
  },
  form_without_csrf: {
    attacks: ['csrf'],
    owasp: ['A01:2021'],
  },
} as const;

function isLoginForm(form: ExtractedForm): boolean {
  const hasPassword = form.inputs.some((i) => i.type === 'password');
  if (!hasPassword) return false;
  // Login forms have few fields. Registration has more (confirm pwd, name, email, etc.)
  return form.inputs.length <= 3;
}

function isRegistrationForm(form: ExtractedForm): boolean {
  const passwordCount = form.inputs.filter((i) => i.type === 'password').length;
  // Registration typically has password + confirm password, or 4+ inputs with password
  if (passwordCount >= 2) return true;
  if (passwordCount === 1 && form.inputs.length >= 4) {
    // also look for name/email-like fields
    const hasEmail = form.inputs.some((i) => i.type === 'email' || /email/i.test(i.name ?? ''));
    const hasName = form.inputs.some((i) => /name|username|user/i.test(i.name ?? ''));
    return hasEmail || hasName;
  }
  return false;
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
  if (/forgot|reset[-_]?password/i.test(url)) return true;
  const hasOnlyEmail = form.inputs.length === 1 && form.inputs[0].type === 'email';
  const submitText = form.submit?.text ?? '';
  if (hasOnlyEmail && /reset|recover|forgot/i.test(submitText)) return true;
  return false;
}

function isPaymentForm(form: ExtractedForm, url: string): boolean {
  if (/payment|checkout|billing|cart|order/i.test(url)) return true;
  // Detect typical payment fields
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

/**
 * Detect all security components on a discovered page.
 */
export function detectSecurityComponents(page: DiscoveredPage): SecurityComponent[] {
  const components: SecurityComponent[] = [];

  // Forms
  for (const form of page.forms) {
    let primaryType: keyof typeof ATTACK_MAP | null = null;

    if (isPaymentForm(form, page.url)) primaryType = 'payment_form';
    else if (isPasswordRecoveryForm(form, page.url)) primaryType = 'password_recovery';
    else if (isLoginForm(form)) primaryType = 'login_form';
    else if (isRegistrationForm(form)) primaryType = 'registration_form';

    if (primaryType) {
      const meta = ATTACK_MAP[primaryType];
      components.push({
        type: primaryType,
        selector: form.selector,
        applicable_attacks: [...meta.attacks],
        owasp: [...meta.owasp],
        description: `Auto-detected ${primaryType} form (${form.inputs.length} inputs)`,
      });
    }

    // CSRF status — flag forms that should have a token but don't
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

    // Password fields (standalone signal)
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

  // Standalone inputs
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

  // Inputs inside forms — search box detection
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

  // Admin
  if (isAdminPage(page.url)) {
    components.push({
      type: 'admin_function',
      selector: 'body',
      applicable_attacks: [...ATTACK_MAP.admin_function.attacks],
      owasp: [...ATTACK_MAP.admin_function.owasp],
      description: 'Page under /admin path',
    });
  }

  // Dedup by (type, selector)
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
