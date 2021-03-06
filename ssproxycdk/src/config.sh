#!/bin/bash 

# Update with optional user data that will run on instance start.
# Learn more about user-data: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html
sudo su
yum install git -y
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install node
node -e "console.log('Running Node.js ' + process.version)"
mkdir ~/sagemaker-studio-proxy
git clone https://github.com/rvvittal/sagemaker-studio-proxy.git ~/sagemaker-studio-proxy
