---
title: Xfce Desktop on EC2
weight: 3
---
# How to run Xfce on EC2

### Problems

- You need a globally reachable Linux machine which runs a desktop environment.
- You want to be able to access this machine from the Internet.

### Solution

- Rent a headless Virtual Machine with AWS, Azure or another cloud provider which can provision a public IP address for the machine.
- Install Xfce on the Virtual Machine.
- Use Remote Desktop to connect to the Xfce Desktop Environment on the machine.

### Steps

1. Create a Virtual Machine

Follow these [instructions](create-ubuntu-ec2-instance.md) page to create a Virtual Machine.

2. Update Ubuntu

```shell
sudo apt-get update
```

3. Install Xfce and Remote Desktop

This will install a few hundreds of packages. 

```shell
sudo apt-get install xfce4 xfce4-goodies xfce4-terminal xrdp
```

During the installation of the packages you will need to set the default display manager to `lightdm`

[![Open EC2 Dashboard](/assets/images/howto/cloud/ec2-xfce/configure-displaymanager.png)](/assets/images/howto/cloud/ec2-xfce/configure-displaymanager.png)

4. Start Xfce and Remote Desktop

```shell
sudo service xrdp start
echo "startxfce4" > ~/.xsession
sudo shutdown -r now
```

```shell
ssh ubuntu@1.2.3.4 -i publicKey.pem -L 2000:127.0.0.1:3389
```