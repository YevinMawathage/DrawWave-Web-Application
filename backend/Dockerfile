FROM node:18-alpine

WORKDIR /app


COPY package*.json ./


RUN npm install


COPY . .
COPY .env /app/.env

EXPOSE 5000

CMD ["npm", "start"]
