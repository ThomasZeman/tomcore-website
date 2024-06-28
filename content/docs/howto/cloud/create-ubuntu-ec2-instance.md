---
title: Ubuntu Linux EC2 Instance
weight: 1
---
# Create an Ubuntu Server EC2 Instance with a public IP address


[![HackerRank](https://img.shields.io/badge/LAST%20VALIDATED%20-14%2F12%2F2021-darkgreen)](https://ielts.com.au/articles/how-to-write-the-date-correctly/)

### Steps

1. Open the EC2 Dashboard

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/open-ec2-dashboard.png)](/images/howto/cloud/create-ec2/open-ec2-dashboard.png)

2. Click on Launch Instance

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/click-launch-instance.png)](/images/howto/cloud/create-ec2/click-launch-instance.png)

3. Select Ubuntu Server 20.04 LTS

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/select-ubuntu-server-2004lts.png)](/images/howto/cloud/create-ec2/select-ubuntu-server-2004lts.png)

4. Choose Instance Type

Select an appropriately sized machine for your workload. Below I chose `t2.large` which comes with 2 Virtual CPUs and 8GB of RAM.
Click "Next: Configure Instance Details".

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/choose-instance-type.png)](/images/howto/cloud/create-ec2/choose-instance-type.png)

5. Configure Instance

The default configuration is fine for most workloads. Make sure "Auto-assign Public IP" is enabled for the selected Network.
Click "Next: Add Storage".

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/configure-instance.png)](/images/howto/cloud/create-ec2/configure-instance.png)

6. Add Storage

Adjust the size of the root volume to your needs. I chose a size of `32GB` in the screenshot. Click "Next: Add Tags". 

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/add-storage.png)](/images/howto/cloud/create-ec2/add-storage.png)

7. Add Tags

Specify tags for the instance or leave blank. [Learn more](https://docs.aws.amazon.com/console/ec2/tags) about tags.
Click "Next: Configure Security Group".

8. Configure Security Group

Add rules to the security group to allow network access to the instance. The settings below allow inbound SSH traffic (TCP Port 22) from any source IP.  

Note: It is a good practice to make the rules as restrictive as possible. For example only allow SSH traffic from those IPs from which you will be connecting to the machine.  

[Learn more](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-network-security.html) about security groups.

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/configure-security-group.png)](/images/howto/cloud/create-ec2/configure-security-group.png)

9. Review Instance

If you like you can review the instance details before creating it. Click "Launch".

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/review-instance.png)](/images/howto/cloud/create-ec2/review-instance.png)

10. SSH Key Pair

Either create a new or use an existing SSH key pair. If you create a new key pair, you will have to download the keys and save them somewhere.  

Warning: This is the time you will be able to download the private key

[![Open EC2 Dashboard](/images/howto/cloud/create-ec2/key-pair-dialog.png)](/images/howto/cloud/create-ec2/key-pair-dialog.png)

11. Launch

Click on "Launch Instances" and AWS will launch the new EC2 instance.  

Note: A running EC2 instance is causing constant costs. It is advisable to stop the instance when you don't use it.

[Learn more](https://aws.amazon.com/ec2/pricing/on-demand/) about the pricing of AWS on-demand computing.

### What's Next

[Next: How to install the Xfce Desktop on a EC2 machine](/docs/howto/cloud/xfce-on-ec2.md)  
[Next: AWS EC2 Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)