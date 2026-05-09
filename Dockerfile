# --- Stage 1: Build ---
FROM node:20-slim AS builder
WORKDIR /app

# Copy package files and install ALL dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build the Vite frontend
COPY . .
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-slim AS runner
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Install dependencies needed to add the Docker repo
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources
RUN echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null


# Update the package list and install git
RUN apt-get update && \
    apt-get install -y git docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install ONLY production dependencies to keep the image small
RUN npm install -g @devcontainers/cli

COPY package*.json ./
RUN npm ci --only=production

# Copy the built frontend from the builder stage
COPY --from=builder /app/dist ./dist

# Copy your Express server code
COPY src/server ./src/server

EXPOSE 8000

# Start the server directly
CMD ["node", "src/server/main.js"]