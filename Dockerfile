# Multi-stage build for minimal image size
FROM node:24-alpine AS deps
WORKDIR /app

# Install Sharp dependencies
RUN apk add --no-cache \
    vips-dev \
    build-base \
    python3 \
    make \
    g++

COPY package*.json ./
RUN npm ci --only=production && npm rebuild sharp

FROM node:24-alpine AS builder
WORKDIR /app

# Install Sharp dependencies
RUN apk add --no-cache \
    vips-dev \
    build-base \
    python3 \
    make \
    g++

COPY package*.json ./
RUN npm ci && npm rebuild sharp
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app

# Install runtime dependencies including Sharp requirements
RUN apk add --no-cache \
    vips \
    vips-cpp \
    glib \
    expat \
    ffmpeg && \
    echo "FFmpeg installed at: $(which ffmpeg)" && \
    ln -sf $(which ffmpeg) /usr/local/bin/ffmpeg && \
    chmod +x /usr/local/bin/ffmpeg

# Set FFmpeg path as environment variable
ENV FFMPEG_PATH="/usr/local/bin/ffmpeg"
ENV PATH="/usr/local/bin:${PATH}"

# Set Next.js server configuration
ENV NODE_OPTIONS="--max-http-header-size=16384"
ENV NEXT_SHARP_PATH="/app/node_modules/sharp"

# Increase body parser limit for large file uploads
ENV BODY_SIZE_LIMIT="500mb"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "-c", "HOSTNAME=0.0.0.0 PORT=3000 node server.js"]