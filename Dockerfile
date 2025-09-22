FROM node:22-alpine

WORKDIR /app

COPY ./ ./

RUN npm install axios @slack/bolt dotenv && \
    npm install

CMD ["node", "app.js"]
