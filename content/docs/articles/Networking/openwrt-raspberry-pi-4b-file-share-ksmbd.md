---
weight: 12
title: "OpenWrt on a Raspberry PI 4B: A Windows File Share with ksmbd"
draft: true
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: A Windows File Share with ksmbd

{{% hint info %}}
**Work in progress, October 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94 and ksmbd-server 3.5.6. The share
is set up as described below, the test from Windows is still outstanding.
{{% /hint %}}

In [OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn) I set up a
torrent client in Docker which saves its downloads on the SSD of the router, in `/opt/torrent/downloads`. This
article describes how I make this directory available to the Windows PCs in my LAN as a network drive, so that the
files can be opened, copied, renamed and deleted directly in the Windows Explorer.

The protocol Windows speaks natively for this is [SMB](https://en.wikipedia.org/wiki/Server_Message_Block). There is
no additional software needed on the PC, the share is simply opened as `\\10.0.0.1\downloads`. Although the
download directory is the reason for this article, the same steps work for any other directory on the router.

## Why ksmbd

OpenWrt offers two SMB servers:

- **[Samba](https://www.samba.org/)** (`samba4-server`) is the classic one. It is complete and very compatible, but
  also large and comparatively slow on a small CPU. Most of what it can do, such as acting as an Active Directory
  domain controller, I do not need for a single directory.
- **[ksmbd](https://docs.kernel.org/filesystems/smb/ksmbd.html)** (`ksmbd-server`) is an SMB server which runs inside
  the Linux kernel. Only the user management and the configuration run in user space. It needs little memory and
  CPU, supports the current SMB versions 2 and 3, and the OpenWrt package comes with a page in the web interface.

I chose ksmbd. I also considered running Samba in a Docker container, but a file share is a service of the router
itself, not an application. It would have needed port 445 published on the LAN address, and gained nothing.

## Installing

```shell
root@OpenWrt:~# apk update
root@OpenWrt:~# apk add ksmbd-server luci-app-ksmbd
```

`ksmbd-server` pulls in the kernel module `kmod-fs-ksmbd`, and `luci-app-ksmbd` adds the page Services → Network
Shares to the web interface. The configuration ends up in `/etc/config/ksmbd`, from which the init script generates
the actual configuration file `/etc/ksmbd/ksmbd.conf` on every start.

## A user who owns the files

Before the share itself, it is worth thinking about who will own the files. ksmbd maps every SMB user to the Linux
user of the same name, and that user owns everything which is created or changed through the share. At the same
time, qBittorrent writes all downloads as the user with the ID `1000` (`PUID=1000` in its compose file).

The simplest solution is a Linux user on the router with exactly this ID. Then the files of qBittorrent and the files
written from Windows have the same owner, and both sides can change each other's files without any `force user`
option. (Note: the uci configuration of ksmbd does not offer `force user` anyway, only `force_root`, which would make
root the owner of everything)

I called the user `media`. OpenWrt has no `useradd` or `adduser`, so I added the user to the three files by hand,
after a backup copy of each:

```shell
root@OpenWrt:~# for f in passwd group shadow; do \
  cp /etc/$f /etc/$f.bak-ksmbd; done
root@OpenWrt:~# echo "media:x:1000:1000:media:/var/empty:/bin/false" \
  >> /etc/passwd
root@OpenWrt:~# echo "media:x:1000:" >> /etc/group
root@OpenWrt:~# echo "media:*:0:0:99999:7:::" >> /etc/shadow
```

- **`/bin/false` as shell and `*` as password** mean that `media` cannot log in to the router, neither on the console
  nor via SSH. The user only exists to own files.
- **The SMB password is separate.** ksmbd keeps its own password database in `/etc/ksmbd/ksmbdpwd.db`, which is set
  further below.

## The share

The share is a section in `/etc/config/ksmbd`:

```shell
root@OpenWrt:~# uci batch <<EOF
set ksmbd.downloads=share
set ksmbd.downloads.name=downloads
set ksmbd.downloads.path=/opt/torrent/downloads
set ksmbd.downloads.users=media
set ksmbd.downloads.read_only=no
set ksmbd.downloads.browseable=yes
set ksmbd.downloads.guest_ok=no
set ksmbd.downloads.create_mask=0664
set ksmbd.downloads.dir_mask=0775
EOF
root@OpenWrt:~# uci commit ksmbd
root@OpenWrt:~# service ksmbd enable
root@OpenWrt:~# service ksmbd restart
```

| Option | Meaning |
|---|---|
| `users=media` | Only `media` may open the share |
| `read_only=no` | Read and write. I want to delete and rename downloads from Windows |
| `guest_ok=no` | No access without a password |
| `create_mask`, `dir_mask` | New files can be written by the owner and the group, and read by everybody on the router |

The configuration file generated from this shows two more details from the defaults of the package:

```shell
root@OpenWrt:~# cat /etc/ksmbd/ksmbd.conf
[global]
  netbios name = OpenWrt
  server string = Ksmbd on OpenWrt
  workgroup = WORKGROUP
  interfaces = br-lan 
  bind interfaces only = yes
  ipc timeout = 20
  deadtime = 15
  map to guest = Bad User
  server signing = auto

######### Dynamic written config options #########

[downloads]
  path = /opt/torrent/downloads
  valid users = media
  create mask = 0664
  directory mask = 0775
  browseable = yes
  read only = no
  guest ok = no
```

- **`interfaces = br-lan`** comes from the option `interface`, which defaults to `lan`. ksmbd only serves the LAN.
- **`server signing = auto`** matters for current versions of Windows 11, which require signed SMB connections by
  default. ksmbd signs them when the client asks for it.
- **Old protocol versions are off.** SMB 1 is only enabled with the option `allow_legacy_protocols`, which is off
  by default, and it should stay that way.

## The password

The SMB password is set with `ksmbd.adduser`, which prompts for it. That way, it does not end up in the shell
history:

```shell
root@OpenWrt:~# ksmbd.adduser -a media
root@OpenWrt:~# service ksmbd restart
```

## The firewall

There is no firewall rule to add. The OpenWrt firewall decides per zone whether connections to the router itself
are accepted, and port 445 is accepted only where the zone's input policy allows it:

| Zone | Input | SMB |
|---|---|---|
| `lan` | accept | Reachable, as intended |
| `wan` | reject | Not reachable from the internet. Port 445 must never be open to the internet |
| `torrent` | reject | Not reachable from the torrent client |
| `docker` | accept | Reachable from containers on `docker0` |

It is worth mentioning that `netstat` shows ksmbd listening on all addresses (`:::445`), despite
`bind interfaces only`. So I do not rely on the ksmbd configuration alone, but on the firewall. The `docker` zone
accepts input because it was set up that way by the Docker package. As long as I trust the containers on `docker0`,
that is acceptable. Otherwise, a rule which rejects port 445 from the `docker` zone would close it.

## Connecting from Windows

In the Windows Explorer, `\\10.0.0.1\downloads` in the address bar opens the share, after asking for the user
`media` and its password. To keep it as a drive letter, "Map network drive" in the context menu of "This PC" does
the same permanently.

Please note, the router does not show up under "Network" in the Explorer. Windows finds devices there through
[WS-Discovery](https://en.wikipedia.org/wiki/WS-Discovery), which ksmbd does not provide. The package `wsdd2` would
add it, but typing the address once is enough for me.

The test from Windows, including the transfer rate over Gigabit, is still outstanding and follows here.

## Files to keep across upgrades

Nothing to add. `/etc/config/ksmbd` is part of the uci configuration, and `/etc/passwd`, `/etc/group`,
`/etc/shadow` and the ksmbd password database `/etc/ksmbd/ksmbdpwd.db` are kept by OpenWrt anyway. `owut` keeps the
two installed packages when it builds the image for the next upgrade.

## Summary and next steps

The download directory of the torrent client is available as `\\10.0.0.1\downloads` in the LAN, readable and
writable for the user `media`. Since `media` has the same ID as the user qBittorrent runs as, files from both sides
have the same owner. Next, I will test the share from Windows and measure what the PI manages over Gigabit.
