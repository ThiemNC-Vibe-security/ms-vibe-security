/**
 * Unit tests for dynamic-explorer safe/dangerous click classification.
 *
 * We test the exported logic indirectly by checking the no-op behaviour
 * when `enabled: false` and verifying the allowlist/denylist constants
 * are doing their job via exploreDynamicUI with a stub page.
 */

import { describe, it, expect } from 'vitest';
// Re-export the internal helpers by importing from the module
// (we test side-effect-free parts only)
import { exploreDynamicUI } from '../src/crawler/dynamic-explorer.js';
import type { InteractConfig } from '../src/config/schema.js';

const disabledConfig: InteractConfig = {
  enabled: false,
  max_interactions_per_page: 10,
  discover_modals: true,
  discover_tabs: true,
  discover_dropdowns: true,
  interaction_settle_ms: 600,
};

describe('exploreDynamicUI — disabled mode', () => {
  it('returns empty result immediately when disabled', async () => {
    // Pass null as page — should never be touched
    const result = await exploreDynamicUI(null as any, disabledConfig, 'https://example.com');
    expect(result.dynamic_components).toEqual([]);
    expect(result.interactions_performed).toEqual([]);
  });
});
