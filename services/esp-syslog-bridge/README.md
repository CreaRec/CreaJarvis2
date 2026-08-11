# ESP syslog → OTLP bridge

Listens for ESPHome syslog over UDP and exports OTLP logs to Alloy via `@crearec/otel`.

- Resource: `service.name=crea-jarvis-client`, `service.namespace=apps`
- Default port: `1514/udp`
- Log attrs: `component=esp`, `host_name`, `esp_tag`

## Local

```sh
cd services/esp-syslog-bridge
export NODE_AUTH_TOKEN=...   # GitHub Packages read for @crearec/otel
npm ci
npm test
npm run build
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start
```

Production image: `ghcr.io/crearec/crea-jarvis2-esp-syslog` (see `docs/docker.md`).
