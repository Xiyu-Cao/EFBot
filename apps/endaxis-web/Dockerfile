# ---- Development Stage ----
FROM node:22-alpine AS dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Bake in static assets so only src/ needs to be volume-mounted
COPY public ./public
COPY dist ./dist

EXPOSE 1420

CMD ["npm", "run", "dev"]

# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production Stage ----
FROM nginx:alpine AS prod

COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
