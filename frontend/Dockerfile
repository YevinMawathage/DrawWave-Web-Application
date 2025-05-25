FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* pnpm-lock.yaml* ./


RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && \
      pnpm install; \
    else \
      npm install; \
    fi

COPY . .

RUN npm run build

FROM nginx:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

<<<<<<< Updated upstream
# Expose port 80
EXPOSE 80
=======
EXPOSE 81
>>>>>>> Stashed changes

CMD ["nginx", "-g", "daemon off;"]
