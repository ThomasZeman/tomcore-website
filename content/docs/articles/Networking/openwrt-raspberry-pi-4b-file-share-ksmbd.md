---
weight: 12
title: "OpenWrt on a Raspberry PI 4B: A Windows File Share with ksmbd"
draft: true
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: A Windows File Share with ksmbd

{{% hint info %}}
**Work in progress, October/November 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94, ksmbd-server 3.5.6,
avahi-nodbus-daemon 0.9_rc5 and minidlna 1.3.3. The share is set up as described below, the test from Windows is
still outstanding.
{{% /hint %}}

In [OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn) I set up a
torrent client in Docker which saves its downloads on the SSD of the router, in `/opt/torrent/downloads`. This
article describes how I make this directory available to the Windows PCs in my LAN as a network drive, so that the
files can be opened, copied, renamed and deleted directly in the Windows Explorer.

The protocol Windows speaks natively for this is [SMB](https://en.wikipedia.org/wiki/Server_Message_Block). There is
no additional software needed on the PC, the share is simply opened as `\\router\downloads`. Although the
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
root@router:~# cat /etc/ksmbd/ksmbd.conf
[global]
  netbios name = router
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

- **`netbios name = router`** is the host name of the router, which the init script reads on every start. I
  renamed the router from `OpenWrt` to `router`, as described in the
  [Essentials](openwrt-raspberry-pi-4b-essentials) article. ksmbd does not run a NetBIOS name service, so the name
  is only used inside the SMB protocol.
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

In the Windows Explorer, `\\router\downloads` in the address bar opens the share, after asking for the user
`media` and its password. The name is resolved by dnsmasq on the router, which also hands out `lan` as the search
domain, so `\\router.lan\downloads` and `\\10.0.0.1\downloads` work as well. To keep it as a drive letter, "Map
network drive" in the context menu of "This PC" does the same permanently.

Keep in mind that Windows stores credentials per server name. `router`, `router.lan` and `10.0.0.1` count as three
different servers, so it is best to settle on one of them. Ticking "Remember my credentials" in the login dialog
saves the password for that name, and the prompt does not come back.

Please note, the router does not show up under "Network" in the Explorer. Windows finds devices there through
[WS-Discovery](https://en.wikipedia.org/wiki/WS-Discovery), which ksmbd does not provide. The package `wsdd2` would
add it, but typing the name once is enough for me.

The test from Windows, including the transfer rate over Gigabit, is still outstanding and follows here.

## Being found by other devices

A PC is happy with an address, but a TV or a phone wants to find the server by itself. ksmbd announces nothing,
and unfortunately there is not one protocol for this, but three, and every kind of device listens to a different
one:

| Protocol | Who uses it | Package on OpenWrt |
|---|---|---|
| [mDNS/DNS-SD](https://en.wikipedia.org/wiki/Multicast_DNS) (Bonjour) | macOS, iOS, Linux file managers, VLC | `avahi-nodbus-daemon`, `ksmbd-avahi-service` |
| [WS-Discovery](https://en.wikipedia.org/wiki/WS-Discovery) | "Network" in the Windows Explorer | `wsdd2` (not installed) |
| [UPnP/DLNA](https://en.wikipedia.org/wiki/DLNA) (SSDP) | TVs, for example my LG webOS TV | `minidlna` |

I first set up Avahi, because I assumed the TV would find an SMB share announced via mDNS. It does not. The LG TV
only looks for DLNA media servers, which is why it showed another media server in my LAN, but not the router. So
I added minidlna as well. Both are described below.

### 1. Announcing the SMB share with Avahi

[Avahi](https://avahi.org/) is the mDNS daemon on Linux. The package `ksmbd-avahi-service` contains nothing but a
service file which tells Avahi to announce the SMB server, and pulls in the daemon itself:

```shell
root@OpenWrt:~# apk add avahi-nodbus-daemon ksmbd-avahi-service
...
(4/5) Installing avahi-nodbus-daemon (0.9_rc5-r1)
(5/5) Installing ksmbd-avahi-service (3.5.6-r1)
OK: 266.5 MiB in 313 packages
root@OpenWrt:~# cat /etc/avahi/services/smb.service
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">%h</name>
  <service>
    <type>_smb._tcp</type>
    <port>445</port>
  </service>
</service-group>
```

`%h` is replaced by the host name, so the share appears as `router`. I used the `nodbus` variant because nothing
else on the router talks to Avahi via D-Bus, and it saves the D-Bus daemon.

Out of the box, `/etc/avahi/avahi-daemon.conf` does not restrict the interfaces, so Avahi would answer on every
interface of the router, including the WAN and the Docker networks. One line in the `[server]` section limits it
to the LAN:

```shell
root@OpenWrt:~# sed -i "s/^\[server\]$/[server]\nallow-interfaces=br-lan/" \
  /etc/avahi/avahi-daemon.conf
root@OpenWrt:~# sed -n 1,4p /etc/avahi/avahi-daemon.conf
[server]
allow-interfaces=br-lan
#host-name=foo
#domain-name=local
root@OpenWrt:~# service avahi-daemon restart
Command failed: ubus call service delete { "name": "avahi-daemon" } (Not found)
```

(Note: the "Command failed" only means that the daemon was not running yet, so there was nothing to stop)

The log confirms that Avahi joined only `br-lan` and announces the service:

```text
root@router:~# logread | grep avahi
...
daemon.info avahi-daemon[10024]: Loading service file /etc/avahi/services/smb.service.
...
daemon.info avahi-daemon[10024]: Joining mDNS multicast group on interface br-lan.IPv4 with address 10.0.0.1.
daemon.info avahi-daemon[10024]: New relevant interface br-lan.IPv4 for mDNS.
daemon.info avahi-daemon[10024]: Server startup complete. Host name is router.local. Local service cookie is ...
daemon.info avahi-daemon[10024]: Service "router" (/etc/avahi/services/smb.service) successfully established.
```

From the PC, an mDNS query for `_smb._tcp.local` was answered by `10.0.0.1`, and VLC lists the share under "Local
Network" since then. (Note: I ran that query before I renamed the router, so the answer still carried the name
`OpenWrt`) The package enables the service at boot, there is nothing else to do.

### 2. A media server for the TV with minidlna

[minidlna](https://sourceforge.net/projects/minidlna/) (also known as ReadyMedia) is a small DLNA server. It scans
a directory, keeps an index of the media files in an SQLite database, announces itself via
[SSDP](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol) and streams the files over HTTP. It does
not use SMB at all, it only reads the same directory. `luci-app-minidlna` adds the page Services → miniDLNA to the
web interface.

```shell
root@OpenWrt:~# apk add minidlna luci-app-minidlna
root@OpenWrt:~# mkdir -p /opt/minidlna
root@OpenWrt:~# uci batch <<EOF
set minidlna.config.enabled='1'
set minidlna.config.interface='br-lan'
set minidlna.config.friendly_name='OpenWrt Media'
set minidlna.config.db_dir='/opt/minidlna'
set minidlna.config.inotify='1'
delete minidlna.config.media_dir
add_list minidlna.config.media_dir='V,/opt/torrent/downloads'
EOF
root@OpenWrt:~# uci commit minidlna
root@OpenWrt:~# service minidlna enable
root@OpenWrt:~# service minidlna restart
```

| Option | Meaning |
|---|---|
| `interface=br-lan` | Announce and serve only in the LAN |
| `friendly_name` | The name the TV shows in its list of sources |
| `db_dir=/opt/minidlna` | The index lives on the SSD. The default is `/var/run/minidlna`, which is in RAM, so every reboot would mean a full rescan |
| `inotify=1` | New downloads are added to the index as soon as they appear, without a rescan |
| `media_dir=V,…` | Only video files. Without the `V,` minidlna would also index music and pictures |

It is worth mentioning that minidlna runs as its own user `minidlna`, not as `media`. It can still read all
downloads, because the `create_mask` and `dir_mask` of the share make files and directories readable for everybody
on the router. The init script creates `/opt/minidlna` for this user if it does not exist yet.

The firewall needs no rule here either. SSDP is UDP port 1900 (multicast), the streams run over TCP port 8200, and
both are accepted in the `lan` zone and rejected everywhere else:

```shell
root@OpenWrt:~# netstat -lnup | grep 1900
udp        0      0 239.255.255.250:1900    0.0.0.0:*                           22095/minidlnad
root@OpenWrt:~# netstat -lntp | grep 8200
tcp        0      0 0.0.0.0:8200            0.0.0.0:*               LISTEN      22095/minidlnad
```

minidlna also has a small status page at `http://10.0.0.1:8200`, which shows the size of the index and the clients
which have connected. After the first scan of my download directory:

```text
MiniDLNA status

Media library
  Audio files    0
  Video files    177
  Image files    0
```

Please note, DLNA is read only. The TV can browse and play the files, but deleting or renaming is still done
through the SMB share.

(Note: whether the LG TV now lists "OpenWrt Media" and plays the files is still to be confirmed and follows here)

## Files to keep across upgrades

Nothing to add. `/etc/config/ksmbd` and `/etc/config/minidlna` are part of the uci configuration, and
`/etc/passwd`, `/etc/group`, `/etc/shadow` and the ksmbd password database `/etc/ksmbd/ksmbdpwd.db` are kept by
OpenWrt anyway. The changed `/etc/avahi/avahi-daemon.conf` is kept as well, because the package marks it as a
configuration file (`sysupgrade -l` lists it). The minidlna index is on the SSD in `/opt/minidlna` and is not
touched by an upgrade at all. `owut` keeps the installed packages when it builds the image for the next upgrade.

## Summary and next steps

The download directory of the torrent client is available as `\\router\downloads` in the LAN, readable and
writable for the user `media`. Since `media` has the same ID as the user qBittorrent runs as, files from both sides
have the same owner. Avahi announces the share via mDNS, so VLC finds it by itself, and
minidlna offers the videos as a DLNA media server for the TV. Next, I will test the share from Windows and measure
what the PI manages over Gigabit.
