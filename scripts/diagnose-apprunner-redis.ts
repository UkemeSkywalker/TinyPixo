#!/usr/bin/env tsx

/**
 * Comprehensive Redis connectivity diagnosis for App Runner
 * This script tests all possible Redis connection issues
 */

import { createClient } from 'redis'
import { ElastiCacheClient, DescribeReplicationGroupsCommand } from '@aws-sdk/client-elasticache'
import { EC2Client, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2'
import { AppRunnerClient, ListServicesCommand, DescribeServiceCommand } from '@aws-sdk/client-apprunner'

const AWS_REGION = 'us-east-1'
const REDIS_ENDPOINT = 'master.audio-conversion-redis.u6km1j.use1.cache.amazonaws.com'
const REDIS_PORT = 6379
const REDIS_CLUSTER_ID = 'audio-conversion-redis'

interface DiagnosticResult {
    test: string
    status: 'PASS' | 'FAIL' | 'WARNING'
    message: string
    fix?: string
}

class AppRunnerRedisDiagnostic {
    private results: DiagnosticResult[] = []
    private elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
    private ec2Client = new EC2Client({ region: AWS_REGION })
    private appRunnerClient = new AppRunnerClient({ region: AWS_REGION })

    private addResult(test: string, status: 'PASS' | 'FAIL' | 'WARNING', message: string, fix?: string) {
        this.results.push({ test, status, message, fix })
    }

    async testRedisClusterStatus() {
        console.log('🔍 1. Testing Redis cluster status...')
        try {
            const result = await this.elasticacheClient.send(new DescribeReplicationGroupsCommand({
                ReplicationGroupId: REDIS_CLUSTER_ID
            }))

            const cluster = result.ReplicationGroups?.[0]
            if (!cluster) {
                this.addResult('Redis Cluster', 'FAIL', 'Redis cluster not found', 'Run: npm run create:redis-cluster')
                return
            }

            if (cluster.Status !== 'available') {
                this.addResult('Redis Cluster', 'FAIL', `Cluster status: ${cluster.Status}`, 'Wait for cluster to become available')
                return
            }

            this.addResult('Redis Cluster', 'PASS', `Cluster is available (${cluster.CacheNodeType})`)

            // Check endpoint
            const primaryEndpoint = cluster.NodeGroups?.[0]?.PrimaryEndpoint?.Address
            if (primaryEndpoint !== REDIS_ENDPOINT.split('.')[0]) {
                this.addResult('Redis Endpoint', 'WARNING', `Endpoint mismatch: expected ${REDIS_ENDPOINT}, got ${primaryEndpoint}`)
            } else {
                this.addResult('Redis Endpoint', 'PASS', 'Endpoint matches configuration')
            }

        } catch (error: any) {
            this.addResult('Redis Cluster', 'FAIL', error.message, 'Check AWS credentials and permissions')
        }
    }

    async testRedisSecurityGroups() {
        console.log('🔍 2. Testing Redis security groups...')
        try {
            const result = await this.elasticacheClient.send(new DescribeReplicationGroupsCommand({
                ReplicationGroupId: REDIS_CLUSTER_ID
            }))

            const cluster = result.ReplicationGroups?.[0]
            const securityGroupIds = cluster?.SecurityGroups?.map(sg => sg.SecurityGroupId).filter(Boolean) as string[]

            if (!securityGroupIds || securityGroupIds.length === 0) {
                this.addResult('Security Groups', 'FAIL', 'No security groups found on Redis cluster')
                return
            }

            const sgResult = await this.ec2Client.send(new DescribeSecurityGroupsCommand({
                GroupIds: securityGroupIds
            }))

            let hasRedisAccess = false
            for (const sg of sgResult.SecurityGroups || []) {
                for (const rule of sg.IpPermissions || []) {
                    if (rule.FromPort === 6379 && rule.ToPort === 6379) {
                        hasRedisAccess = true
                        const sources = [
                            ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                            ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                        ]
                        this.addResult('Security Groups', 'PASS', `Redis port 6379 accessible from: ${sources.join(', ')}`)
                    }
                }
            }

            if (!hasRedisAccess) {
                this.addResult('Security Groups', 'FAIL', 'No inbound rule for Redis port 6379', 
                    'Add inbound rule: Port 6379, Source: 0.0.0.0/0 (or App Runner VPC CIDR)')
            }

        } catch (error: any) {
            this.addResult('Security Groups', 'FAIL', error.message)
        }
    }

    async testDNSResolution() {
        console.log('🔍 3. Testing DNS resolution...')
        try {
            const dns = require('dns').promises
            const addresses = await dns.resolve4(REDIS_ENDPOINT)
            this.addResult('DNS Resolution', 'PASS', `Resolved to: ${addresses.join(', ')}`)
        } catch (error: any) {
            this.addResult('DNS Resolution', 'FAIL', error.message, 'Check if Redis endpoint is correct')
        }
    }

    async testRedisConnection() {
        console.log('🔍 4. Testing Redis connection...')
        
        const connectionConfigs = [
            {
                name: 'Standard TLS',
                config: {
                    url: `rediss://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                    socket: { connectTimeout: 10000, tls: true }
                }
            },
            {
                name: 'No TLS',
                config: {
                    url: `redis://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                    socket: { connectTimeout: 10000 }
                }
            },
            {
                name: 'Extended Timeout TLS',
                config: {
                    url: `rediss://${REDIS_ENDPOINT}:${REDIS_PORT}`,
                    socket: { 
                        connectTimeout: 30000,
                        tls: true,
                        rejectUnauthorized: false
                    }
                }
            }
        ]

        for (const { name, config } of connectionConfigs) {
            try {
                console.log(`   Testing ${name}...`)
                const client = createClient(config)
                
                client.on('error', (err) => {
                    console.log(`   ${name} error:`, err.message)
                })

                await client.connect()
                await client.ping()
                await client.disconnect()
                
                this.addResult(`Redis Connection (${name})`, 'PASS', 'Connection successful')
                break // If one works, we're good
                
            } catch (error: any) {
                this.addResult(`Redis Connection (${name})`, 'FAIL', error.message)
            }
        }
    }

    async testAppRunnerVPCConnectivity() {
        console.log('🔍 5. Testing App Runner VPC connectivity...')
        try {
            // List App Runner services to find ours
            const services = await this.appRunnerClient.send(new ListServicesCommand({}))
            const audioService = services.ServiceSummaryList?.find(s => 
                s.ServiceName?.includes('audio') || s.ServiceName?.includes('tinypixo')
            )

            if (!audioService) {
                this.addResult('App Runner Service', 'WARNING', 'Could not find audio conversion service')
                return
            }

            const serviceDetails = await this.appRunnerClient.send(new DescribeServiceCommand({
                ServiceArn: audioService.ServiceArn
            }))

            const networkConfig = serviceDetails.Service?.NetworkConfiguration
            if (!networkConfig?.EgressConfiguration?.VpcConnectorArn) {
                this.addResult('VPC Connectivity', 'FAIL', 'App Runner service has no VPC connector', 
                    'Create VPC connector: npm run setup:vpc-connector')
            } else {
                this.addResult('VPC Connectivity', 'PASS', 'VPC connector configured')
            }

        } catch (error: any) {
            this.addResult('App Runner Service', 'FAIL', error.message)
        }
    }

    async generateFixes() {
        console.log('\n🔧 RECOMMENDED FIXES:\n')

        const failedTests = this.results.filter(r => r.status === 'FAIL')
        const warnings = this.results.filter(r => r.status === 'WARNING')

        if (failedTests.length === 0 && warnings.length === 0) {
            console.log('✅ All tests passed! Redis should be working.')
            return
        }

        console.log('Priority fixes (in order):')
        
        // VPC connectivity is usually the main issue
        const vpcIssue = failedTests.find(r => r.test.includes('VPC'))
        if (vpcIssue) {
            console.log('\n🚨 HIGH PRIORITY: VPC Connectivity Issue')
            console.log('   Problem: App Runner cannot reach ElastiCache without VPC connector')
            console.log('   Solution: Create and configure VPC connector')
            console.log('   Commands:')
            console.log('     1. npm run setup:vpc-connector')
            console.log('     2. Update App Runner service to use VPC connector')
            console.log('     3. Redeploy App Runner service')
        }

        // Security group issues
        const sgIssue = failedTests.find(r => r.test.includes('Security'))
        if (sgIssue) {
            console.log('\n🔒 SECURITY GROUP ISSUE')
            console.log('   Problem: ElastiCache security group blocks connections')
            console.log('   Solution: Add inbound rule for port 6379')
            console.log('   AWS Console: ElastiCache > Security Groups > Add Rule')
            console.log('   Port: 6379, Source: 0.0.0.0/0 (or specific VPC CIDR)')
        }

        // Connection issues
        const connIssue = failedTests.find(r => r.test.includes('Connection'))
        if (connIssue) {
            console.log('\n🔌 CONNECTION ISSUE')
            console.log('   Problem: Redis connection failing')
            console.log('   Quick fix: Disable Redis temporarily')
            console.log('   Commands:')
            console.log('     1. Remove REDIS_ENDPOINT from App Runner env vars')
            console.log('     2. Redeploy (will use DynamoDB fallback)')
        }

        // Temporary workaround
        console.log('\n💡 TEMPORARY WORKAROUND:')
        console.log('   If you need immediate functionality:')
        console.log('   1. Remove these environment variables from App Runner:')
        console.log('      - REDIS_ENDPOINT')
        console.log('      - REDIS_PORT') 
        console.log('      - REDIS_TLS')
        console.log('   2. Redeploy the service')
        console.log('   3. Progress tracking will use DynamoDB (slower but functional)')
    }

    async runDiagnostics() {
        console.log('🚀 App Runner Redis Connectivity Diagnostics')
        console.log('=' .repeat(50))

        await this.testRedisClusterStatus()
        await this.testRedisSecurityGroups()
        await this.testDNSResolution()
        await this.testRedisConnection()
        await this.testAppRunnerVPCConnectivity()

        console.log('\n📊 DIAGNOSTIC RESULTS:')
        console.log('=' .repeat(50))

        for (const result of this.results) {
            const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️'
            console.log(`${icon} ${result.test}: ${result.message}`)
        }

        await this.generateFixes()
    }
}

async function main() {
    const diagnostic = new AppRunnerRedisDiagnostic()
    await diagnostic.runDiagnostics()
}

if (require.main === module) {
    main()
}