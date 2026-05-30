# Stage build: compila los assets de Vite
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage final (opcional): imagen nginx lista con los estáticos.
# En compose se usa target=build y el command copia /app/dist al volumen
# front-dist; nginx lo consume desde ese volumen. Este stage es decorativo
# pero documenta el patrón completo para despliegues directos.
FROM nginx:1.27-alpine AS final

COPY --from=build /app/dist /usr/share/nginx/html
