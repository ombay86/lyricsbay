# Production Dockerfile for LyricsBay
FROM node:24-alpine

WORKDIR /app

# Copy dependency files
COPY package.json ./

# Copy all source files
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Persistent storage for songs, playlists, users data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
