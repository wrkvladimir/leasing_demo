# Changelog v2 hotfix

- Added `leasing.check_subject_policy`.
- Added fallback response for `leasing.get_subjects` when calculator API/token is unavailable.
- Converted several calculator failures from MCP-level `isError` into structured tool results.
- Added masked env diagnostics to `/health`.
- Treats placeholder env values as missing.
