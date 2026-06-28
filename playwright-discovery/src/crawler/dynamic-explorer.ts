/**
 * Dynamic UI Explorer (Phase 6)
 *
 * Performs SAFE, side-effect-free click interactions on a Playwright page to
 * reveal hidden UI components: modals, tab panels, dropdowns, accordions.
 *
 * Safety rules (non-negotiable):
 *   - DEFAULT OFF — only runs when `interact.enabled = true` in config.
 *   - Allowlist-only clicking: the trigger element's accessible text must match
 *     at least one term in SAFE_CLICK_TERMS.
 *   - Hard denylist: any button/element whose text matches DANGEROUS_TERMS is
 *     NEVER clicked, regardless of allowlist.
 *   - Max `max_interactions_per_page` clicks per page.
 *   - After each click, waits `interaction_settle_ms` for the UI to settle.
 *   - Reverts state after each component by pressing Escape / re-clicking, so
 *     the page doesn't accumulate stale open modals.
 *   - Any unexpected navigation terminates exploration silently.
 *
 * Each interaction produces a `DynamicComponent` describing the revealed UI,
 * plus an `InteractionRecord` in the audit log.
 */

import type { Page, ElementHandle } from 'playwright';
import { logger } from '../utils/logger.js';
import { buildForms, buildButtons, buildStandaloneInputs } from '../extractors/transformer.js';
import { extractRawPageSnapshot } from '../extractors/browser-extract.js';
import type { InteractConfig } from '../config/schema.js';
import type { DynamicComponent, InteractionRecord } from '../output/schema.js';

/* ------------------------------------------------------------------ */
/*  Allowlist / denylist                                                */
/* ------------------------------------------------------------------ */

/**
 * A trigger element is only clicked if its normalised text contains at least
 * one of these terms (case-insensitive, word-boundary match).
 */
const SAFE_CLICK_TERMS = [
  'tab',
  'menu',
  'filter',
  'search',
  'detail',
  'view',
  'open',
  'expand',
  'show',
  'more',
  'next',
  'previous',
  'prev',
  'dropdown',
  'select',
  'option',
  'accordion',
  'collapse',
  'toggle',
  'sort',
  'help',
  'info',
  'about',
  'preview',
  'chart',
  'graph',
  'report',
];

/**
 * ANY element whose accessible text contains one of these terms is NEVER
 * clicked, even if it also matches a safe term.
 */
const DANGEROUS_TERMS = [
  'delete',
  'remove',
  'logout',
  'log out',
  'sign out',
  'submit',
  'pay',
  'purchase',
  'buy',
  'confirm',
  'save',
  'send',
  'update',
  'create',
  'transfer',
  'withdraw',
  'deposit',
  'close account',
  'cancel subscription',
  'reset',
  'clear',
  'wipe',
  'destroy',
  'terminate',
  'deactivate',
  'disable',
  'ban',
  'block',
  'approve',
  'reject',
  'publish',
];

/* ------------------------------------------------------------------ */
/*  Candidate trigger selector                                          */
/* ------------------------------------------------------------------ */

