#!/usr/bin/env bash
# Real parser + synthetic cookie fixtures only; never the owner's browser data.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${1:-}" == "--" ]]; then shift; fi
exec uv run --with pytest --with scrapling==0.4.10 \
  --with-requirements scripts/browser-cookies-requirements.txt pytest tests/sidecar "$@"
