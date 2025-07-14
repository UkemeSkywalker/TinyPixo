# Multi-stage build for minimal image size
FROM node:24-alpine AS deps
WORKDIR /app
# Install Sharp dependencies
RUN apk add --no-cache libc6-compat vips-dev
COPY package*.json ./
RUN npm ci --only=production

FROM node:24-alpine AS builder
WORKDIR /app
# Install Sharp dependencies
RUN apk add --no-cache libc6-compat vips-dev python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app

# Install FFmpeg for audio/video processing
RUN apk add --no-cache ffmpeg

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]