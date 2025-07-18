#!/bin/bash

echo "Building Docker image..."
docker build --platform linux/amd64 -t tinypixo-deploy:v1.2.5 .

echo "Running Docker container..."
docker run -p 3000:3000 tinypixo-deploy:v1.2.0

echo "Access the app at http://localhost:3000"