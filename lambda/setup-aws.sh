#!/bin/bash

# Setup script for AWS resources needed for YouTube downloader

echo "Setting up AWS resources for YouTube downloader..."

# Create IAM role for Lambda
echo "Creating IAM role..."
aws iam create-role \
    --role-name lambda-youtube-downloader-role \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "lambda.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }'

# Attach basic Lambda execution policy
aws iam attach-role-policy \
    --role-name lambda-youtube-downloader-role \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Wait for role to be ready
echo "Waiting for IAM role to be ready..."
sleep 10

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "Setup complete!"
echo "Your IAM Role ARN: arn:aws:iam::$ACCOUNT_ID:role/lambda-youtube-downloader-role"
echo ""
echo "Update deploy.sh with this role ARN, then run ./deploy.sh"