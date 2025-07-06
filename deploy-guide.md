# TinyPixo AWS Deployment Guide - Cheapest Options

## Option 1: AWS Amplify (Recommended - Cheapest)

### Cost: FREE for small apps
- 1,000 build minutes/month
- 15GB data transfer/month
- Custom domain included

### Steps:
1. Push code to GitHub/GitLab
2. Go to AWS Amplify Console
3. Connect repository
4. Deploy automatically

### Manual Deploy:
```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Configure AWS credentials
amplify configure

# Initialize project
amplify init

# Add hosting
amplify add hosting

# Deploy
amplify publish
```

## Option 2: Vercel (Not AWS but cheapest overall)

```bash
npm install -g vercel
vercel --prod
```

## Option 3: AWS Lambda (Serverless - Pay per use)

```bash
# Install serverless framework
npm install -g serverless

# Install Next.js serverless plugin
npm install @sls-next/serverless-component

# Deploy
serverless deploy
```

## Cost Comparison (Monthly):
- Amplify: $0 (free tier)
- Lambda: $0-5 (low traffic)
- App Runner: $7-15
- ECS Fargate: $15-30
- EC2: $5-20 (requires management)

## Recommendation:
Start with **AWS Amplify** - it's free, handles SSL, CDN, and auto-scaling automatically.