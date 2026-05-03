FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (better for build caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of your app source
COPY . .

# Use the port your app listens on
EXPOSE 8000

# Start the proxy
CMD [ "node", "proxy.js" ]
