import * as cdk from '@aws-cdk/core';
import * as cfn_inc from '@aws-cdk/cloudformation-include';
import * as iam from 'aws-cdk-lib/aws-iam'

export class SmCfnStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, domainName: string, 
                vpcId: string, subnetIds: string, execRole: iam.IRole, props?: cdk.StackProps) {
                    
    super(scope, id, props);

    // The code that defines your stack goes here
    const cfnInclude = new cfn_inc.CfnInclude(this, 'Template', { 
        templateFile: 'sagemaker-domain-template.yaml', 
        parameters: {
            "auth_mode": "IAM",
            'domain_name': domainName,
            "vpc_id": vpcId,
            "subnet_ids": subnetIds,
            "default_execution_role_user": execRole.roleArn,
          }
    });
  }
}