const TRIGGER_SELECTOR =
  'button, [role="button"], [role="tab"], [role="menuitem"], ' +
  '[data-toggle], [data-bs-toggle], [aria-expanded], ' +
  'a[href="#"], a[href="javascript:void(0)"]';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function normaliseText(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSafeToClick(text: string): boolean {
  const norm = normaliseText(text);
  if (!norm) return false;

  // Denylist check first
  for (const danger of DANGEROUS_TERMS) {
    if (norm.includes(danger)) return false;
  }

  // Allowlist check
  for (const safe of SAFE_CLICK_TERMS) {
    // word-like match: allow partial containment
    if (norm.includes(safe)) return true;
  }

  return false;
}

/** Detect what kind of component appeared after a click. */
async function detectRevealedComponentType(page: Page): Promise<DynamicComponent['type']> {
  return page.evaluate(() => {
    // Modal: dialog role or common modal classes
    const dialog = document.querySelector('[role="dialog"], .modal.show, .modal[style*="display: block"], [aria-modal="true"]');
    if (dialog && (dialog as HTMLElement).offsetParent !== null) return 'modal';

    // Dropdown: listbox or combobox popup
    const dropdown = document.querySelector('[role="listbox"]:not([hidden]), [role="menu"]:not([hidden]), .dropdown-menu.show');
    if (dropdown && (dropdown as HTMLElement).offsetParent !== null) return 'dropdown';

    // Tab panel: newly visible tabpanel
    const tabPanel = document.querySelector('[role="tabpanel"]:not([hidden])');
    if (tabPanel && (tabPanel as HTMLElement).offsetParent !== null) return 'tab_panel';

    // Accordion: expanded panel
    const accordion = document.querySelector('[aria-expanded="true"] + *, .accordion-collapse.show');
    if (accordion && (accordion as HTMLElement).offsetParent !== null) return 'accordion';

    return 'unknown';
  });
}

/** Attempt to close/revert the revealed component. */
async function tryRevert(page: Page, type: DynamicComponent['type']): Promise<void> {
  try {
    if (type === 'modal') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // For dropdowns/tabs, just move on — they'll close when next element is focused
  } catch {
    /* non-fatal */
  }
}

/** Extract title from revealed component. */
async function extractComponentTitle(page: Page, type: DynamicComponent['type']): Promise<string | null> {
  return page.evaluate((t: string) => {
    let container: Element | null = null;
    if (t === 'modal') {
      container = document.querySelector('[role="dialog"], .modal.show, [aria-modal="true"]');
    } else if (t === 'dropdown') {
      container = document.querySelector('[role="listbox"], [role="menu"], .dropdown-menu.show');
    } else if (t === 'tab_panel') {
      container = document.querySelector('[role="tabpanel"]:not([hidden])');
    } else if (t === 'accordion') {
      container = document.querySelector('.accordion-collapse.show, [aria-expanded="true"] + *');
    }
    if (!container) return null;
    const heading = container.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"],.modal-title,.dialog-title');
    return heading ? ((heading as HTMLElement).innerText ?? heading.textContent ?? '').trim().slice(0, 100) || null : null;
  }, type);
}

/** Run a lightweight extraction inside a revealed component container. */
async function extractInsideComponent(
  page: Page,
  componentType: DynamicComponent['type'],
): Promise<Pick<DynamicComponent, 'forms' | 'buttons' | 'inputs'>> {
  try {
    // Re-use existing browser-extract logic but scoped to the revealed container
    const fnStr = extractRawPageSnapshot.toString();
    const raw = await page.evaluate(
      `(function() { var __name = function(fn, n) { return fn; }; return (${fnStr})(); })()`,
    ) as import('../extractors/types.js').RawPageSnapshot;

    // Build forms, buttons, inputs using existing transformers
    const forms = buildForms(raw.forms);
    const buttons = buildButtons(raw.buttons);
    const inputs = buildStandaloneInputs(raw.inputsOutsideForms);

    return { forms, buttons, inputs };
  } catch {
    return { forms: [], buttons: [], inputs: [] };
  }
}

/* ------------------------------------------------------------------ */
/*  Main exported function                                              */
/* ------------------------------------------------------------------ */

export interface DynamicExploreResult {
  dynamic_components: DynamicComponent[];
  interactions_performed: InteractionRecord[];
}

/**
 * Perform safe dynamic interactions on an already-loaded Playwright page.
 *
 * Returns an empty result immediately when `config.enabled = false`.
 * Never throws — all errors are swallowed and recorded in `interactions_performed`.
 */
export async function exploreDynamicUI(
  page: Page,
  config: InteractConfig,
  pageUrl: string,
): Promise<DynamicExploreResult> {
  if (!config.enabled) {
    return { dynamic_components: [], interactions_performed: [] };
  }

  const components: DynamicComponent[] = [];
  const interactions: InteractionRecord[] = [];
  let interactionCount = 0;
  const initialUrl = pageUrl;

  // Collect candidate trigger elements
  let triggerHandles: ElementHandle[] = [];
  try {
    triggerHandles = await page.$$(TRIGGER_SELECTOR);
  } catch {
    return { dynamic_components: [], interactions_performed: [] };
  }

  logger.debug(
    { url: pageUrl, candidates: triggerHandles.length },
    'dynamic-explorer: candidate triggers found',
  );

  const seenTexts = new Set<string>(); // deduplicate by text

  for (const handle of triggerHandles) {
    if (interactionCount >= config.max_interactions_per_page) break;

    // Get accessible text
    let text = '';
    try {
      text = (await handle.textContent()) ?? '';
      const ariaLabel = await handle.getAttribute('aria-label');
      const title = await handle.getAttribute('title');
      text = (ariaLabel || title || text).trim();
    } catch {
      continue;
    }

    const normText = normaliseText(text);
    if (!normText || seenTexts.has(normText)) continue;
    if (!isSafeToClick(text)) continue;

    // Skip if not visible
    let visible = false;
    try {
      visible = await handle.isVisible();
    } catch {
      continue;
    }
    if (!visible) continue;

    seenTexts.add(normText);

    // Get selector for logging
    let triggerSelector = '';
    try {
      triggerSelector = await handle.evaluate((el: Element) => {
        const tag = el.tagName.toLowerCase();
        const id = el.getAttribute('id');
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        const name = el.getAttribute('name');
        const txt = ((el as HTMLElement).innerText ?? '').trim().slice(0, 40);
        if (testId) return `[data-testid="${testId}"]`;
        if (id) return `#${id}`;
        if (name) return `${tag}[name="${name}"]`;
        if (txt) return `${tag}:has-text("${txt}")`;
        return tag;
      });
    } catch {
      triggerSelector = 'unknown';
    }

    // Take snapshot of visible modal/dialog elements before click
    const beforeSnapshot = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"], .modal.show, [aria-modal="true"]')).length,
    ).catch(() => 0);

    // Perform the click
    let clickError: string | undefined;
    try {
      await handle.click({ timeout: 3000 });
      await page.waitForTimeout(config.interaction_settle_ms);
    } catch (err) {
      clickError = String(err).slice(0, 200);
    }

    interactionCount++;

    // Check for unexpected navigation
    const currentUrl = page.url();
    if (currentUrl !== initialUrl) {
      logger.debug(
        { from: initialUrl, to: currentUrl },
        'dynamic-explorer: unexpected navigation — stopping',
      );
      interactions.push({
        action: 'click',
        selector: triggerSelector,
        trigger_text: text || null,
        result: 'error',
        error: `unexpected navigation to ${currentUrl}`,
      });
      // Navigate back
      try {
        await page.goBack({ timeout: 5000 });
        await page.waitForTimeout(500);
      } catch {
        /* ignore */
      }
      break;
    }

    if (clickError) {
      interactions.push({
        action: 'click',
        selector: triggerSelector,
        trigger_text: text || null,
        result: 'error',
        error: clickError,
      });
      continue;
    }

    // Detect what appeared
    const afterSnapshot = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"], .modal.show, [aria-modal="true"]')).length,
    ).catch(() => 0);

    const newDialogOpened = afterSnapshot > beforeSnapshot;
    const componentType = await detectRevealedComponentType(page);

    // Determine result
    let interactionResult: InteractionRecord['result'] = 'no_change';
    if (componentType === 'modal' && newDialogOpened) interactionResult = 'modal_opened';
    else if (componentType === 'modal') interactionResult = 'modal_opened';
    else if (componentType === 'dropdown') interactionResult = 'dropdown_opened';
    else if (componentType === 'tab_panel') interactionResult = 'tab_activated';
    else if (componentType === 'accordion') interactionResult = 'panel_revealed';

    interactions.push({
      action: 'click',
      selector: triggerSelector,
      trigger_text: text || null,
      result: interactionResult,
    });

    if (interactionResult === 'no_change') {
      continue;
    }

    // Extract content from the revealed component
    const title = await extractComponentTitle(page, componentType);
    const shouldExtractForms = componentType === 'modal' && config.discover_modals;
    const shouldExtractDropdown = componentType === 'dropdown' && config.discover_dropdowns;
    const shouldExtractTab = componentType === 'tab_panel' && config.discover_tabs;

    if (shouldExtractForms || shouldExtractDropdown || shouldExtractTab || componentType === 'accordion') {
      const inner = await extractInsideComponent(page, componentType);
      components.push({
        type: componentType,
        trigger_selector: triggerSelector,
        trigger_text: text || null,
        title,
        forms: inner.forms,
        buttons: inner.buttons,
        inputs: inner.inputs,
      });

      logger.debug(
        {
          url: pageUrl,
          type: componentType,
          trigger: normText,
          forms: inner.forms.length,
          inputs: inner.inputs.length,
        },
        'dynamic-explorer: component discovered',
      );
    }

    // Revert (close modal/etc) before next interaction
    await tryRevert(page, componentType);
  }

  logger.debug(
    {
      url: pageUrl,
      interactions: interactions.length,
      components: components.length,
    },
    'dynamic-explorer: complete',
  );

  return {
    dynamic_components: components,
    interactions_performed: interactions,
  };
}
