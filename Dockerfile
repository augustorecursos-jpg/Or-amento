# Imagem para rodar em qualquer servidor/nuvem com Docker.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "--no-warnings", "server.js"]
