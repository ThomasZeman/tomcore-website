---
title: Xfce on EC2
weight: 1
---
# How to run Xfce on EC2

### Problems

- I need a Linux machine which can receive arbitrary inbound traffic and runs a desktop environment.
- I want a globally reachable Linux Machine on the Internet which I can remote desktop into.

### Solution

- Rent a headless Virtual Machine with AWS, Azure or another cloud provider which can provision a public IP address for the machine.
- Install Xfce on the Virtual Machine.
- Use Remote Desktop to connect to the Xfce Desktop Environment on the machine.

### Steps

1. Open the EC2 Dashboard

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/open-ec2-dashboard.png)](/assets/images/howto/cloud/ec2-xfce/open-ec2-dashboard.png)

2. Click on Launch Instance

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/click-launch-instance.png)](/assets/images/howto/cloud/ec2-xfce/click-launch-instance.png)

3. Select Ubuntu Server 20.04 LTS

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/select-ubuntu-server-2004lts.png)](/assets/images/howto/cloud/ec2-xfce/select-ubuntu-server-2004lts.png)

4. Choose Instance Type

Select an appropriately sized machine for your workload. Below I chose `t2.large` which comes with 2 Virtual CPUs and 8GB of RAM. 

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/choose-instance-type.png)](/assets/images/howto/cloud/ec2-xfce/choose-instance-type.png)

5. Configure Instance

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/configure-instance.png)](/assets/images/howto/cloud/ec2-xfce/configure-instance.png)

6. Add Storage

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/add-storage.png)](/assets/images/howto/cloud/ec2-xfce/add-storage.png)

7. Configure Security Group

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/configure-security-group.png)](/assets/images/howto/cloud/ec2-xfce/configure-security-group.png)
