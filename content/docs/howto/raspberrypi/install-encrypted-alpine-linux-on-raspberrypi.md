---
weight: 13
title: Install Alpine Linux on an encrypted partition
---
# Install Alpine Linux on an encrypted partition

[![HackerRank](https://img.shields.io/badge/LAST%20VALIDATED%20-18%2F03%2F2023-darkgreen)](https://ielts.com.au/articles/how-to-write-the-date-correctly/)

This guide will show you how to install Alpine Linux on an encrypted [Btrfs](https://en.wikipedia.org/wiki/Btrfs) partition 
on a Raspberry PI and is based on the
main [Alpine Linux on Raspberry PI](https://wiki.alpinelinux.org/wiki/Alpine_Linux_on_Raspberry_Pi) installation how-to. The steps are 
identical to the main guide, except for the section "Install Alpine".

**The cryptsetup parameters used to create the encrypted partition will work but are sample values and should be adapted to your needs. They
are neither tuned for security nor performance.**

## Prepare, boot and configure Diskless Alpine Linux

- Execute all steps from the main guide until the section "Install Alpine" (excluded).

## Install Alpine

Choose one of the following options:

### Option 1: Setup encrypted system partition with ext4

```shell
# Install file system tools (mkfs.ext4)
# Currently the blkid implementation of Busybox has a bug which prevents the Alpine scripts from correctly recognizing the
# encrypted partition. Therefore we need to install the original blkid tool
pi:/# apk add e2fsprogs cryptsetup blkid

# Setup 2nd partition as encrypted partition
# Confirm with "YES" and when prompted for a passphrase, enter the passphrase you want to use to unlock the partition and verify
pi:/# cryptsetup --cipher xchacha20,aes-adiantum-plain64 --hash sha256 --iter-time 5000 --pbkdf argon2i luksFormat /dev/mmcblk0p2

WARNING!
========
This will overwrite data on /dev/mmcblk0p2 irrevocably.

Are you sure? (Type 'yes' in capital letters): YES
Enter passphrase for /dev/mmcblk0p2:
Verify passphrase:
pi:/# 

# Open encrypted partition
# When prompted for a passphrase, enter the passphrase you used to encrypt the partition

pi:/# cryptsetup luksOpen /dev/mmcblk0p2 cryptroot
Enter passphrase for /dev/mmcblk0p2:
pi:/# 

# Format the encrypted partition with ext4
pi:/# mkfs.ext4 /dev/mapper/cryptroot
# Mount encrypted partition under /mnt
pi:/# mount /dev/mapper/cryptroot /mnt  
```
Continue with Step "Optional: Format and enable swap partition".

### Option 2: Setup encrypted system partition with Btrfs

```shell
# Install file system and encryption tools
# Currently the blkid implementation of Busybox has a bug which prevents the Alpine scripts from correctly recognizing the
# encrypted partition. Therefore we need to install the original blkid tool
pi:/# apk add btrfs-progs cryptsetup blkid

# Setup 2nd partition as encrypted partition
# Confirm with "YES" and when prompted for a password, enter the password you want to use to unlock the partition and verify
pi:/# cryptsetup --cipher xchacha20,aes-adiantum-plain64 --hash sha256 --iter-time 5000 --pbkdf argon2i luksFormat /dev/mmcblk0p2

WARNING!
========
This will overwrite data on /dev/mmcblk0p2 irrevocably.

Are you sure? (Type 'yes' in capital letters): YES
Enter passphrase for /dev/mmcblk0p2:
Verify passphrase:
pi:/# 

# Open encrypted partition
# When prompted for a password, enter the password you used to encrypt the partition

pi:/# cryptsetup luksOpen /dev/mmcblk0p2 cryptroot
Enter passphrase for /dev/mmcblk0p2:
pi:/# 

# Create Btrfs control node
pi:/# btrfs rescue create-control-device
# Format the encrypted partition with Btrfs
pi:/# mkfs.btrfs /dev/mapper/cryptroot

btrfs-progs v6.0.2
See http://btrfs.wiki.kernel.org for more information.

NOTE: several default settings have changed in version 5.15, please make sure
      this does not affect your deployments:
      - DUP for metadata (-m dup)
      - enabled no-holes (-O no-holes)
      - enabled free-space-tree (-R free-space-tree)

Label:              (null)
UUID:               c3a0621a-8112-4172-b90a-81629d05703e
Node size:          16384
Sector size:        4096
Filesystem size:    14.57GiB
Block group profiles:
  Data:             single            8.00MiB
  Metadata:         DUP             256.00MiB
  System:           DUP               8.00MiB
SSD detected:       yes
Zoned device:       no
Incompat features:  extref, skinny-metadata, no-holes
Runtime features:   free-space-tree
Checksum:           crc32c
Number of devices:  1
Devices:
   ID        SIZE  PATH
    1    14.57GiB  /dev/mapper/cryptroot

pi:/# 

# Mount encrypted partition under /mnt
pi:/# mount /dev/mapper/cryptroot /mnt  
```

### Optional: Format and enable swap partition

```shell
# Format 3rd partition as swap space
pi:/# mkswap /dev/mmcblk0p3
# Enable swap space
pi:/# swapon /dev/mmcblk0p3
# Enable swap space upon booting
pi:/# rc-update add swap boot
```

### Run setup

```shell
# Force the installation script to accept non FAT filesystems on the PI
pi:/# export FORCE_BOOTFS=1
# Optional: Declare the swap partition
pi:/# export SWAP_DEVICES=/dev/mmcblk0p3
# Run installation script
pi:/# setup-disk /mnt

btrfs is not supported. Only supported are: vfat
Continuing at your own risk.
Installing system on /dev/mapper/cryptroot:
  7% ██████████████████
```

```shell
# Remount boot partition as read-write partition
pi:/# mount -o remount,rw /dev/mmcblk0p1
# Remove all files
pi:/# rm /media/mmcblk0p1/* -r
# Copy all files required for booting from the new installation to the boot partition
# Ignore errors
pi:/# cp -r /mnt/boot/* /media/mmcblk0p1/
# Boot the new Alpine installation
pi:/# reboot
```

The Raspberry PI will restart and ask for the passphrase you specified during the encryption setup. After entering the passphrase, the system will boot into the new Alpine installation.

