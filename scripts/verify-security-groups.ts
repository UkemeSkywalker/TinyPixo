#!/usr/bin/env tsx

/**
 * Verify which security groups are actually used by App Runner and Redis
 */

import { EC2Client, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2'
import { ElastiCacheClient, DescribeReplicationGroupsCommand, DescribeCacheClustersCommand } from '@aws-sdk/client-elasticache'
import { AppRunnerClient, ListServicesCommand, DescribeServiceCommand } from '@aws-sdk/client-apprunner'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const ec2Client = new EC2Client({ region: AWS_REGION })
const elasticacheClient = new ElastiCacheClient({ region: AWS_REGION })
const appRunnerClient = new AppRunnerClient({ region: AWS_REGION })

async function checkRedisSecurityGroups() {
  console.log('🔍 Checking Redis cluster security groups...')
  
  try {
    // Get replication groups
    const replicationGroups = await elasticacheClient.send(new DescribeReplicationGroupsCommand({}))
    
    if (replicationGroups.ReplicationGroups) {
      for (const group of replicationGroups.ReplicationGroups) {
        if (group.ReplicationGroupId?.includes('audio-conversion')) {
          console.log(`\n📍 Redis Replication Group: ${group.ReplicationGroupId}`)
          console.log(`   Status: ${group.Status}`)
          
          // Get security groups from node groups
          if (group.NodeGroups) {
            for (const nodeGroup of group.NodeGroups) {
              if (nodeGroup.NodeGroupMembers) {
                for (const member of nodeGroup.NodeGroupMembers) {
                  console.log(`   Node: ${member.CacheClusterId}`)
                  
                  // Get detailed cluster info to see security groups
                  const clusterDetails = await elasticacheClient.send(new DescribeCacheClustersCommand({
                    CacheClusterId: member.CacheClusterId,
                    ShowCacheNodeInfo: true
                  }))
                  
                  if (clusterDetails.CacheClusters?.[0]?.SecurityGroups) {
                    console.log('   Security Groups:')
                    for (const sg of clusterDetails.CacheClusters[0].SecurityGroups) {
                      console.log(`     - ${sg.SecurityGroupId} (${sg.Status})`)
                      
                      // Get security group details
                      await describeSecurityGroup(sg.SecurityGroupId!)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Error checking Redis security groups: ${error.message}`)
  }
}

async function checkAppRunnerConfiguration() {
  console.log('\n🔍 Checking App Runner service configuration...')
  
  try {
    // List App Runner services
    const services = await appRunnerClient.send(new ListServicesCommand({}))
    
    if (services.ServiceSummaryList) {
      for (const service of services.ServiceSummaryList) {
        if (service.ServiceName?.includes('audio') || service.ServiceName?.includes('tinypixo')) {
          console.log(`\n📍 App Runner Service: ${service.ServiceName}`)
          console.log(`   Status: ${service.Status}`)
          console.log(`   Service ARN: ${service.ServiceArn}`)
          
          // Get detailed service info
          const serviceDetails = await appRunnerClient.send(new DescribeServiceCommand({
            ServiceArn: service.ServiceArn
          }))
          
          if (serviceDetails.Service?.NetworkConfiguration) {
            const networkConfig = serviceDetails.Service.NetworkConfiguration
            console.log('   Network Configuration:')
            
            if (networkConfig.EgressConfiguration) {
              console.log(`     Egress Type: ${networkConfig.EgressConfiguration.EgressType}`)
              
              if (networkConfig.EgressConfiguration.VpcConnectorArn) {
                console.log(`     VPC Connector: ${networkConfig.EgressConfiguration.VpcConnectorArn}`)
              } else {
                console.log('     VPC Connector: None (uses default VPC)')
              }
            }
            
            if (networkConfig.IngressConfiguration) {
              console.log(`     Ingress: ${networkConfig.IngressConfiguration.IsPubliclyAccessible ? 'Public' : 'Private'}`)
            }
          } else {
            console.log('   Network Configuration: Default (uses default VPC and security groups)')
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Error checking App Runner: ${error.message}`)
  }
}

async function describeSecurityGroup(securityGroupId: string) {
  try {
    const response = await ec2Client.send(new DescribeSecurityGroupsCommand({
      GroupIds: [securityGroupId]
    }))
    
    if (response.SecurityGroups?.[0]) {
      const sg = response.SecurityGroups[0]
      console.log(`       Name: ${sg.GroupName}`)
      console.log(`       VPC: ${sg.VpcId}`)
      console.log(`       Description: ${sg.Description}`)
      
      if (sg.IpPermissions) {
        console.log('       Inbound Rules:')
        for (const rule of sg.IpPermissions) {
          const protocol = rule.IpProtocol === '-1' ? 'All' : rule.IpProtocol?.toUpperCase()
          const portRange = rule.FromPort === rule.ToPort ? rule.FromPort : `${rule.FromPort}-${rule.ToPort}`
          
          if (rule.IpRanges) {
            for (const ipRange of rule.IpRanges) {
              console.log(`         ${protocol} ${portRange} from ${ipRange.CidrIp} ${ipRange.Description ? '(' + ipRange.Description + ')' : ''}`)
            }
          }
          
          if (rule.UserIdGroupPairs) {
            for (const groupPair of rule.UserIdGroupPairs) {
              console.log(`         ${protocol} ${portRange} from ${groupPair.GroupId} ${groupPair.Description ? '(' + groupPair.Description + ')' : ''}`)
            }
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error(`❌ Error describing security group ${securityGroupId}: ${error.message}`)
  }
}

async function checkDefaultSecurityGroup() {
  console.log('\n🔍 Checking default security group we modified...')
  
  try {
    await describeSecurityGroup('sg-02bb507342e3337de')
  } catch (error: any) {
    console.error(`❌ Error checking default security group: ${error.message}`)
  }
}

async function main() {
  console.log('🔧 Security Group Verification')
  console.log('==============================')
  
  await checkRedisSecurityGroups()
  await checkAppRunnerConfiguration()
  await checkDefaultSecurityGroup()
  
  console.log('\n💡 Summary:')
  console.log('- If Redis uses different security groups than the default one we modified,')
  console.log('  we need to add the Redis port rule to the correct security group(s)')
  console.log('- App Runner uses default VPC networking unless explicitly configured otherwise')
}

if (require.main === module) {
  main()
}