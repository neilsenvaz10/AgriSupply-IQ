# FASALYTICS web (React + Vite, JavaScript) - development image.
# Dependencies are installed reproducibly from package-lock.json. No .env, credentials or
# datasets are copied in (see .dockerignore); configuration arrives through the environment.
FROM node:24.22-slim

ENV NODE_ENV=development \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .

EXPOSE 5173
# Vite must bind 0.0.0.0 inside the container so the published port can reach it.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]