# Phase 0: Configuration Integration Implementation Plan

## Overview
Implement dynamic loading of Overleaf's `defaultTextExtensions` from `services/web/config/settings.defaults.js`. This ensures the DataManipulator service stays in sync with Overleaf's text file classification without hardcoding.

## Files to Create/Modify

### 1. `/services/datamanipulator/app/src/textExtensions.mjs` (NEW)
Primary module for text extension handling.

#### Functions to Export:
```javascript
// Get cached text extensions from Settings at startup
export function getTextExtensions(): Set<string>

// Check if a filepath uses a text extension
export function isTextExtension(filepath: string): boolean

// Validate all extensions in Settings are strings (startup check)
export function validateSettings(): void
```

#### Implementation Details:
- Load `Settings.textExtensions` on module import
- Normalize to lowercase set for O(1) lookups
- Add startup validation that logs warnings if config is missing/invalid

### 2. `/services/datamanipulator/test/unit/textExtensionDetection.test.js` (NEW)
Unit tests for text extension handling.

#### Test Cases:
1. **Settings_loaded_at_startup**: Verify Settings.textExtensions is non-empty on import
2. **extension_lookup**: Each Overleaf default extension returns `true`
3. **binary_fallback_unknown_ext**: Extensions not in list return `false`
4. **case_insensitive**: "TEX", "tex", and "Tex" all treated as text

### 3. `/services/web/config/settings.defaults.js` (MODIFIED)
Add DataManipulator microservice configuration:

```javascript
// After the existing modules configuration:
datamanipulator: {
  api_url: process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001',
  enabled: process.env.DATAMANIPULATOR_ENABLED !== 'false' // Default to true
}

// Also add to overleafModuleExports (if needed for frontend consumption)
```

## Integration Points

### 1. Service Startup (`/services/datamanipulator/app/src/server.mjs`)
```javascript
import { getTextExtensions } from './textExtensions.mjs'

// At startup, log loaded extensions for debugging
const textExts = getTextExtensions()
logger.info({ count: textExts.size }, 'Loaded text extensions')
```

### 2. Overleaf Web App (`services/web/config/settings.defaults.js`)
- Add `datamanipulator.api_url` to settings
- Frontend can read via `getMeta('ol-ExposedSettings').datamanipulatorApiUrl`
- Use this URL for all API calls from sync modules

## Testing Strategy

### Unit Test (Vitest)
```javascript
import { describe, expect, it } from 'vitest'
import Settings from '@overleaf/settings'

describe('textExtensions', () => {
  it('loads text extensions at startup', async () => {
    const textExts = await import('./textExtensions.mjs')
    const extensions = textExts.getTextExtensions()
    expect(extensions).toBeInstanceOf(Set)
    expect(extensions.size).toBeGreaterThan(0)
  })

  it('tex extension is detected as text', async () => {
    const { isTextExtension } = await import('./textExtensions.mjs')
    expect(isTextExtension('main.tex')).toBe(true)
    expect(isTextExtension('file.TEX')).toBe(true) // case insensitive
  })

  it('pdf extension is NOT a text file', async () => {
    const { isTextExtension } = await import('./textExtensions.mjs')
    expect(isTextExtension('diagram.pdf')).toBe(false)
  })
})
```

### Integration Test (CI/CD)
1. Start Overleaf with modified `defaultTextExtensions`
2. Verify DataManipulator service reads the updated list
3. Make API calls to verify text file handling matches new config

## Acceptance Criteria

- [ ] `Settings.textExtensions` is loaded on module import
- [ ] Text extension lookup works for all Overleaf defaults
- [ ] Unknown extensions are treated as binary
- [ ] Case-insensitive extension matching
- [ ] Unit tests pass with 100% coverage for textExtensions module
- [ ] Service logs loaded extension count at startup

## Rollback Plan

If Settings.textExtensions loading fails:
1. Log warning to Sentry
2. Fall back to a minimal default set: `['tex', 'latex', 'sty', 'cls']`
3. Continue operation with reduced accuracy (some text files may be treated as binary)
