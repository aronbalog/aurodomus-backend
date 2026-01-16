# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the Nest.js project
RUN npm run build

# Stage 2: Run
FROM node:20-alpine

WORKDIR /app

# Copy package files and install only prod dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy build output from builder
COPY --from=builder /app/dist ./dist

# Expose Nest.js default port
EXPOSE 3001

# Start the app
CMD ["node", "dist/main"]
