# FASALYTICS API (Express, JavaScript ES modules) - runtime image.
# Dependencies are installed reproducibly from package-lock.json (production dependencies only).
# No .env, credentials or datasets are copied in (see .dockerignore).
FROM node:24.22-slim

ENV NODE_ENV=development \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node src ./src

EXPOSE 4000
CMD ["node", "src/server.js"]