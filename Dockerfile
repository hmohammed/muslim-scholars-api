FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages

RUN npm ci --omit=dev

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
