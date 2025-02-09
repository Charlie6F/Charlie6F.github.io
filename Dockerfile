# Use Debian Bookworm as base which has GLIBC 2.36
FROM debian:bookworm-slim

# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install wrangler globally
RUN npm install -g wrangler

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your application
COPY . .
COPY --exclude="node_modules" . .

EXPOSE 8787

# Command to run when starting the container
CMD ["wrangler", "dev", "--local"]
