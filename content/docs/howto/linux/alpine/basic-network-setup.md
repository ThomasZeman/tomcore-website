# Alpine Linux Basic Network Setup (WIP)

This how-to guide walks you through the basic setup of your Alpine Linux to function as a headless general-purpose router or other network device.
The following instructions are based on Alpine running on a Raspberry PI but should work with minimal or no modifications on other hardware.

## Disclaimer

This article does not provide any network security advise. Neither tomcore.io nor the author of this article can be held liable in any way. If you are unsure about what you are doing seek advice from an IT network and/or security specialist.

## Text editor

Using Alpine will require you to know how to use a text editor of your choice. By default Alpine comes with [vi](https://en.wikipedia.org/wiki/Vi_(text_editor)) as part of [BusyBox](https://www.busybox.net/). If you are not familar with vi and how to use it, I recommend doing some tutorials first. Alternatively, you can install and use [nano](https://en.wikipedia.org/wiki/GNU_nano) which is easier to use:

```shell
# Install the nano editor
localhost:~# apk add nano
(1/1) Installing nano (8.0-r0)
Executing busybox-1.36.1-r29.trigger
OK: 318 MiB in 71 packages
```

## Change login message

Everytime you login, either locally or remotely, Alpine Linux will greet you with a "Message of the Day". You can customize this message by editing `/etc/motd`.

```shell
Welcome to Alpine!

The Alpine Wiki contains a large amount of how-to guides and general
information about administrating Alpine systems.
See <https://wiki.alpinelinux.org/>.

You can setup the system with the command: setup-alpine

You may change this message by editing /etc/motd.
```

## Setup network interfaces

Alpine provides the script `setup-interfaces` to configure the network settings of your device. In the following basic example, `eth0` will receive an IP via [DHCP](https://en.wikipedia.org/wiki/Dynamic_Host_Configuration_Protocol), `eth1` is set to the static address `10.0.0.1` with a netmask of `255.255.255.0` (see: [CIDR](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing)) and `wlan0` is left unconfigured:

```shell
localhost:~# setup-interfaces
Available interfaces are: eth0 eth1 wlan0.
Enter '?' for help on bridges, bonding and vlans.
Which one do you want to initialize? (or '?' or 'done') [eth0] eth0
Ip address for eth0? (or 'dhcp', 'none', '?') [192.168.8.183] dhcp
Available interfaces are: eth1 wlan0.
Enter '?' for help on bridges, bonding and vlans.
Which one do you want to initialize? (or '?' or 'done') [eth1] eth1
Ip address for eth1? (or 'dhcp', 'none', '?') [dhcp] 10.0.0.1
Netmask? [255.0.0.0] 255.255.255.0
Gateway? (or 'none') [none]
Configuration for eth1:
  type=static
  address=10.0.0.1
  netmask=255.255.255.0
  gateway=
Available interfaces are: wlan0.
Enter '?' for help on bridges, bonding and vlans.
Which one do you want to initialize? (or '?' or 'done') [wlan0] done
Do you want to do any manual network configuration? (y/n) [n]
```

Apply the new configuration by executing the following command or by rebooting:

```shell
/etc/init.d/networking restart
```

You can inspect the configuration set by the script by opening `/etc/network/interfaces`. For the previous example the file should contain this configuration:

```shell
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp

auto eth1
iface eth1 inet static
        address 10.0.0.1
        netmask 255.255.255.0
```

## List available network interfaces and addresses

Execute `ip a` to list all interfaces, their status, and addresses such as [MAC](https://en.wikipedia.org/wiki/MAC_address), [Ipv4](https://de.wikipedia.org/wiki/IPv4), [Ipv6](https://de.wikipedia.org/wiki/IPv6) and other addresses.
The following example shows a Raspberry PI with three interfaces: `eth0, eth1, wlan0`
```shell
localhost:~# ip a
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP qlen 1000
    link/ether dc:a6:32:d5:e8:12 brd ff:ff:ff:ff:ff:ff
    inet 192.168.8.183/24 brd 192.168.8.255 scope global eth0
       valid_lft forever preferred_lft forever
    inet6 fe80::dea6:32ff:fed5:e812/64 scope link
       valid_lft forever preferred_lft forever
3: wlan0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN qlen 1000
    link/ether dc:a6:32:d5:e8:13 brd ff:ff:ff:ff:ff:ff
4: eth1: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN qlen 1000
    link/ether 00:0e:c6:54:3e:f3 brd ff:ff:ff:ff:ff:ff
```

## Create new user and granting sudo privileges

Sudo privileges allow a user to execute commands with elevated permissions, typically those of the root user, by using the `sudo` command. 
This enables a regular user to perform administrative tasks without logging in as the root user.

The following example adds a regular user called `tom` to the system:

```shell
localhost:~# adduser tom
Changing password for tom
New password:
Retype password:
passwd: password for tom changed by root
```

To install `sudo` you need to include the community APK repositories:

```shell
localhost:~# vi /etc/apk/repositories
```

For a fresh Alpine 3.20 installation the file should look similar to this (depending on your apk mirrors):

```shell
#/media/mmcblk0p1/apks
http://mirrors.edge.kernel.org/alpine/v3.20/main
#http://mirrors.edge.kernel.org/alpine/v3.20/community
```

Remove the # at the beginning of the last line and run `apk update`

Install `sudo` and `visudo` by running `apk add sudo`

Now, you can either give `tom` sudo privileges directly or add `tom` to the `wheel` group and allow sudo privileges for everyone in that group. (Refer to: [wheel group](https://en.wikipedia.org/wiki/Wheel_(computing)))
For both options, `tom` needs to start a new shell for the change to take effect.

### Add only tom to sudo'ers

Edit the sudo file by executing `visudo` (Do not edit the file directly, as you risk 'bricking' the system) and add the following line:

`tom ALL=(ALL:ALL) ALL`

Note: Replace `tom` with your own user name.
Open a new shell and run the following command to verify `tom` has sudo privileges:

```shell
localhost:~# sudo whoami
root
```

### Add tom to the wheel group

Alternatively you can add tom to the `wheel` group and grant sudo privileges to the entire group.

Verify who is in the group by running `getent group wheel`

Add `tom` to the `wheel` group: `sudo adduser tom wheel`

Edit the sudo file by executing `visudo` (Do not edit the file directly, as you risk 'bricking' the system) and find the following lines:

```
## Uncomment to allow members of group wheel to execute any command
# %wheel ALL=(ALL:ALL) ALL
```

Remove the # in front of the last line and save the file.

Open a new shell and run the following command to verify that `tom` has sudo privileges:

```shell
localhost:~# sudo whoami
root
```

## Install OpenSSH

To control the device remotely, an [ssh](https://en.wikipedia.org/wiki/Secure_Shell) server respectively [daemon](https://en.wikipedia.org/wiki/Daemon_(computing)) is essential. Install OpenSSH by executing the following command:

```shell
localhost:~# setup-sshd
# Choose openssh for the Alpine standard
Which ssh server? ('openssh', 'dropbear' or 'none') [openssh]
# It's highly recommended to not allow the root user to login directly
Allow root ssh login? ('?' for help) [prohibit-password] <no>
* service sshd added to runlevel default
...
```

## Setting up public key authorization

Public key authorization allows you to securely log into your device without entering a password each time. This setup involves generating an SSH key pair on the client side and copying the public key to the server.

### Client

First, generate an SSH key pair on your client machine:

```shell
tom@workhaus:~$ ssh-keygen -t rsa -b 4096 -C "your_name_email@gmail.com"
Generating public/private rsa key pair.
Enter file in which to save the key (/home/tom/.ssh/id_rsa):
Enter passphrase (empty for no passphrase):
Enter same passphrase again:
Your identification has been saved in /home/tom/.ssh/id_rsa
Your public key has been saved in /home/tom/.ssh/id_rsa.pub
The key fingerprint is:
SHA256:Ly2EABCRikhBFPmZdIZiOMfb4fA24Z8PllcgDYJ0mMw your_name_email@gmail.com
The key's randomart image is:
+---[RSA 4096]----+
|.**Bo   o+       |
|+.Xooo o+..      |
|.= * +Eooo       |
|  o +.oo +.      |
|      . S.=. .   |
|         =o=o    |
|        . +oo.   |
|         . .o..  |
|             o.  |
+----[SHA256]-----+
```

- `ssh-keygen -t rsa -b 4096 -C "your_name_email@gmail.com"`: This command generates an RSA key pair with 4096-bit encryption. Replace "your_name_email@gmail.com" with your email address
- Enter a file path to save the key (default for `tom` is `/home/tom/.ssh/id_rsa`)
- Optionally, enter a passphrase to protect the private key

Next, copy the public key to the remote device by using the `ssh-copy-id` command:

```shell
tom@workhaus:~$ ssh-copy-id tom@192.168.8.183
/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "/home/tom/.ssh/id_rsa.pub"
The authenticity of host '192.168.8.183 (192.168.8.183)' can't be established.
ED25519 key fingerprint is SHA256:hi8fomuuRM1abBIMqXs6D5mSVbuOa5n3j0Xhj1FAVfg.
This key is not known by any other names
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed
/usr/bin/ssh-copy-id: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys
tom@192.168.8.183's password:

Number of key(s) added: 1

Now try logging into the machine, with:   "ssh 'tom@192.168.8.183'"
and check to make sure that only the key(s) you wanted were added.
```

The command `ssh-copy-id tom@192.168.8.183` copies the public key to the remote device. Replace `192.168.8.183` with the IP address of your device. You might see a warning that the host is unknown to your client.

```shell
tom@workhaus:~$ ssh tom@192.168.8.183
Welcome to Alpine!

The Alpine Wiki contains a large amount of how-to guides and general
information about administrating Alpine systems.
See <https://wiki.alpinelinux.org/>.

You can setup the system with the command: setup-alpine

You may change this message by editing /etc/motd.
localhost:~$ whoami
tom
localhost:~$ exit
Connection to 192.168.8.183 closed.
```

- `ssh tom@192.168.8.183`: This command logs into the remote device using the SSH key. Replace `192.168.8.183` with the IP address of your device.
- `whoami`: This command confirms the logged-in user (tom)

### Copying the SSH key to another Linux machine

**Note**: The following process is somewhat difficult to achieve from a Windows machine to another Windows machine (WSL2 to WSL2). You can find more details on how to setup an SSH Server on Windows [here](https://www.hanselman.com/blog/how-to-ssh-into-wsl2-on-windows-10-from-an-external-machine). For Windows-to-Windows transfers, I recommend using the WSL2 network share and copying the files via the Windows File Explorer. For an Ubuntu 22.04 installation you can find the SSH keys here:   
`\\\wsl.localhost\Ubuntu-22.04\home\tom\.ssh`

If you want to copy the SSH key from your current client machine to another client machine, follow these steps:

1. Copy the SSH key files to the new client machine:

You can use scp (secure copy) to transfer the key files. Replace new_client with the hostname or IP address of the new client machine

```shell
tom@workhaus:~$ scp ~/.ssh/id_rsa ~/.ssh/id_rsa.pub new_client:/home/tom/.ssh/
```

2. Set appropriate permissions on the new client machine:

After copying the files, log into the new client machine and set the correct permissions

```shell
tom@new_client:~$ chmod 600 ~/.ssh/id_rsa
tom@new_client:~$ chmod 644 ~/.ssh/id_rsa.pub
```

3. Verify SSH key access from the new client machine:

Now you can use the new client machine to log into the remote device using the SSH key

```shell
tom@new_client:~$ ssh tom@192.168.8.183
Welcome to Alpine!

The Alpine Wiki contains a large amount of how-to guides and general
information about administrating Alpine systems.
See <https://wiki.alpinelinux.org/>.

You can setup the system with the command: setup-alpine

You may change this message by editing /etc/motd.
localhost:~$ whoami
tom
localhost:~$ exit
Connection to 192.168.8.183 closed.
```

The command `scp ~/.ssh/id_rsa ~/.ssh/id_rsa.pub new_client:/home/tom/.ssh/` copies the SSH key files to the new client machine

`chmod 600 ~/.ssh/id_rsa` and `chmod 644 ~/.ssh/id_rsa.pub` set the correct permissions for the private and public key files, respectively


## Disable root and password login

To enhance security, you can disable remote login by password altogether and use public key authentication only. This ensures that only users with a valid SSH key can log in.

First, open the OpenSSH configuration file:

```shell
# Open the openssh configuration
localhost:~# sudo vi /etc/ssh/sshd_config
```

Make sure the following config lines are set:
```shell
PubkeyAuthentication yes
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
```

- `PubkeyAuthentication yes` Enables public key authentication
- `PermitRootLogin no` Disables root login
- `PasswordAuthentication no` Disables password authentication
- `PermitEmptyPasswords no` Disallows login with empty passwords

After making these changes, restart the SSH service to apply the new configuration:

```shell
localhost:~# sudo /etc/init.d/sshd restart
 * Stopping sshd ...                                             [ ok ]
 * Starting sshd ...                                             [ ok ]
 ```

These steps will ensure that remote logins require a valid SSH key