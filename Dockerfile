# syntax=docker/dockerfile:1
FROM apify/actor-node:18

# Copy dependency manifests first (layer caching)
COPY package.json package-lock.json* ./

# Install ALL dependencies (devDeps needed for TypeScript compilation)
RUN npm --quiet set progress=false \
    && npm install --include=dev \
    && echo "Node.js $(node --version) | NPM $(npm --version)"

# Copy source code + configs
COPY . ./

# Compile TypeScript to dist/ and verify the entrypoint exists
RUN npm run build \
    && test -f dist/index.js \
    || (echo "FATAL: dist/index.js not generated" && exit 1)

# Prune devDependencies to shrink the final image
RUN npm prune --omit=dev

# Exec-form CMD: bypass npm lifecycle hooks, better signal handling.
# Dockerfile is the single source of truth for the container entrypoint.
CMD ["node", "dist/index.js"]
