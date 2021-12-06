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


