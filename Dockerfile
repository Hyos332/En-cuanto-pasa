FROM node:22-alpine

WORKDIR /app

# Instalar dependencias de sistema necesarias para compilar módulos nativos (como sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Instalar dependencias de Node
RUN npm install

COPY ./ ./

CMD ["node", "app.js"]
