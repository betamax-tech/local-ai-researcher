#!/bin/bash
# Entrypoint for the scrapling sidecar container.
#
# Docker overlay2 corrupts large files during build on this host.
# This script:
#   1. Downloads Node.js 20 LTS from nodejs.org (bypassing overlay corruption)
#   2. Replaces playwright/patchright's broken bundled Node v24 with it
#   3. Installs Chromium browsers via `playwright install`
#   4. Starts the sidecar
#
# All of the above runs only on first container start (marker file check).

set -e

MARKER="/app/.node-fixed"
NODE_VERSION="${NODE_VERSION:-20.11.1}"

if [ ! -f "$MARKER" ]; then
    echo "[entrypoint] First-time setup..."

    # Fix curl_cffi (Docker overlay2 corrupts .so files during build)
    echo "[entrypoint] Reinstalling curl_cffi to fix corrupted .so..."
    pip install --no-cache-dir --force-reinstall curl_cffi 2>&1 | tail -3

    # Download and extract Node.js (avoids Docker overlay2 large-file corruption)
    echo "[entrypoint] Downloading Node.js v${NODE_VERSION}..."
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
        | tar -xJ -C /usr/local --strip-components=1

    echo "[entrypoint] Node.js $(node --version) installed."

    # Replace playwright and patchright's broken bundled Node binaries
    for PKG in playwright patchright; do
        DRV_NODE=$(python3 -c "
from ${PKG}._impl._driver import compute_driver_executable
print(compute_driver_executable()[0])
" 2>/dev/null || true)

        if [ -n "$DRV_NODE" ] && [ -L "$DRV_NODE" -o -f "$DRV_NODE" ]; then
            echo "[entrypoint] Replacing ${PKG} node: $DRV_NODE"
            rm -f "$DRV_NODE"
            cat /usr/local/bin/node > "$DRV_NODE"
            chmod +x "$DRV_NODE"
            echo "[entrypoint] ${PKG} node replaced OK ($(node --version))"
        fi
    done

    # Install Chromium browsers
    echo "[entrypoint] Installing Chromium browsers..."
    python3 -m playwright install chromium 2>&1 | tail -3
    echo "[entrypoint] Chromium installed."

    touch "$MARKER"
    echo "[entrypoint] First-time setup complete."
fi

# Start the sidecar
exec python3 /app/scrapling_sidecar.py