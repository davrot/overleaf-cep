# DataManipulator Implementation Plans

This directory contains detailed implementation plans for the DataManipulator microservice.

## Overview

The DataManipulator service provides reusable file tree operations with:
- Automatic binary detection (using Overleaf's `Settings.textExtensions`)
- Checksum/ETag generation for sync conflict detection
- High-level pull/push operations

## Phases

| Phase | File | Description |
|-------|------|-------------|
| 0 | [phase_0_config_integration.md](phase_0_config_integration.md) | Load Overleaf's text extension config from Settings.textExtensions |
| 1 | [phase_1_core_api.md](phase_1_core_api.md) | Core file operations (list, read, write) with binary detection |
| 2 | [phase_2_compare_merge.md](phase_2_compare_merge.md) | Tree comparison and conflict detection |
| 3 | [phase_3_sync_helpers.md](phase_3_sync_helpers.md) | High-level sync operations (pull, push) |
| 4 | [phase_4_integration_testing.md](phase_4_integration_testing.md) | Integration tests with mock services |

## Dependencies

- **Overleaf Core**: Uses `@overleaf/settings` for text extensions
- **Testing**: Vitest (same as Overleaf web app)
- **Protocol**: HTTP/JSON API

## Running Tests

```bash
yarn test                    # All unit tests
yarn test:watch             # Watch mode
```

## Integration with Overleaf

The service is configured in `services/web/config/settings.defaults.js`:

```javascript
datamanipulator: {
  api_url: process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001',
  enabled: true
}
```

Frontend can access via:
```javascript
const settings = getMeta('ol-ExposedSettings').datamanipulatorApiUrl
```

## Next Steps

1. Start with Phase 0 (config loading) - ensures text extensions are loaded from Overleaf config
2. Implement core API (Phase 1)
3. Add sync operations (Phase 3)
4. Write integration tests (Phase 4)
