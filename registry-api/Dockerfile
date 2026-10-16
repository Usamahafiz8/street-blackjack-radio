FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# No npm dependencies: only Node's standard library is used.
COPY package.json ./
COPY src ./src
COPY art ./art
COPY config ./config

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "src/index.js"]
