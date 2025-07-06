#!/bin/bash

FUNCTION_NAME="youtube-downloader"
REGION="us-east-1"
API_NAME="youtube-downloader-api"

echo "Creating API Gateway for Lambda function..."

# Create REST API
API_ID=$(aws apigateway create-rest-api \
    --name $API_NAME \
    --description "YouTube Downloader API" \
    --region $REGION \
    --query 'id' \
    --output text)

echo "Created API: $API_ID"

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id $API_ID \
    --region $REGION \
    --query 'items[0].id' \
    --output text)

# Create resource for video-info
INFO_RESOURCE_ID=$(aws apigateway create-resource \
    --rest-api-id $API_ID \
    --parent-id $ROOT_ID \
    --path-part "video-info" \
    --region $REGION \
    --query 'id' \
    --output text)

# Create resource for download
DOWNLOAD_RESOURCE_ID=$(aws apigateway create-resource \
    --rest-api-id $API_ID \
    --parent-id $ROOT_ID \
    --path-part "download" \
    --region $REGION \
    --query 'id' \
    --output text)

# Create POST method for video-info
aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $INFO_RESOURCE_ID \
    --http-method POST \
    --authorization-type NONE \
    --region $REGION

# Create POST method for download
aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $DOWNLOAD_RESOURCE_ID \
    --http-method POST \
    --authorization-type NONE \
    --region $REGION

# Get Lambda function ARN
LAMBDA_ARN="arn:aws:lambda:$REGION:910883278292:function:$FUNCTION_NAME"

# Set up integration for video-info
aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $INFO_RESOURCE_ID \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region $REGION

# Set up integration for download
aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $DOWNLOAD_RESOURCE_ID \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region $REGION

# Deploy API
aws apigateway create-deployment \
    --rest-api-id $API_ID \
    --stage-name prod \
    --region $REGION

echo "API Gateway created successfully!"
echo "API URL: https://$API_ID.execute-api.$REGION.amazonaws.com/prod"
echo ""
echo "Endpoints:"
echo "- Video Info: https://$API_ID.execute-api.$REGION.amazonaws.com/prod/video-info"
echo "- Download: https://$API_ID.execute-api.$REGION.amazonaws.com/prod/download"