# ==============================================================
# DOSK BOT — Production Container for Railway
# ==============================================================
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=5000

# Install required system dependencies (ffmpeg for audio, python3, ca-certificates, curl)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       ca-certificates \
       ffmpeg \
       curl \
       git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies cleanly
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

# Copy full application source code
COPY . .

# Ensure runtime directories exist with proper permissions
RUN mkdir -p database/data/addlock .editor-backups logs

# Expose Railway web port
EXPOSE 5000

# Run supervisor watchdog process
CMD ["node", "index.js"]

