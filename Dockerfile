# Imagen base oficial de Node con Debian (estable y ligera)
FROM node:20-bullseye

# Instalar dependencias necesarias para que Puppeteer (y Chromium) funcionen
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libnss3 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Configurar directorio de trabajo
WORKDIR /app

# Copiar package.json y lock si existe
COPY package*.json ./

# Instalar dependencias (whatsapp-web.js, express, etc.)
RUN npm install

# Copiar el resto del código fuente
COPY . .


# Comando de inicio
CMD ["node", "app.js"]
