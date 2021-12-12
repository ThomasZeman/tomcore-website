---
title: Ubuntu Linux EC2 Instance
weight: 1
---
# How to create an Ubuntu Server EC2 Instance

### Steps

1. Open the EC2 Dashboard

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/open-ec2-dashboard.png)](/assets/images/howto/cloud/create-ec2/open-ec2-dashboard.png)

2. Click on Launch Instance

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/click-launch-instance.png)](/assets/images/howto/cloud/create-ec2/click-launch-instance.png)

3. Select Ubuntu Server 20.04 LTS

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/select-ubuntu-server-2004lts.png)](/assets/images/howto/cloud/create-ec2/select-ubuntu-server-2004lts.png)

4. Choose Instance Type

Select an appropriately sized machine for your workload. Below I chose `t2.large` which comes with 2 Virtual CPUs and 8GB of RAM.

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/choose-instance-type.png)](/assets/images/howto/cloud/create-ec2/choose-instance-type.png)

5. Configure Instance

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/configure-instance.png)](/assets/images/howto/cloud/create-ec2/configure-instance.png)

6. Add Storage

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/add-storage.png)](/assets/images/howto/cloud/create-ec2/add-storage.png)

7. Add Tags

If you like you can add tags here to help you identify the instance.

8. Configure Security Group

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/configure-security-group.png)](/assets/images/howto/cloud/create-ec2/configure-security-group.png)

9. Review Instance

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/review-instance.png)](/assets/images/howto/cloud/create-ec2/review-instance.png)

10. Key Pair

Either create a new or use an existing key pair. If you create a new key pair, you will have to download the keys and save them somewhere.
You can only download the private key at this point in time.

[![Open EC2 Dashboard](/assets/images/howto/cloud/create-ec2/key-pair-dialog.png)](/assets/images/howto/cloud/create-ec2/key-pair-dialog.png)

11. Launch

AWS is launch the new EC2 instance. Scroll to the bottom and click on "View Instances"

### What's Next

[Next: How to install the Xfce Desktop on a EC2 machine](/docs/howto/cloud/xfce-on-ec2.md)  
[Next: AWS EC2 Documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)