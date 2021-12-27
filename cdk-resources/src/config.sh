#!/bin/bash -xe

# Update with optional user data that will run on instance start.
# Learn more about user-data: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html

sudo yum install git -y
mkdir ~/sagemaker-studio-proxy
git clone https://github.com/rvvittal/sagemaker-studio-proxy-basic.git ~/sagemaker-studio-proxy
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install node
node -e "console.log('Running Node.js ' + process.version)"
