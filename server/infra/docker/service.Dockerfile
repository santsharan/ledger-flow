# Build image for any LedgerFlow service.
#   docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=payment-service .
#
# Production images run as non-root on a minimal base and contain no build tooling
# (specification §69).

ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG SERVICE
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build
# Produces a self-contained directory with production dependencies only.
RUN pnpm --filter "@ledgerflow/${SERVICE}" deploy --prod --legacy /app/out

FROM node:${NODE_VERSION}-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
WORKDIR /app

# `node` (uid 1000) ships with the base image; no root-owned writable paths are created.
COPY --from=build --chown=node:node /app/out /app
USER node

EXPOSE 3000
# Node receives SIGTERM directly so the graceful shutdown sequence runs (failure-model.md §6).
CMD ["node", "dist/main.js"]
