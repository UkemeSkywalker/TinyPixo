#!/bin/bash

# Configuration
FUNCTION_NAME="youtube-downloader"
REGION="us-east-1"
ROLE_ARN="arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role"

echo "Creating and deploying Lambda function..."

# Create temp directory
mkdir -p package

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt -t package/

# Copy Lambda function
cp lambda_function.py package/

# Create zip file
echo "Creating deployment package..."
cd package
zip -r ../youtube-downloader-lambda.zip .
cd ..

# Clean up temp directory
rm -rf package

# Deploy to AWS Lambda
echo "Deploying to AWS Lambda..."

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
    echo "Updating existing function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://youtube-downloader-lambda.zip \
        --region $REGION
else
    echo "Creating new function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime python3.9 \
        --role $ROLE_ARN \
        --handler lambda_function.lambda_handler \
        --zip-file fileb://youtube-downloader-lambda.zip \
        --timeout 300 \
        --memory-size 1024 \
        --region $REGION
fi

# Create API Gateway (optional)
echo "Creating API Gateway..."
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id api-gateway-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --region $REGION 2>/dev/null || echo "Permission already exists"

echo "Deployment complete!"
echo "Function ARN: $(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)"
echo ""
echo "Next steps:"
echo "1. Update ROLE_ARN in this script with your actual IAM role"
echo "2. Create API Gateway to expose HTTP endpoints"
echo "3. Update frontend with the API Gateway URL"