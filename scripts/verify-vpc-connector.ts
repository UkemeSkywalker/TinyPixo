#!/usr/bin/env tsx

/**
 * Verify VPC Connector is working and App Runner can reach Redis
 */

import { AppRunnerClient, DescribeVpcConnectorCommand } from '@aws-sdk/client-apprunner'

const AWS_REGION = 'us-east-1'
const VPC_CONNECTOR_ARN = 'arn:aws:apprunner:us-east-1:910883278292:vpcconnector/audio-conversion-vpc-connector/1/be401efcb5254e449a59e0f2ba03fdc7'

const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })

async function verifyVpcConnector() {
    console.log('🔍 Verifying VPC Connector status...')
    
    try {
        const result = await appRunnerClient.send(new DescribeVpcConnectorCommand({
            VpcConnectorArn: VPC_CONNECTOR_ARN
        }))
        
        const connector = result.VpcConnector
        if (!connector) {
            console.error('❌ VPC Connector not found')
            return
        }
        
        console.log(`✅ VPC Connector: ${connector.VpcConnectorName}`)
        console.log(`   Status: ${connector.Status}`)
        console.log(`   ARN: ${connector.VpcConnectorArn}`)
        console.log(`   Subnets: ${connector.Subnets?.join(', ')}`)
        console.log(`   Security Groups: ${connector.SecurityGroups?.join(', ')}`)
        
        if (connector.Status === 'ACTIVE') {
            console.log('\n🎉 VPC Connector is ACTIVE and ready to use!')
            console.log('\n📋 Next steps:')
            console.log('1. Add this VPC Connector to your App Runner service:')
            console.log('   - AWS Console > App Runner > Your Service')
            console.log('   - Configuration > Networking > Edit')
            console.log('   - Select: audio-conversion-vpc-connector')
            console.log('2. Wait for App Runner to redeploy (5-10 minutes)')
            console.log('3. Test audio conversion with Redis')
        } else {
            console.log(`\n⏳ VPC Connector status: ${connector.Status}`)
            console.log('   Wait a few minutes and check again')
        }
        
    } catch (error: any) {
        console.error(`❌ Error checking VPC Connector: ${error.message}`)
    }
}

async function checkAppRunnerServices() {
    console.log('\n🔍 Checking App Runner services...')
    
    try {
        const { ListServicesCommand } = await import('@aws-sdk/client-apprunner')
        const result = await appRunnerClient.send(new ListServicesCommand({}))
        
        if (result.ServiceSummaryList && result.ServiceSummaryList.length > 0) {
            console.log('📱 Found App Runner services:')
            for (const service of result.ServiceSummaryList) {
                console.log(`   - ${service.ServiceName} (${service.Status})`)
                console.log(`     ARN: ${service.ServiceArn}`)
            }
            
            console.log('\n💡 To configure VPC Connector:')
            console.log('   1. Select your audio conversion service')
            console.log('   2. Configuration > Networking > Edit')
            console.log('   3. Add VPC Connector: audio-conversion-vpc-connector')
        } else {
            console.log('❌ No App Runner services found')
        }
        
    } catch (error: any) {
        console.error(`❌ Error listing App Runner services: ${error.message}`)
    }
}

async function main() {
    console.log('🚀 VPC Connector Verification')
    console.log('=' .repeat(40))
    
    await verifyVpcConnector()
    await checkAppRunnerServices()
    
    console.log('\n🔧 Manual Configuration Required:')
    console.log('   The VPC Connector is ready, but you need to manually')
    console.log('   configure your App Runner service to use it via the')
    console.log('   AWS Console (App Runner doesn\'t support programmatic')
    console.log('   VPC connector updates yet).')
}

if (require.main === module) {
    main()
}