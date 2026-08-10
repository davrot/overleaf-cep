# DataManipulator Microservice

A reusable microservice for file tree operations with binary detection and sync-ready metadata.

## Status

**Planned - Not Yet Implemented**

This service is being designed to provide:
1. Dynamic text extension detection (using Overleaf's Settings.textExtensions)
2. Binary vs text file detection
3. Checksum/ETag generation for conflict detection
4. High-level pull/push sync operations

## Documentation

- **Main Plan**: [plan_datamanipulator.md](./plan_datamanipulator.md) - Overview and design decisions
- **Implementation Plans**:
  - Phase 0: [Configuration Integration](./plans/phase_0_config_integration.md)
  - Phase 1: [Core API](./plans/phase_1_core_api.md)
  - Phase 2: [Compare/Merge](./plans/phase_2_compare_merge.md)
  - Phase 3: [Sync Helpers](./plans/phase_3_sync_helpers.md)
  - Phase 4: [Integration Tests](./plans/phase_4_integration_testing.md)

## Development

### Running Tests
```bash
yarn test          # Run all unit tests
yarn test:watch    # Watch mode
```

### Integration with Overleaf

Configure in `services/web/config/settings.defaults.js`:
```javascript
datamanipulator: {
  api_url: process.env.DATAMANIPULATOR_API_URL || 'http://localhost:4001'
}
```

## References

- Original WebDAV module: `/services/web/modules/webdav/`
- GitHub Sync module: `/services/web/modules/github-sync/`
