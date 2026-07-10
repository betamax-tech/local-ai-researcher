# ---- Scrapling sidecar ----
# Docker overlay2 corrupts large binaries during build on this host.
# Workaround: install all deps at build time, download Node.js + browsers
# at runtime via the entrypoint script.
#
# The entrypoint replaces playwright's broken bundled Node v24 with
# Node 20 LTS (freshly downloaded), installs Chromium, then starts the sidecar.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SCRAPLING_SIDECAR_PORT=8090 \
    SCRAPLING_SIDECAR_HOST=0.0.0.0 \
    NODE_VERSION=20.11.1

WORKDIR /app

# System deps for Chromium headless + curl for runtime Node download
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        curl xz-utils \
        libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
        libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
        libxshmfence1 libxfixes3 libx11-6 libx11-xcb1 libxcb1 && \
    rm -rf /var/lib/apt/lists/*

# Install scrapling with fetchers (playwright + patchright)
# Browsers are NOT installed here — the bundled Node v24 is broken,
# so we can't run `playwright install` at build time.
# The entrypoint will fix the Node binary and install browsers at first run.
RUN pip install --no-cache-dir "scrapling[fetchers]>=0.4.6"

# Verify Python imports work (no browser needed for this check)
RUN python3 -c "from scrapling.fetchers import Fetcher, DynamicFetcher; print('Scrapling imports OK')"

COPY docker/scrapling/entrypoint.sh /app/entrypoint.sh
COPY scripts/scrapling_sidecar.py /app/scrapling_sidecar.py

RUN chmod +x /app/entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["/app/entrypoint.sh"]