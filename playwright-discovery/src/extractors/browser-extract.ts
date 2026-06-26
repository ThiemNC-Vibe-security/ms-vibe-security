/**
 * Browser-side mass extraction.
 *
 * This module exports a single function that runs inside the page via
 * page.evaluate(). Because of that, the function must be SELF-CONTAINED:
 *
 *   - No imports (other than types, which TypeScript strips at compile).
 *   - No closures over Node-side variables.
 *   - Helpers must be inner functions.
 *
 * The function returns a JSON-serializable RawPageSnapshot.
 * Selector resolution happens Node-side, see transformer.ts.
 */

import type {
  RawPageSnapshot,
  RawFormSnapshot,
  RawButtonSnapshot,
  RawLinkSnapshot,
  RawNavSnapshot,
  RawTableSnapshot,
  RawInputSnapshot,
} from './types.js';

/**
 * The function executed in the browser. Exported as a `Function` so the
 * caller can pass it to `page.evaluate(extractRawPageSnapshot)`.
 *
 * NOTE: Do not refactor inner helpers into outer scope - they must travel
 * with the function for serialization to work.
 */
export const extractRawPageSnapshot = (): RawPageSnapshot => {
  /* ---------- helpers ---------- */

  function implicitRole(el: Element): string | null {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a':
        return el.hasAttribute('href') ? 'link' : null;
      case 'button':
        return 'button';
      case 'select':
        return 'combobox';
      case 'textarea':
        return 'textbox';
      case 'nav':
        return 'navigation';
      case 'form':
        return 'form';
      case 'header':
        return 'banner';
      case 'footer':
        return 'contentinfo';
      case 'main':
        return 'main';
      case 'aside':
        return 'complementary';
      case 'input': {
        const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'search') return 'searchbox';
        if (t === 'number') return 'spinbutton';
        return 'textbox';
      }
      default:
        return null;
    }
  }

  function cssEscape(value: string): string {
    const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
    if (css && typeof css.escape === 'function') return css.escape(value);
    return value.replace(/(["\\#.:>+~*=^$|()[\]{}/])/g, '\\$1');
  }

  function findLabel(el: Element): string | null {
    const id = el.getAttribute('id');
    if (id) {
      const lbl = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (lbl) return ((lbl as HTMLElement).innerText ?? lbl.textContent ?? '').trim() || null;
    }
    let p: Element | null = el.parentElement;
    while (p) {
      if (p.tagName.toLowerCase() === 'label') {
        return ((p as HTMLElement).innerText ?? p.textContent ?? '').trim() || null;
      }
      p = p.parentElement;
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((ref) => document.getElementById(ref))
        .filter((n): n is HTMLElement => n !== null)
        .map((n) => (n.innerText ?? n.textContent ?? '').trim())
        .filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }
    return null;
  }

  function buildCssPath(el: Element): string {
    if (el === document.body) return 'body';
    const segments: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.body && current.parentElement) {
      let seg = current.tagName.toLowerCase();
      if (current.id) {
        seg += `#${cssEscape(current.id)}`;
        segments.unshift(seg);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (s) => s.tagName === (current as Element).tagName,
        );
        if (sameTag.length > 1) {
          seg += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
        }
      }
      segments.unshift(seg);
      current = current.parentElement;
    }
    return segments.join(' > ') || el.tagName.toLowerCase();
  }

  function extractInfo(el: Element) {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id');
    const name = el.getAttribute('name');
    const inputType = (el as HTMLInputElement).type ?? el.getAttribute('type');
    const role = el.getAttribute('role') ?? implicitRole(el);
    const ariaLabel = el.getAttribute('aria-label');
    const title = el.getAttribute('title');
    const href = el.getAttribute('href');
    const placeholder = el.getAttribute('placeholder');
    const className =
      typeof el.className === 'string' && el.className ? el.className : null;

    const testIdAttrs = ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa'];
    let testId: string | null = null;
    let testIdAttribute: string | null = null;
    for (const a of testIdAttrs) {
      const v = el.getAttribute(a);
      if (v) {
        testId = v;
        testIdAttribute = a;
        break;
      }
    }

    const rawText = (el as HTMLElement).innerText ?? el.textContent ?? '';
    const text = rawText.trim().slice(0, 200) || null;
    const label = findLabel(el);
    const cssPath = buildCssPath(el);
    const isUnique = (() => {
      try {
        return document.querySelectorAll(cssPath).length === 1;
      } catch {
        return false;
      }
    })();

    return {
      tag,
      id: id || null,
      name: name || null,
      type: inputType || null,
      role: role || null,
      ariaLabel: ariaLabel || null,
      text,
      placeholder: placeholder || null,
      title: title || null,
      href: href || null,
      className,
      testId,
      testIdAttribute,
      label,
      cssPath,
      isUnique,
    };
  }

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el as HTMLElement);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = (el as HTMLElement).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function detectCsrf(form: HTMLFormElement): { has: boolean; name: string | null } {
    const hidden = Array.from(form.querySelectorAll('input[type="hidden"]'));
    const csrfPatterns = /(csrf|xsrf|authenticity[_-]?token|_token)/i;
    for (const inp of hidden) {
      const n = (inp as HTMLInputElement).name;
      if (n && csrfPatterns.test(n)) return { has: true, name: n };
    }
    return { has: false, name: null };
  }

  function classifyButtonType(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link-button';
    if (tag === 'input') {
      const t = ((el as HTMLInputElement).type || '').toLowerCase();
      return t || 'button';
    }
    return (el.getAttribute('type') || 'button').toLowerCase();
  }

  function findSubmitButton(form: HTMLFormElement): Element | null {
    const explicit = form.querySelector(
      'button[type="submit"], input[type="submit"], input[type="image"]',
    );
    if (explicit) return explicit;
    const button = form.querySelector('button:not([type])');
    return button;
  }

  function isExternalLink(href: string): boolean {
    try {
      const target = new URL(href, location.href);
      return target.host !== location.host;
    } catch {
      return false;
    }
  }

  function navItemsFrom(container: Element): Array<{ info: ReturnType<typeof extractInfo>; href: string | null }> {
    const anchors = Array.from(container.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    return anchors
      .filter(isVisible)
      .map((a) => ({ info: extractInfo(a), href: a.getAttribute('href') }));
  }

  /* ---------- extract ---------- */

  // Forms
  const forms: RawFormSnapshot[] = Array.from(document.querySelectorAll('form'))
    .filter(isVisible)
    .map((form) => {
      const formEl = form as HTMLFormElement;
      const inputEls = Array.from(
        form.querySelectorAll('input:not([type="hidden"]), select, textarea'),
      );
      const inputs = inputEls.map(extractInfo);
      const submitEl = findSubmitButton(formEl);
      const csrf = detectCsrf(formEl);
      return {
        info: extractInfo(formEl),
        action: formEl.getAttribute('action'),
        method: (formEl.method || 'GET').toUpperCase(),
        enctype: formEl.enctype || null,
        inputs,
        submitButton: submitEl ? extractInfo(submitEl) : null,
        hasCsrfToken: csrf.has,
        csrfFieldName: csrf.name,
      };
    });

  // Buttons (including button-like elements outside forms)
  const buttonEls = Array.from(
    document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
    ),
  ).filter(isVisible);

  const buttons: RawButtonSnapshot[] = buttonEls.map((el) => ({
    info: extractInfo(el),
    buttonType: classifyButtonType(el),
    inForm: el.closest('form') !== null,
  }));

  // Links (anchor elements)
  const linkUrlsSet = new Set<string>();
  const linkEls = Array.from(document.querySelectorAll('a[href]')).filter(
    isVisible,
  ) as HTMLAnchorElement[];
  const links: RawLinkSnapshot[] = linkEls.map((a) => {
    const href = a.getAttribute('href') || '';
    let absolute = href;
    try {
      absolute = new URL(href, location.href).toString();
    } catch {
      /* ignore */
    }
    linkUrlsSet.add(absolute);
    return {
      info: extractInfo(a),
      href,
      isExternal: isExternalLink(href),
    };
  });

  // Standalone inputs (not in any form)
  const standaloneInputEls = Array.from(
    document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
  ).filter((el) => !el.closest('form') && isVisible(el));

  const inputsOutsideForms: RawInputSnapshot[] = standaloneInputEls.map((el) => {
    const inp = el as HTMLInputElement;
    return {
      info: extractInfo(el),
      required: inp.required ?? false,
      defaultValue: inp.defaultValue || null,
      minLength: inp.minLength > 0 ? inp.minLength : null,
      maxLength: inp.maxLength > 0 ? inp.maxLength : null,
      pattern: inp.pattern || null,
      autocomplete: inp.autocomplete || null,
    };
  });

  // Navigation regions
  const navigation: RawNavSnapshot[] = [];

  const navbarSelectors = [
    'nav',
    '[role="navigation"]',
    'header nav',
    '.navbar',
    '#navbar',
    '#nav',
  ];
  const sidebarSelectors = ['aside', '[role="complementary"]', '.sidebar', '#sidebar'];
  const footerSelectors = ['footer', '[role="contentinfo"]'];
  const breadcrumbSelectors = ['[aria-label*="breadcrumb" i]', '.breadcrumb', '#breadcrumb'];

  for (const sel of navbarSelectors) {
    const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    for (const el of els) {
      const items = navItemsFrom(el);
      if (items.length > 0) {
        navigation.push({ section: 'navbar', items });
        break;
      }
    }
  }

  for (const sel of sidebarSelectors) {
    const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    for (const el of els) {
      const items = navItemsFrom(el);
      if (items.length > 0) {
        navigation.push({ section: 'sidebar', items });
        break;
      }
    }
  }

  for (const sel of footerSelectors) {
    const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    for (const el of els) {
      const items = navItemsFrom(el);
      if (items.length > 0) {
        navigation.push({ section: 'footer', items });
        break;
      }
    }
  }

  for (const sel of breadcrumbSelectors) {
    const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    for (const el of els) {
      const items = navItemsFrom(el);
      if (items.length > 0) {
        navigation.push({ section: 'breadcrumb', items });
        break;
      }
    }
  }

  // Tables
  const tables: RawTableSnapshot[] = Array.from(document.querySelectorAll('table'))
    .filter(isVisible)
    .map((table) => {
      const headers = Array.from(table.querySelectorAll('thead th, thead td'));
      const headerCols =
        headers.length > 0
          ? headers.map((h) => (h.textContent ?? '').trim()).filter(Boolean)
          : Array.from(table.querySelectorAll('tr:first-child th, tr:first-child td')).map(
              (c) => (c.textContent ?? '').trim(),
            );
      const rowCount = table.querySelectorAll('tbody tr').length || table.querySelectorAll('tr').length;
      return {
        info: extractInfo(table),
        columns: headerCols,
        rowCount,
      };
    });

  return {
    url: location.href,
    title: document.title,
    language: document.documentElement.lang || '',
    forms,
    buttons,
    links,
    inputsOutsideForms,
    navigation,
    tables,
    linkUrls: Array.from(linkUrlsSet),
  };
};
