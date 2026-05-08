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