FROM node:26.7.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY server ./server
COPY public ./public
RUN npm run build:site

FROM caddy:2.11.4-alpine
COPY --from=build /app/dist-site /srv
CMD ["sh", "-c", "exec caddy file-server --root /srv --listen :${PORT:-8080}"]
