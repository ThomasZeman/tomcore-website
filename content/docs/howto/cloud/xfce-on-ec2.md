---
title: Xfce Desktop on EC2
weight: 3
---
# How to run Xfce on EC2

[![HackerRank](https://img.shields.io/badge/LAST%20VALIDATED%20-14%2F12%2F2021-darkgreen)](https://ielts.com.au/articles/how-to-write-the-date-correctly/)

### Problems

- You need a globally reachable Linux machine which runs a desktop environment.
- You want to be able to access this machine from the Internet.

### Solution

- Rent a headless Virtual Machine with AWS, Azure or another cloud provider which can provision a public IP address for the machine.
- Install Xfce on the Virtual Machine.
- Use Remote Desktop to connect to the Xfce Desktop Environment on the machine.

### Steps

1. Create an EC2 instance

Follow these [instructions](create-ubuntu-ec2-instance.md) to create an EC2 instance. The default user name is `ubuntu`

2. Login via SSH

Get the public IP of the EC2 instance and [log in](connect-to-remote-linux-machine.md) with user `ubuntu`

3. Update Ubuntu

```shell
sudo apt-get update
```

4. Install Xfce and Remote Desktop

The following command installs essential Xfce and Remote Desktop packages. Note: This will install a few hundreds of 
dependency packages

```shell
sudo apt-get install xfce4 xfce4-goodies xfce4-terminal xrdp
```

During the installation you will need to set the default display manager to `lightdm`

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/configure-displaymanager.png)](/assets/images/howto/cloud/ec2-xfce/configure-displaymanager.png)

4. Configure XServer

Make Xfce the default display manager for the `ubuntu` user and restart the machine

```shell
// sudo service xrdp start
echo "startxfce4" > ~/.xsession
sudo shutdown -r now
```

5. Port Forwarding to Remote Desktop

Repeat step 2 to log into the EC2 and additionally forward an arbitrary local port (`2000` below) to the remote desktop port `3389`

```shell
ssh ubuntu@1.2.3.4 -i publicKey.pem -L 2000:127.0.0.1:3389
```