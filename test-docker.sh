#!/bin/bash

echo "Building Docker image..."
docker build -t tinypixo-test:v1.2.0 .

echo "Running Docker container..."
docker run -p 3000:3000 tinypixo-test:v1.2.0

echo "Access the app at http://localhost:3000"