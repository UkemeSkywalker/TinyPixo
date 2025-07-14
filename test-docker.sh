#!/bin/bash

echo "Building Docker image..."
docker build -t tinypixo-test .

echo "Running Docker container..."
docker run -p 3000:3000 tinypixo-test

echo "Access the app at http://localhost:3000"