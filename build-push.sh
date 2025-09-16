#!/bin/bash
set -e  # Exit on any error

# Check if version argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <version> [push]"
    echo "Example: $0 v1.2.7        # Build only"
    echo "Example: $0 v1.2.7 push   # Build and push"
    exit 1
fi

VERSION=$1
PUSH_FLAG=$2
REPO_NAME="tinypixo"
REGION="us-east-1"  # Change to your preferred region

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "Error: Docker is not running. Please start Docker first."
    exit 1
fi

echo "Building Docker image for version $VERSION..."
docker build --platform linux/amd64 -t $REPO_NAME:$VERSION . || {
    echo "Error: Docker build failed."
    exit 1
}

echo "Successfully built $REPO_NAME:$VERSION"

# Only push if 'push' argument is provided
if [ "$PUSH_FLAG" = "push" ]; then
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        echo "Error: AWS CLI is not installed. Please install it first."
        exit 1
    fi

    # Get AWS account ID with error handling
    echo "Getting AWS account ID..."
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
        echo "Error: Failed to get AWS account ID. Please check your AWS credentials."
        exit 1
    }

    ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME"

    # Check if ECR repository exists
    echo "Checking if ECR repository exists..."
    if ! aws ecr describe-repositories --repository-names $REPO_NAME --region $REGION &> /dev/null; then
        echo "ECR repository '$REPO_NAME' not found. Creating it..."
        aws ecr create-repository --repository-name $REPO_NAME --region $REGION || {
            echo "Error: Failed to create ECR repository."
            exit 1
        }
    fi

    echo "Logging into AWS ECR..."
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI || {
        echo "Error: ECR login failed."
        exit 1
    }

    echo "Tagging image for ECR..."
    docker tag $REPO_NAME:$VERSION $ECR_URI:$VERSION || {
        echo "Error: Failed to tag image."
        exit 1
    }

    echo "Pushing to ECR..."
    docker push $ECR_URI:$VERSION || {
        echo "Error: Failed to push image."
        exit 1
    }

    echo "Successfully pushed $REPO_NAME:$VERSION to ECR"
    echo "ECR URI: $ECR_URI:$VERSION"
fi