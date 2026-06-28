/**
 * Evaluation Metrics Builder (Phase 7)
 *
 * Computes evaluation_metrics from the completed discovery output.
 * Pure function — no side effects, no I/O.
 *
 * Notes:
 *   - selector_success_rate is derived from Phase 2 verification data.
 *     If Phase 2 was not active (all selector_verified = false), the rate
 *     is reported as 0.0 rather than null so consumers can always treat it
 *     as a number.
 *   - attack_surface_count = sum of all surfaces across the five categories
 *     in the attack_surface_model (Phase 4).
 *   - dynamic_components_discovered counts components from Phase 6;
 *     always 0 when interact.enabled = false.
 */

import type { DiscoveredPage, DiscoveryError, EvaluationMetrics } from './schema.js';
import type { CapturedEndpoint } from '../probe/network-monitor.js';
import type { AttackSurfaceModel } from './model-builder.js';

export interface MetricsInput {
  pages: DiscoveredPage[];
  errors: DiscoveryError[];
  endpoints: CapturedEndpoint[];
  attackSurfaceModel: AttackSurfaceModel;
}

/**
 * Build EvaluationMetrics from already-computed discovery data.
 * All counts are derived from the final output — nothing is re-computed
 * from scratch.
 */
export function buildEvaluationMetrics(input: MetricsInput): EvaluationMetrics {
  const { pages, errors, endpoints, attackSurfaceModel } = input;

  // ── Basic counts ──────────────────────────────────────────────────
  const formsDiscovered = pages.reduce((s, p) => s + p.forms.length, 0);

  const standaloneInputs = pages.reduce((s, p) => s + p.inputs.length, 0);
  const formInputs = pages.reduce(
    (s, p) => s + p.forms.reduce((sf, f) => sf + f.inputs.length, 0),
    0,
  );
  const inputsDiscovered = standaloneInputs + formInputs;

  const buttonsDiscovered = pages.reduce((s, p) => s + p.buttons.length, 0);
  const linksDiscovered = pages.reduce((s, p) => s + p.links.length, 0);

  // ── Security components ───────────────────────────────────────────
  const securityComponentsDetected = pages.reduce(
    (s, p) => s + p.security_components.length,
    0,
  );

  // ── Attack surface ────────────────────────────────────────────────
  const attackSurfaceCount =
    attackSurfaceModel.auth_surfaces.length +
    attackSurfaceModel.data_input_surfaces.length +
    attackSurfaceModel.file_upload_surfaces.length +
    attackSurfaceModel.admin_surfaces.length +
    attackSurfaceModel.api_surfaces.length;

  // ── Dynamic components (Phase 6) ─────────────────────────────────
  const dynamicComponentsDiscovered = pages.reduce(
    (s, p) => s + (p.dynamic_components?.length ?? 0),
    0,
  );

  // ── Selector verification (Phase 2) ──────────────────────────────
  // Collect all SelectorBundle objects: form, form inputs, standalone inputs,
  // buttons, links.
  type BundleMinimal = { selector_verified: boolean };

  const allBundles: BundleMinimal[] = [];
  for (const page of pages) {
    for (const form of page.forms) {
      allBundles.push(form);
      for (const input of form.inputs) {
        allBundles.push(input);
      }
    }
    for (const input of page.inputs) {
      allBundles.push(input);
    }
    for (const button of page.buttons) {
      allBundles.push(button);
    }
    for (const link of page.links) {
      allBundles.push(link);
    }
  }

  const selectorsTotal = allBundles.length;
  const selectorsVerified = allBundles.filter((b) => b.selector_verified).length;

  const selectorSuccessRate =
    selectorsTotal === 0
      ? null
      : Number((selectorsVerified / selectorsTotal).toFixed(4));

  return {
    pages_discovered: pages.length,
    crawl_errors: errors.length,
    forms_discovered: formsDiscovered,
    inputs_discovered: inputsDiscovered,
    buttons_discovered: buttonsDiscovered,
    links_discovered: linksDiscovered,
    endpoints_discovered: endpoints.length,
    selectors_total: selectorsTotal,
    selectors_verified: selectorsVerified,
    selector_success_rate: selectorSuccessRate,
    security_components_detected: securityComponentsDetected,
    attack_surface_count: attackSurfaceCount,
    dynamic_components_discovered: dynamicComponentsDiscovered,
  };
}
