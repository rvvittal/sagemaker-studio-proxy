import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as path from 'path';

// import { KeyPair } from 'cdk-ec2-key-pair';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { KubectlProvider } from "aws-cdk-lib/aws-eks/lib/kubectl-provider";
import elb = require('aws-cdk-lib/aws-elasticloadbalancing');
import autoscaling = require('aws-cdk-lib/aws-autoscaling');
import * as cfn_inc from '@aws-cdk/cloudformation-include';
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LoadBalancingProtocol } from "aws-cdk-lib/aws-elasticloadbalancing";
import * as cfninc from 'aws-cdk-lib/cloudformation-include';
import { CoreDnsComputeType } from "aws-cdk-lib/aws-eks";
import { CfnOutput } from "aws-cdk-lib";
import {readFileSync} from 'fs';


export class SsproxycdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // Create a Key Pair to be used with this EC2 Instance
    // Temporarily disabled since `cdk-ec2-key-pair` is not yet CDK v2 compatible
    // const key = new KeyPair(this, 'KeyPair', {
    //   name: 'cdk-keypair',
    //   description: 'Key Pair created with CDK Deployment',
    // });
    // key.grantReadOnPublicKey

    // Create new VPC with 2 Subnets
    const vpc = new ec2.Vpc(this, 'VPC', {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        }
      ],
      maxAzs: 2
    });

    // Allow SSH (TCP Port 22) access from anywhere
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Allow SSH (TCP port 22) in',
      allowAllOutbound: true
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH Access')
    securityGroup.addIngressRule(ec2.Peer.ipv4('10.0.0.0/16'), ec2.Port.tcp(3000), 'Allow LB access')

    const role = new iam.Role(this, 'ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    })

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'))

    role.addToPolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['sagemaker:CreatePresignedDomainUrl'],
    }));

    // Use Latest Amazon Linux Image - CPU Type ARM64
    const ami = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });

    // Create the instance using the Security Group, AMI, and KeyPair defined in the VPC created
    //const ec2Instance = new ec2.Instance(this, 'Instance', {
      const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: securityGroup,
      // keyName: key.keyPairName,
      role: role,
      keyName: 'demo-kp',
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE_WITH_NAT}
    });

    const lb = new elb.LoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
      healthCheck: {
        port: 3000
      },
    });


    lb.addTarget(asg);
    const listener = lb.addListener({ internalPort: 3000, externalPort: 80, externalProtocol: LoadBalancingProtocol.HTTP});
    

    listener.connections.allowDefaultPortFromAnyIpv4('Open to the world');

    // 👇 load user data script
    const userDataScript = readFileSync('./lib/config.sh', 'utf8');
    // 👇 add user data to the EC2 instance
    asg.addUserData(userDataScript);

     
    new ec2.InterfaceVpcEndpoint(this, 'SM API VPC Endpoint', {
      vpc,
      service: new ec2.InterfaceVpcEndpointService('com.amazonaws.us-west-2.sagemaker.api', 443),
      privateDnsEnabled: true,
      // Choose which availability zones to place the VPC endpoint in, based on
      // available AZs
    });

    new ec2.InterfaceVpcEndpoint(this, 'Studio VPC Endpoint', {
      vpc,
      service: new ec2.InterfaceVpcEndpointService('aws.sagemaker.us-west-2.studio', 443),
      privateDnsEnabled: true,
      // Choose which availability zones to place the VPC endpoint in, based on
      // available AZs
    });

    const vpcPrivateSubnetsId = vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_WITH_NAT}).subnetIds;

    const smrole = new iam.Role(this, 'RoleForSagemakerStudioUsers', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      roleName: "RoleSagemakerStudioUsers",
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'smreadaccess',  "arn:aws:iam::aws:policy/AmazonSageMakerFullAccess")
                                              
      ]
    })

    


    const smDomain = new cfninc.CfnInclude(this, 'SagemakerDomainTemplate', {
      templateFile: 'lib/sagemaker-domain-template.yaml',
      preserveLogicalIds: false,
      parameters: {
        "auth_mode": "IAM",
        "domain_name": 'mySagemakerStudioDomain',
        "vpc_id": vpc.vpcId,
        "subnet_ids": vpcPrivateSubnetsId,
        "default_execution_role_user": smrole.roleArn,
        "app_net_access_type":  'VpcOnly',
      },
    });


    const sagemaker_domain_id = smDomain.getResource('SagemakerDomainCDK').ref

    const smUser = new cfninc.CfnInclude(this, 'SagemakerUserTemplate', {
      templateFile: 'lib/sagemaker-user-template.yaml',
      preserveLogicalIds: false,
      parameters: {
        "sagemaker_domain_id": sagemaker_domain_id,
        "user_profile_name": 'sm-studio-user',
        
      },
    });


    const smStudioUser = new ssm.StringParameter(this, 'studio-user-param', {
      parameterName: '/sagemaker-studio-proxy/dev/studio-user-profile-name',
      stringValue: 'sm-studio-user',
      description: 'sagemaker studio user',
      type: ssm.ParameterType.STRING,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });

    const smStudioDomain = new ssm.StringParameter(this, 'studio-domain-param', {
      parameterName: '/sagemaker-studio-proxy/dev/studio-domain-name',
      stringValue: sagemaker_domain_id,
      description: 'sagemaker studio domain',
      type: ssm.ParameterType.STRING,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });

    const region = String(process.env.CDK_DEFAULT_REGION)

    const presignedUrlTimeout = new ssm.StringParameter(this, 'studio-presigned-url-timeout', {
      parameterName: '/sagemaker-studio-proxy/dev/studio-presigned-url-timeout',
      stringValue: '60',
      description: 'sagemaker studio presigned url timeout',
      type: ssm.ParameterType.STRING,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });

    const studioSessionTimeout = new ssm.StringParameter(this, 'studio-session-timeout', {
      parameterName: '/sagemaker-studio-proxy/dev/studio-session-timeout',
      stringValue: '3600',
      description: 'sagemaker studio sesion timeout',
      type: ssm.ParameterType.STRING,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });

    const studioRegion = new ssm.StringParameter(this, 'studio-domain-region', {
      parameterName: '/sagemaker-studio-proxy/dev/studio-domain-region',
      stringValue: region,
      description: 'sagemaker studio domain region',
      type: ssm.ParameterType.STRING,
      tier: ssm.ParameterTier.STANDARD,
      allowedPattern: '.*',
    });



    // 👇 add the ELB DNS as an Output
    new cdk.CfnOutput(this, 'elbDNS', {
      value: lb.loadBalancerDnsName,
    });
  }


    }


    

  


}


