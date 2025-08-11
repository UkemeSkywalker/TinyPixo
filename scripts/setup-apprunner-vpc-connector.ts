#!/usr/bin/env tsx

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
    AppRunnerClient,
    CreateVpcConnectorCommand,
    DescribeVpcConnectorCommand,
    ListVpcConnectorsCommand
} from '@aws-sdk/client-apprunner'
import {
    EC2Client,
    DescribeVpcsCommand,
    DescribeSubnetsCommand,
    DescribeSecurityGroupsCommand,
    CreateSecurityGroupCommand,
    AuthorizeSecurityGroupIngressCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const VPC_CONNECTOR_NAME = 'audio-conversion-vpc-connector'

const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })

async function getDefaultVpc() {
    console.log('🔍 Finding default VPC...')
    const result = await ec2Client.send(new DescribeVpcsCommand({
        Filters: [{ Name: 'is-default', Values: ['true'] }]
    }))
    
    if (!result.Vpcs || result.Vpcs.length === 0) {
        throw new Error('No default VPC found')
    }
    
    const vpc = result.Vpcs[0]
    console.log(`✅ Found default VPC: ${vpc.VpcId}`)
    return vpc
}

async function getPrivateSubnets(vpcId: string) {
    console.log('🔍 Finding private subnets...')
    const result = await ec2Client.send(new DescribeSubnetsCommand({
        Filters: [
            { Name: 'vpc-id', Values: [vpcId] },
            { Name: 'state', Values: ['available'] }
        ]
    }))
    
    if (!result.Subnets || result.Subnets.length === 0) {
        throw new Error('No subnets found in VPC')
    }
    
    // For simplicity, use all available subnets
    const subnets = result.Subnets.slice(0, 2) // App Runner needs at least 2 subnets
    console.log(`✅ Found ${subnets.length} subnets:`)
    subnets.forEach(subnet => {
        console.log(`   - ${subnet.SubnetId} (${subnet.AvailabilityZone})`)
    })
    
    return subnets
}

async function createOrGetSecurityGroup(vpcId: string) {
    console.log('🔍 Checking for existing security group...')
    
    const sgName = 'apprunner-redis-access'
    
    try {
        const result = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [
                { Name: 'group-name', Values: [sgName] },
                { Name: 'vpc-id', Values: [vpcId] }
            ]
        }))
        
        if (result.SecurityGroups && result.SecurityGroups.length > 0) {
            const sg = result.SecurityGroups[0]
            console.log(`✅ Found existing security group: ${sg.GroupId}`)
            return sg
        }
    } catch (error) {
        // Security group doesn't exist, create it
    }
    
    console.log('🔧 Creating security group...')
    const createResult = await ec2Client.send(new CreateSecurityGroupCommand({
        GroupName: sgName,
        Description: 'Allow App Runner to access Redis ElastiCache',
        VpcId: vpcId
    }))
    
    const sgId = createResult.GroupId!
    console.log(`✅ Created security group: ${sgId}`)
    
    // Add rule to allow Redis access (port 6379)
    console.log('🔧 Adding Redis access rule...')
    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: [{
            IpProtocol: 'tcp',
            FromPort: 6379,
            ToPort: 6379,
            IpRanges: [{ CidrIp: '10.0.0.0/8', Description: 'Redis access from VPC' }]
        }]
    }))
    
    return { GroupId: sgId }
}

async function createVpcConnector() {
    console.log('🔧 Creating VPC Connector...')
    
    const vpc = await getDefaultVpc()
    const subnets = await getPrivateSubnets(vpc.VpcId!)
    const securityGroup = await createOrGetSecurityGroup(vpc.VpcId!)
    
    try {
        const result = await appRunnerClient.send(new CreateVpcConnectorCommand({
            VpcConnectorName: VPC_CONNECTOR_NAME,
            Subnets: subnets.map(s => s.SubnetId!),
            SecurityGroups: [securityGroup.GroupId!]
        }))
        
        console.log(`✅ VPC Connector created: ${result.VpcConnector?.VpcConnectorArn}`)
        console.log(`   Status: ${result.VpcConnector?.Status}`)
        
        return result.VpcConnector
    } catch (error: any) {
        if (error.name === 'InvalidRequestException' && error.message.includes('already exists')) {
            console.log('✅ VPC Connector already exists')
            return await getExistingVpcConnector()
        }
        throw error
    }
}

async function getExistingVpcConnector() {
    const result = await appRunnerClient.send(new ListVpcConnectorsCommand({}))
    const connector = result.VpcConnectors?.find(c => c.VpcConnectorName === VPC_CONNECTOR_NAME)
    
    if (connector) {
        const details = await appRunnerClient.send(new DescribeVpcConnectorCommand({
            VpcConnectorArn: connector.VpcConnectorArn
        }))
        return details.VpcConnector
    }
    
    return null
}

async function main() {
    console.log('🚀 Setting up App Runner VPC Connector for Redis access...')
    console.log(`Region: ${AWS_REGION}`)
    
    try {
        const connector = await createVpcConnector()
        
        console.log('\n📋 Next Steps:')
        console.log('1. Wait for VPC Connector to become ACTIVE (this may take 5-10 minutes)')
        console.log('2. Update your App Runner service configuration to use this VPC Connector')
        console.log('3. Add the VPC Connector ARN to your apprunner.yaml:')
        console.log(`   VpcConnectorArn: ${connector?.VpcConnectorArn}`)
        console.log('4. Redeploy your App Runner service')
        console.log('5. Update your ElastiCache security group to allow connections from the App Runner security group')
        
    } catch (error: any) {
        console.error('💥 Error setting up VPC Connector:', error.message)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}