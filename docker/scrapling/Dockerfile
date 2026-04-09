FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SCRAPLING_SIDECAR_PORT=8090 \
    SCRAPLING_SIDECAR_HOST=0.0.0.0

WORKDIR /app

RUN pip install --no-cache-dir "scrapling[fetchers]==0.4.5"

COPY scripts/scrapling_sidecar.py /app/scrapling_sidecar.py

EXPOSE 8090

CMD ["python3", "/app/scrapling_sidecar.py"]
