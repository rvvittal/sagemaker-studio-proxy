yum update -y
yum install git -y
cat > /tmp/subscript.sh << EOF
# START
echo "Setting up NodeJS Environment"
curl https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
 
echo 'export NVM_DIR="/home/ec2-user/.nvm"' >> /home/ec2-usr/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm' >> /home/ec2-user/.bashrc
 
# Dot source the files to ensure that variables are available within the current shell
. /home/ec2-user/.nvm/nvm.sh
. /home/ec2-user/.bashrc
 
# Install NVM, NPM, Node.JS 
nvm alias default v16.13.2
nvm install v16.13.2
nvm use v16.13.2

mkdir -p /home/ec2-user/sagemaker-studio-proxy
git clone https://github.com/rvvittal/sagemaker-studio-proxy.git /home/ec2-user/sagemaker-studio-proxy
cd /home/ec2-user/sagemaker-studio-proxy/app
npm install

EOF
 
chown ec2-user:ec2-user /tmp/subscript.sh && chmod a+x /tmp/subscript.sh
sleep 1; su - ec2-user -c "/tmp/subscript.sh"