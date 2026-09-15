FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# npm install (inte ci) så vi kan lägga till deps utan att alltid uppdatera lockfile manuellt
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
