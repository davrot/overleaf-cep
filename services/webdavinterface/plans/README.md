# WebDAV Interface Microservice Plans

This directory contains detailed implementation plans for the WebDAV Interface microservice.

## Overview

The WebDAVInterface service provides HTTP-level WebDAV protocol abstractions as the counterpart to `services/datamanipulator`. It handles authentication, request/response formatting, error parsing, and retry logic.

## Phases

| Phase | File | Description |
|-------|------|-------------|
| 0 | [phase_0_http_client.md](phase_0_http_client.md) | Core HTTP client with authenticate, GET/PUT/POST/DELETE/MKCOL |
| 1 | [phase_1_list_download.md](phase_1_list_download.md) | Directory listing, ETag extraction, file download |
| 2 | [phase_2_upload_concurrency.md](phase_2_upload_concurrency.md) | Upload with `If-Match` precondition and ConflictError handling |
| 3 | [phase_3_advanced_features.md](phase_3_advanced_features.md) | Move/rename, streaming large files, retry logic |
| 4 | [phase_4_integration_testing.md](phase_4_integration_testing.md) | Integration tests with mock WebDAV server |

## Dependencies

- **webdav npm package**: Version 6.x (same as services/web)
- **Test framework**: Vitest (Same as Overleaf web app)

## Running Tests

```bash
yarn test          # All unit tests
yarn test:watch    # Watch mode
```
