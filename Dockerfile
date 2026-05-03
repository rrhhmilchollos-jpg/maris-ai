FROM node:20

WORKDIR /app

# Copiamos los archivos de configuración
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Instalamos pnpm y las dependencias
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile

# Copiamos todo el código
COPY . .

# Compilamos el proyecto (ajusta si el comando es distinto)
RUN pnpm run build

# Exponemos el puerto que usa Hugging Face
EXPOSE 7860

# Comando para arrancar el servidor
# Asegúrate de que este comando apunta a tu archivo de inicio real
CMD ["pnpm", "start"]
