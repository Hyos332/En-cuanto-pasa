FROM node:22-alpine

WORKDIR /app

# Instalar dependencias de sistema:
# - python3, make, g++: Para compilar sqlite3
# - chromium, nss, freetype, etc: Para que Puppeteer funcione en Alpine
RUN apk add --no-cache \
    python3 make g++ \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Decirle a Puppeteer que NO descargue Chrome (usaremos el del sistema)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./

# Instalar dependencias de Node
RUN npm install

COPY ./ ./

CMD ["node", "app.js"]
