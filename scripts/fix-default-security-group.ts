#!/usr/bin/env tsx

/**
 * Fix default security group to allow Redis access
 */

import { 
    EC2Client, 
    DescribeSecurityGroupsCommand,
    AuthorizeSecurityGroupIngressCommand,
    DescribeVpcsCommand
} from '@aws-sdk/client-ec2'

const AWS_REGION = 'us-east-1'
const ec2Client = new EC2Client({ region: AWS_REGION })

async function fixDefaultSecurityGroups() {
    console.log('🔧 Fixing default security groups for Redis access...')
    
    try {
        // Get all VPCs
        const vpcs = await ec2Client.send(new DescribeVpcsCommand({}))
        
        console.log('\n🌐 Found VPCs:')
        for (const vpc of vpcs.Vpcs || []) {
            console.log(`   ${vpc.VpcId} (Default: ${vpc.IsDefault})`)
        }
        
        // Get all default security groups
        const defaultSGs = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [
                { Name: 'group-name', Values: ['default'] }
            ]
        }))
        
        console.log('\n🔒 Processing default security groups:')
        
        for (const sg of defaultSGs.SecurityGroups || []) {
            console.log(`\n   Security Group: ${sg.GroupId}`)
            console.log(`   VPC: ${sg.VpcId}`)
            console.log(`   Description: ${sg.Description}`)
            
            // Check if Redis rule already exists
            let hasRedisRule = false
            for (const rule of sg.IpPermissions || []) {
                if (rule.FromPort === 6379 && rule.ToPort === 6379) {
                    hasRedisRule = true
                    const sources = [
                        ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                        ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                    ]
                    console.log(`   ✅ Existing Redis rule: ${sources.join(', ')}`)
                    break
                }
            }
            
            if (!hasRedisRule) {
                console.log('   ❌ No Redis rule found')
                console.log('   🔧 Adding Redis access rule...')
                
                try {
                    await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
                        GroupId: sg.GroupId,
                        IpPermissions: [{
                            IpProtocol: 'tcp',
                            FromPort: 6379,
                            ToPort: 6379,
                            IpRanges: [{
                                CidrIp: '0.0.0.0/0',
                                Description: 'Redis access for App Runner'
                            }]
                        }]
                    }))
                    
                    console.log('   ✅ Added Redis access rule (0.0.0.0/0:6379)')
                } catch (error: any) {
                    if (error.name === 'InvalidPermission.Duplicate') {
                        console.log('   ✅ Rule already exists')
                    } else {
                        console.error(`   ❌ Failed to add rule: ${error.message}`)
                    }
                }
            }
        }
        
        console.log('\n🎉 Default security groups updated!')
        console.log('\n💡 Next steps:')
        console.log('   1. Test Redis connection: npm run test:redis-connection')
        console.log('   2. If connection works, redeploy App Runner service')
        console.log('   3. Test audio conversion again')
        
    } catch (error: any) {
        console.error(`❌ Error fixing security groups: ${error.message}`)
    }
}

if (require.main === module) {
    fixDefaultSecurityGroups()
}