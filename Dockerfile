# 성격 탐험 — Docker 이미지
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit --loglevel=error
COPY index.html style.css app.js ai.js data.js server.js ./
COPY vendor ./vendor
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
