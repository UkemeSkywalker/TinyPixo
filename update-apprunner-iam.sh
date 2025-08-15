# Step 1: Get the current policy ARN
aws iam list-attached-role-policies --role-name AudioConversionAppRunnerRole

# Step 2: Create new policy version (replace POLICY_ARN with actual ARN)
aws iam create-policy-version \
  --policy-arn POLICY_ARN \
  --policy-document file://apprunner-iam-policy.json \
  --set-as-default

# Alternative: If you need to create a new policy
aws iam create-policy \
  --policy-name AudioConversionAppRunnerPolicy \
  --policy-document file://apprunner-iam-policy.json

# Then attach it to the role
aws iam attach-role-policy \
  --role-name AudioConversionAppRunnerRole \
  --policy-arn arn:aws:iam::910883278292:policy/AudioConversionAppRunnerPolicy