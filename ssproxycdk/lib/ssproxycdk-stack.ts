import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam'
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

    // Create an asset that will be used as part of User Data to run on first load
    const asset = new Asset(this, 'Asset', { path: path.join(__dirname, '../src/config.sh') });
    const localPath = asg.userData.addS3DownloadCommand({
      bucket: asset.bucket,
      bucketKey: asset.s3ObjectKey,
    });

    asg.userData.addExecuteFileCommand({
      filePath: localPath,
      arguments: '--verbose -y'
    });
    asset.grantRead(asg.role);

     

    new ec2.InterfaceVpcEndpoint(this, 'SM API VPC Endpoint', {
      vpc,
      service: new ec2.InterfaceVpcEndpointService('com.amazonaws.us-west-2.sagemaker.api', 443),
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
        "user_profile_name": 'sm-user',
        
      },
    });



    }
  


}


