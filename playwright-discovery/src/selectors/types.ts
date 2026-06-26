/**
 * Element info extracted from the DOM.
 * This is the JSON-serializable shape returned by browser-side scripts
 * and consumed by the Node-side selector formatter.
 */
export interface ElementInfo {
  tag: string;
  id: string | null;
  name: string | null;
  type: string | null;
  role: string | null;
  ariaLabel: string | null;
  text: string | null;
  placeholder: string | null;
  title: string | null;
  href: string | null;
  className: string | null;
  /** data-testid / data-test / data-cy */
  testId: string | null;
  testIdAttribute: string | null;
  /** label text associated with this element (for inputs) */
  label: string | null;
  /** XPath-like path to the element, as a last-resort selector */
  cssPath: string;
  /** Whether the chosen selector resolved to exactly one element on the page */
  isUnique: boolean;
}

/**
 * The chosen selector for an element, plus alternates and the Playwright locator expression.
 */
export interface SelectorResult {
  /** The CSS-like selector string Playwright can pass to page.locator(...) */
  selector: string;
  /** The full Playwright locator expression (e.g. `page.getByRole('button', { name: 'X' })`) */
  playwrightLocator: string;
  /** Backup selectors, in priority order */
  alternates: string[];
  /** Why this selector was picked (for debugging) */
  strategy:
    | 'test-id'
    | 'role-name'
    | 'label'
    | 'placeholder'
    | 'text'
    | 'id'
    | 'name'
    | 'css-path';
}
