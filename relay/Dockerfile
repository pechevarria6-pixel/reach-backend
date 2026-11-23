# Build from the repository root:  fly deploy --config relay/fly.toml --dockerfile relay/Dockerfile
# Only the agent's own files are copied: no app code, no database client, no Twilio keys.
FROM node:22-slim
WORKDIR /app
COPY relay/package.json relay/package.json
RUN cd relay && npm install --omit=dev --no-audit --no-fund
COPY lib/reservations/script.ts lib/reservations/outcome.ts lib/reservations/providers.ts lib/reservations/gate.ts lib/reservations/
COPY lib/reservations/agent/ lib/reservations/agent/
COPY relay/server.ts relay/server.ts
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
WORKDIR /app/relay
CMD ["node", "--experimental-strip-types", "server.ts"]
