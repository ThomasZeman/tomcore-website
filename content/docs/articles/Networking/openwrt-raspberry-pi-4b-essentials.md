---
weight: 5
title: "OpenWrt on a Raspberry PI 4B: Essentials"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: Essentials

{{% hint info %}}
**Work in progress, October 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94. This is the first part of a series
and describes what is running today. The other parts, coming soon, cover Docker, the WireGuard server and the VLAN
that exits in another country.
{{% /hint %}}

For a few years my Raspberry PI ran Alpine Linux as a home router. I configured the network interfaces, nftables and
a couple of Docker containers (dnsmasq and Pi-hole) by hand and started to write down every step on this site. Those
notes were never finished, and every new feature, such as a WireGuard tunnel routed through its own VLAN, meant more
hand-written firewall rules.

So I decided to start over with [OpenWrt](https://openwrt.org/). Routing, the firewall, DHCP, WireGuard and VLANs
come out of the box, together with a web interface (LuCI). What OpenWrt does not do by itself, such as a Git server
with a web interface, will run in Docker on the same box. I did not want to run a second device with another power
adapter for that.

This article describes the foundation: the hardware, the installation including the first security steps, how IPv6
works on this router, the quirks of the USB network adapter, and moving the system from the SD card to an SSD. Docker comes up wherever it influenced
these decisions, but the installation itself, including how I keep a runaway container from taking the router down,
is described in a separate article about Docker (coming soon).

## Hardware

| Part | What I use |
|---|---|
| Board | Raspberry PI 4 Model B Rev 1.4, 8GB RAM |
| LAN | The built-in Gigabit Ethernet port (`eth0`) |
| WAN | A USB 3.0 2.5G Ethernet adapter based on the Realtek RTL8156 chip (`eth1`) |
| Storage | A Samsung 840 EVO 250GB SATA SSD in a USB 3.0 enclosure with an ASMedia bridge chip (USB ID `174c:55aa`) |
| SD Card | Only needed for the first installation, not anymore |

In my [USB network performance](/docs/articles/RaspberryPI/raspberry-pi-4b-usb-network-performance/)
article, the Realtek RTL8153 clearly outperformed the ASIX ax88179 on the PI, which is why I stayed with Realtek and
picked its 2.5G successor. Keep in mind, as described in that article, that all USB devices share one interrupt
which is always handled by CPU0. With the WAN adapter and the SSD on the two blue USB 3.0 ports, network and disk
traffic now compete for that one interrupt.

{{< mermaid >}}
flowchart LR
  inet(("Internet")) --- up["NBN HFC modem<br/>(coax)"]
  up ---|"eth1 - USB 2.5G"| pi
  subgraph pi["Raspberry PI 4B - OpenWrt"]
    r["Routing, firewall,<br/>DHCP, DNS"]
    d["Docker<br/>(separate article)"]
  end
  ssd[("USB SSD<br/>boot, root, /opt")] --- pi
  pi ---|"eth0 - built-in<br/>10.0.0.1/24"| lan["LAN"]
{{< /mermaid >}}

On the WAN side, the PI connects to an Australian NBN HFC (coax) modem. The modem does not route by itself, it only
bridges the cable connection to Ethernet, so the PI is the only router in the house and gets the public address
directly. (Note: depending on the provider, the WAN uses DHCP or PPPoE. The image contains `ppp-mod-pppoe` for the
latter)

## Installing OpenWrt

### Building and writing the image

The stock image for the Raspberry PI 4 already contains `kmod-usb-net-rtl8152`, the driver for the whole RTL815x
family including the RTL8156, so the USB adapter works as a WAN port right away. What the image does not contain is
the firmware for the chip and the tools to switch the adapter out of its CD-ROM mode, a problem described further
down. Keep in mind that a WAN port which does not come up means no internet to install anything with, so these
packages belong into the image. The [OpenWrt Firmware Selector](https://firmware-selector.openwrt.org/) builds one
online: select "Raspberry Pi 4B/400/CM4 (64bit)", open "Customize installed packages" and add:

```text
r8152-firmware usb-modeswitch usbutils
```

(Note: if your adapter is not a Realtek, check the [Table of Hardware](https://openwrt.org/toh/start) for its driver
package and add that one as well)

I picked the ext4 image instead of squashfs because I knew I was going to install many packages later. I wrote it to
the SD Card with Raspberry PI Imager ("Use custom"). OpenWrt boots with the LAN address `192.168.1.1` and a root
account without password, so connect a PC directly to the built-in port and open `http://192.168.1.1`.

### Password and SSH access first

A fresh OpenWrt has no root password at all. The web interface and SSH simply let everybody in, and that is not a
theoretical problem: everything in the LAN can reach the router, and once Docker runs on the box, so can every
container. I am a little embarrassed to say that I only noticed this after the system had been running for a while,
because I had restored a backup and never checked. So this is the first thing to do, before the network
configuration, and it has to be checked again after every restore from a backup.

(Note: the examples below already use `10.0.0.1`, the LAN address I configure in the next step. On a fresh image,
the router is still at `192.168.1.1`)

**1. Set the root password** under System → Administration → Router Password. The same password protects LuCI and
SSH. The usual rules apply: long, unique to this device and stored in a password manager. Nobody has to type it
often, as the next step shows.

**2. Log in with a key instead of the password.** A key cannot be guessed or phished, and the password then only
serves as a fallback on the console. I already had an [Ed25519](https://en.wikipedia.org/wiki/EdDSA#Ed25519) key
pair on my Windows PC. If you do not, `ssh-keygen -t ed25519` creates one in `%USERPROFILE%\.ssh\`, and the public
half is in `id_ed25519.pub`. Please note, only the `.pub` file ever leaves your PC. The content of that file goes
into System → Administration → SSH-Keys, which stores it in `/etc/dropbear/authorized_keys`:

```shell
root@OpenWrt:~# cat /etc/dropbear/authorized_keys
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... thomas@pc
```

Then test it from a **second** terminal, while the first one stays logged in. If the key does not work, the first
terminal is the way back to fix it:

```shell
PS C:\> ssh -o PasswordAuthentication=no root@10.0.0.1
root@OpenWrt:~#
```

**3. Turn password logins off** once the key works. OpenWrt's SSH server is [Dropbear](https://matt.ucc.asn.au/dropbear/dropbear.html),
and it is configured in uci. At the same time, I bind it to the LAN interface only. The firewall already keeps SSH
away from the WAN, but this way Dropbear never listens on a VLAN or a WireGuard interface which I add later, unless
I decide that it should:

```shell
root@OpenWrt:~# uci set dropbear.main.PasswordAuth='off'
root@OpenWrt:~# uci set dropbear.main.RootPasswordAuth='off'
root@OpenWrt:~# uci set dropbear.main.Interface='lan'
root@OpenWrt:~# uci commit dropbear
root@OpenWrt:~# /etc/init.d/dropbear restart
root@OpenWrt:~# uci show dropbear
dropbear.main=dropbear
dropbear.main.enable='1'
dropbear.main.PasswordAuth='off'
dropbear.main.RootPasswordAuth='off'
dropbear.main.Port='22'
dropbear.main.Interface='lan'
```

A login attempt without the key is now refused before any password is asked for, and the key still works:

```shell
PS C:\> ssh -o PubkeyAuthentication=no root@10.0.0.1
root@10.0.0.1: Permission denied (publickey).
PS C:\> ssh root@10.0.0.1
root@OpenWrt:~#
```

`/etc/dropbear/` is on OpenWrt's built-in keep list (`/lib/upgrade/keep.d/dropbear`), so the key and the host keys
survive upgrades without an entry in `sysupgrade.conf`, and they are part of the backup archive.

(Note: this protects the router against everybody in the LAN. Keeping the internet out is the job of the firewall,
as described in the IPv6 section. What is still open is a Docker container reaching the web interface, which I
take care of in the Docker article, coming soon)

### LAN and WAN

My network configuration is small. The LAN moved to `10.0.0.1/24` (the same subnet as in my old Alpine setup) and
the WAN is the USB adapter, configured via DHCP:

```shell
root@OpenWrt:~# uci show network
...
network.@device[0]=device
network.@device[0].name='br-lan'
network.@device[0].type='bridge'
network.@device[0].ports='eth0'
network.lan=interface
network.lan.device='br-lan'
network.lan.proto='static'
network.lan.ipaddr='10.0.0.1/24'
network.lan.ip6assign='64'
network.wan=interface
network.wan.device='eth1'
network.wan.proto='dhcp'
network.wan6=interface
network.wan6.device='eth1'
network.wan6.proto='dhcpv6'
network.wan6.reqaddress='try'
network.wan6.reqprefix='auto'
```

## IPv6

My provider delivers [IPv6](https://en.wikipedia.org/wiki/IPv6) natively on the HFC connection, so the router runs
dual stack: every device in the LAN gets an address from `10.0.0.0/24` and a public IPv6 address at the same time.
OpenWrt sets this up out of the box with the `wan6` interface and the `ip6assign` option shown above, and I did not
have to change anything for it to work. However, IPv6 works quite differently from IPv4 behind the scenes, and I
wanted to understand what the defaults do before I touch the firewall or add VLANs in the later parts.

(Note: throughout this article, I replaced my real prefix with the
[documentation prefix](https://en.wikipedia.org/wiki/IPv6_address#Documentation) `2001:db8::/32` and made up the
rest of the global addresses, the ULA prefix and the provider's link-local address. The structure of the output is unchanged)

### What the provider hands out

With IPv4, the router receives one public address and shares it with the whole LAN through
[NAT](https://en.wikipedia.org/wiki/Network_address_translation). With IPv6 there is no NAT. Instead, the router asks
the provider via [DHCPv6](https://en.wikipedia.org/wiki/DHCPv6) for two things: an address for itself
(`reqaddress='try'`, because some providers do not hand one out) and a whole prefix for the networks behind it
(`reqprefix='auto'`). The latter is called prefix delegation. This is what came back:

```shell
root@OpenWrt:~# ifstatus wan6
{
  "up": true,
  ...
  "proto": "dhcpv6",
  "delegation": true,
  "ipv6-address": [
    {
      "address": "2001:db8:abcd:1:9f3e:2c1a:7b5d:4e6f",
      "mask": 128,
      "preferred": 3163,
      "valid": 6764
    }
  ],
  "ipv6-prefix": [
    {
      "address": "2001:db8:1234::",
      "mask": 48,
      "preferred": 3163,
      "valid": 6764,
      "class": "wan6",
      "assigned": {
        "lan": {
          "address": "2001:db8:1234::",
          "mask": 64
        }
      }
    }
  ],
  ...
```

The router got a single address (a /128) for the WAN side and a /48 prefix for the LAN side. A /48 contains 65,536
networks of /64 each, which is far more than I will ever need, but it means every VLAN I add later can get its own
/64 without asking the provider for anything. `ip6assign='64'` on the `lan` interface tells OpenWrt to take one /64
out of the delegated prefix and assign it to the LAN bridge. The router itself takes the `::1` address of it:

```shell
root@OpenWrt:~# ip -6 addr show br-lan
5: br-lan: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000
    inet6 2001:db8:1234::1/64 scope global dynamic noprefixroute
       valid_lft 6764sec preferred_lft 3163sec
    inet6 fd12:3456:789a::1/64 scope global noprefixroute
       valid_lft forever preferred_lft forever
    inet6 fe80::.../64 scope link proto kernel_ll
       valid_lft forever preferred_lft forever
```

The LAN bridge has three IPv6 addresses, and every device in the LAN will end up with the same three kinds:

- **The global address** from the provider's prefix. It is marked `dynamic` with a lifetime of 6764 seconds, less
  than two hours, and is renewed over and over as long as the connection is up. The provider can hand out a different
  prefix after a reconnect, so I do not write global IPv6 addresses into any configuration or firewall rule. OpenWrt
  derives them from the prefix at runtime.
- **A [Unique Local Address](https://en.wikipedia.org/wiki/Unique_local_address) (ULA)** from `fd12:3456:789a::/48`.
  This is the IPv6 counterpart of a private IPv4 range. OpenWrt generated the prefix randomly at the first boot
  (`network.globals.ula_prefix`) and it never changes, so devices in the LAN can always reach each other and the
  router under a stable address, even when the provider's prefix changes or the WAN is down.
- **The link-local address** `fe80::...`, which every IPv6 interface has, and which is used for everything that
  happens between neighbors on the same cable: discovering the router, resolving addresses and the default route.

### How the devices in the LAN get their addresses

With IPv4, the DHCP server hands out the address, the gateway and the DNS server in one go. IPv6 splits this up.
The router (the `odhcpd` daemon, configured in `dhcp.lan`) periodically sends Router Advertisements, which tell the
devices the prefix of the LAN and that the router is the way out:

```shell
root@OpenWrt:~# uci show dhcp.lan
dhcp.lan=dhcp
dhcp.lan.interface='lan'
...
dhcp.lan.dhcpv6='server'
dhcp.lan.ra='server'
dhcp.lan.ra_slaac='1'
dhcp.lan.ra_flags='managed-config' 'other-config'
dhcp.lan.ra_default='1'
```

With `ra_slaac='1'`, devices build their own address out of the advertised /64 and an interface part they choose
themselves ([SLAAC](https://en.wikipedia.org/wiki/IPv6#Stateless_address_autoconfiguration_(SLAAC)), stateless
address autoconfiguration). Most devices also generate a new random address every day for privacy. At the same time,
the router runs a DHCPv6 server, and the two `ra_flags` announce it: `managed-config` says that addresses are
available via DHCPv6, and `other-config` that other information, such as DNS servers, is as well. Both are needed,
because the devices do not agree on one method: Windows happily uses DHCPv6, while Android does not support DHCPv6
at all and relies on SLAAC and the DNS servers announced in the Router Advertisement. The result is that every
device gets an address, but a device may well have several global addresses at once. Please note, for that reason,
a list of leases like the one for IPv4 does not exist for IPv6, which matters for firewall rules per device later on.

The gateway is also not part of DHCP. The default route of each device points to the link-local address of the
router, learned from the Router Advertisement, and the router's own default route works the same way towards the
provider:

```shell
root@OpenWrt:~# ip -6 route show default
default from 2001:db8:1234::/48 via fe80::1234:56ff:fe78:9abc dev eth1 proto static metric 384 pref medium
default from 2001:db8:abcd:1:9f3e:2c1a:7b5d:4e6f via fe80::1234:56ff:fe78:9abc dev eth1 proto static metric 384 pref medium
```

Noticeably, both default routes have a `from` part. They only apply to packets whose source address is in the
delegated prefix or is the WAN address. A packet with a ULA source address matches neither and has no route to the
internet, which is exactly right, since nobody out there could answer it.

### No NAT, so the firewall does all the work

This is the part that deserves the most attention. With IPv4, NAT accidentally acts as a firewall: nobody on the
internet can address a device behind the router, because the device has no public address. With IPv6, every device
has one and is reachable in principle. The only thing between a smart TV in the LAN and the internet is the
firewall. OpenWrt's defaults for the `wan` zone are:

```shell
root@OpenWrt:~# uci show firewall | grep "@zone\[1\]"
firewall.@zone[1]=zone
firewall.@zone[1].name='wan'
firewall.@zone[1].network='wan' 'wan6'
firewall.@zone[1].input='REJECT'
firewall.@zone[1].output='ACCEPT'
firewall.@zone[1].forward='DROP'
firewall.@zone[1].masq='1'
firewall.@zone[1].mtu_fix='1'
```

Both `wan` and `wan6` are in the same zone, so the rules apply to both protocols. Nothing from the internet gets into
the router (`input='REJECT'`) or through it to the LAN (`forward='DROP'`), while replies to connections opened from
the inside are tracked and let back in. That is the same protection a NAT router gives for IPv4. Keep in mind that
`masq='1'` only applies to IPv4 in OpenWrt. IPv6 is routed with the real addresses.

A few things must get through from the WAN side, though, and OpenWrt ships rules for them which are easy to break
by well-meaning hardening:

| Rule | What it allows |
|---|---|
| `Allow-DHCPv6` | UDP port 546 from the WAN to the router, the replies for the router's own address and prefix |
| `Allow-MLD` | Multicast Listener Discovery from link-local addresses, needed for multicast on the WAN link |
| `Allow-ICMPv6-Input` | ICMPv6 to the router itself: ping, error messages, neighbor and router discovery |
| `Allow-ICMPv6-Forward` | ICMPv6 through the router to the LAN: ping and error messages such as `packet-too-big` |

Blocking ping is a common habit from IPv4, and with IPv6 it is a mistake. ICMPv6 is not only ping. Neighbor
Discovery, the replacement for ARP, is ICMPv6, and so is [Path MTU Discovery](https://en.wikipedia.org/wiki/Path_MTU_Discovery):
IPv6 routers never fragment packets, so when a packet is too big for a link on the way, the router there sends a
`packet-too-big` message back and the sender has to try a smaller size. If that message is dropped by the firewall,
large downloads and some web pages simply hang while small ones work. It is worth mentioning that
`Allow-ICMPv6-Forward` includes `echo-request`, so every device in the LAN answers to pings from the internet, rate
limited to 1000 per second. That reveals that a device exists, nothing more, and I left these defaults as they are.

### Checking that it works

A ping from the router to a host that has an IPv6 address shows that the whole chain works:

```shell
root@OpenWrt:~# ping -6 -c 3 openwrt.org
...
--- openwrt.org ping statistics ---
3 packets transmitted, 3 packets received, 0% packet loss
round-trip min/avg/max = 301.796/304.526/308.295 ms
```

(Note: the 300ms are the distance from Sydney to a server in Europe and have nothing to do with IPv6)

The provider's DNS servers for IPv6 arrive via DHCPv6 as well (`dns-server` in `ifstatus wan6`) and the router hands
them on to the LAN. For the later parts, two consequences of this setup are worth keeping in mind: every new VLAN
gets its own /64 from the delegated prefix by setting `ip6assign='64'` on its interface, and the firewall rules of
that VLAN must cover IPv6 explicitly, because there is no NAT to hide behind.

## Quirks of the USB adapter

The adapter works as a WAN port out of the box, but two things about it needed attention.

### Missing in the Port status

Everything worked, but the overview page of the web interface showed only one port, `eth0`, in its "Port status"
box. The WAN port was not there, even though it was up and passing traffic.

The box does not look at which interfaces actually exist. It asks the router for its built-in Ethernet ports
(`getBuiltinEthernetPorts` in `/usr/share/rpcd/ucode/luci`), and that function reads the `lan` and `wan` entries
in `/etc/board.json`:

```shell
root@OpenWrt:~# ubus call luci getBuiltinEthernetPorts
{
  "result": [
    {
      "role": "lan",
      "device": "eth0"
    }
  ]
}
```

`board.json` is generated once at first boot from the hardware profile of the board, and the profile of the
Raspberry PI 4 only knows its single built-in port. The function has a workaround that scans for additional `ethN`
devices, but it only runs on x86_64:

```text
/* Workaround for targets that do not enumerate  all netdevs in board.json */
if (uname().machine in [ 'x86_64' ] &&
```

The durable fix is a small script in `/etc/board.d/`, written in the same style as the stock `02_network` script,
which declares `eth1` as the WAN port:

```shell
root@OpenWrt:~# cat /etc/board.d/03_usb_wan
# Declare the USB Ethernet adapter as the WAN port. The Raspberry Pi
# profile in 02_network only knows the onboard eth0, so without this
# board.json has no wan entry and LuCI's Port status omits eth1.

. /lib/functions/uci-defaults.sh

board_config_update

ucidef_set_interface_wan "eth1"

board_config_flush

exit 0
```

However, the `board.d` scripts only run when `board.json` does not exist yet. Do not delete `board.json` to force
a rebuild: I tested that by generating a fresh file into `/tmp`, and the result was missing its `wlan` section,
which is added by the Wi-Fi setup and not by these scripts. Instead, I backed up the file and added only the `wan`
entry:

```shell
root@OpenWrt:~# cp /etc/board.json /etc/board.json.bak
root@OpenWrt:~# ucode -l fs - <<'EOF'
let f = "/etc/board.json";
let b = json(fs.readfile(f));
b.network.wan = { device: "eth1", protocol: "dhcp" };
fs.writefile(f, sprintf("%.J\n", b));
EOF
root@OpenWrt:~# jsonfilter -i /etc/board.json -e "@.network"
{ "lan": { "device": "eth0", "protocol": "static" }, "wan": { "device": "eth1", "protocol": "dhcp" } }
```

After a reload of the overview page, both ports show up. Routing and DHCP do not read `board.json`, so this change
does not touch the live network at all.

A firmware upgrade only keeps files listed in `/etc/sysupgrade.conf`, so the script goes in there:

```shell
root@OpenWrt:~# echo "/etc/board.d/03_usb_wan" >> /etc/sysupgrade.conf
```

### Booting as a CD-ROM

Many Realtek USB network adapters contain a small flash chip with a Windows driver. When plugged in, they first
pretend to be a USB CD-ROM drive (USB ID `0bda:8151`) so that Windows can install the driver from it. Only after
receiving a switch command do they turn into a network adapter (`0bda:8156`).

Usually this happens automatically and I did not notice it. But after one reboot, `eth1` simply did not exist,
and the PI had no internet connection:

```shell
root@OpenWrt:~# dmesg | grep -iE "8151|cd-rom"
[    3.036876] usb 2-1: New USB device found, idVendor=0bda, idProduct=8151, bcdDevice=31.04
[    4.155722] scsi 1:0:0:0: CD-ROM            Realtek  USB CD-ROM       2.00 PQ: 0 ANSI: 0
root@OpenWrt:~# ip -br addr show eth1
Device "eth1" does not exist.
```

OpenWrt switches such devices with `usbmode` and the rules in `/etc/usb-mode.json`, but that file has no rule for
this adapter. A software re-plug of the USB device did not help, and neither did the generic "StandardEject" mode.
What worked was Realtek's own vendor switch message, which I put into a separate rule file:

```shell
root@OpenWrt:~# cat /etc/usb-mode-rtl8156.json
{
  "messages": [
    "555342430860d9a9c0000000800006e0000000000000000000000000000000"
  ],
  "devices": {
    "0bda:8151": {
      "*": {
        "t_vendor": 3034,
        "t_product": [ 33110 ],
        "msg": [ 0 ]
      }
    }
  }
}
root@OpenWrt:~# usbmode -s -v -c /etc/usb-mode-rtl8156.json
root@OpenWrt:~# dmesg | tail -3
[  310.865800] r8152-cfgselector 2-1: reset SuperSpeed USB device number 4 using xhci_hcd
[  310.987873] r8152 2-1:1.0 eth1: v1.12.13
[  314.221036] r8152 2-1:1.0 eth1: carrier on
```

(Note: `t_vendor` and `t_product` are the target USB IDs in decimal: 3034 is `0x0bda` and 33110 is `0x8156`)

To send this message automatically whenever the adapter shows up as a CD-ROM, I added a hotplug script:

```shell
root@OpenWrt:~# cat /etc/hotplug.d/usb/21-rtl8156-modeswitch
# The Realtek 2.5G WAN adapter sometimes enumerates in its driver-CD mode
# (0bda:8151) instead of as a NIC (0bda:8156), leaving eth1 missing.
# Send Realtek's vendor switch message whenever it shows up that way.

[ "$ACTION" = add ] && [ "$DEVTYPE" = usb_device ] || exit 0

case "$PRODUCT" in
bda/8151/*)
  logger -t rtl8156-modeswitch "switching $DEVPATH from CD-ROM to NIC mode"
  usbmode -s -c /etc/usb-mode-rtl8156.json
  ;;
esac
```

Both files are listed in `/etc/sysupgrade.conf`. Since then, the adapter has come up as a network adapter by itself
on every boot, which means the script has not been needed yet and its automatic run at boot is still unproven. If
`eth1` ever goes missing again, `logread | grep rtl8156` shows whether it ran.

## From SD Card to SSD

### Why the default layout is too small

The OpenWrt image creates two small partitions on the SD Card and leaves the rest of it empty. On my 64GB card,
OpenWrt used about 170MB:

| Partition | Size | Purpose |
|---|---|---|
| `/boot` | 64MB | Firmware, kernel and boot configuration |
| `/` | 104MB (72MB free) | Root filesystem with all packages and configuration |
| Unpartitioned | ~59GB | Nothing |

For a router this is fine, since logs and temporary files live in RAM. For Docker it is not: the binaries alone
(`dockerd`, `containerd`, `runc` and the CLI) need more than the 72MB that were left, and the images and container
data should not live on an SD Card anyway. Growing the root partition by hand does not help either, because the next
firmware upgrade writes the image back with its original partition sizes.

### Upgrading the firmware with a bigger root partition

The supported way is to build the upgrade with a larger root partition. OpenWrt's upgrade tool `owut` requests a
custom image from the official build server, and `-S` sets the root partition size in MB:

```shell
root@OpenWrt:~# owut upgrade -S 1024 \
  -a "dockerd docker docker-compose luci-app-dockerman"
...
Build succeeded in 192s total =   0s in queue + 192s to build:
Image saved : /tmp/firmware.bin
Installing /tmp/firmware.bin and rebooting...
```

The help text marks this option with "DANGER: See wiki before using!", and the reason is in the upgrade script of
the Raspberry PI target (`/lib/upgrade/platform.sh`). It compares the partition table of the new image with the one
on the disk. If the layout is unchanged, it writes the partitions one at a time. If it has changed, it writes the
full image over the whole disk, including the partition table:

```shell
  if [ -n "$diff" ]; then
    get_image "$@" | dd of="/dev/$diskdev" bs=2M conv=fsync
```

Changing the root size from 104MB to 1GB is such a change. Before running it, I saved a backup of the settings
(System → Backup / Flash Firmware → Generate archive, or `sysupgrade -b`) and copied it to my PC. I was glad I did.

The image was written, and the PI booted it, but during startup the kernel found a damaged block group on the root
partition and switched it to read-only:

```text
EXT4-fs error (device mmcblk0p2): ext4_validate_block_bitmap:431: comm mkdir: bg 7 ...
Aborting journal on device mmcblk0p2-8.
EXT4-fs (mmcblk0p2): Remounting filesystem read-only
```

With a read-only `/etc`, the startup could not complete, the PI handed out no DHCP addresses, and shortly after I
could not get a working console anymore either. I do not know yet whether the write went wrong or whether the SD Card
itself is failing. Damage right after a large write is a classic sign of a failing or counterfeit card, so I will test
it with H2testw before I use it again.

Instead of reflashing the SD Card, I decided to run the whole system from the SSD, which is far more reliable than an
SD Card and was going to hold the Docker data anyway.

### Checking the SSD

Before trusting the SSD with the system, I checked its health with `smartmontools`:

```shell
root@OpenWrt:~# smartctl -H -A -d sat /dev/sda
...
SMART overall-health self-assessment test result: PASSED
...
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  5 Reallocated_Sector_Ct   0x0033   100   100   010    Pre-fail  Always       -       0
  9 Power_On_Hours          0x0032   096   096   000    Old_age   Always       -       15639
177 Wear_Leveling_Count     0x0013   097   097   000    Pre-fail  Always       -       30
187 Reported_Uncorrect      0x0032   100   100   000    Old_age   Always       -       0
199 UDMA_CRC_Error_Count    0x003e   100   100   000    Old_age   Always       -       0
```

More than 15,000 hours of power-on time, but no reallocated sectors and almost no wear. A sequential read of 2GiB took
8 seconds, about 268MB/s, which is normal for a SATA SSD behind a USB 3.0 bridge. The bridge uses the faster UAS
driver. It is worth mentioning that it does not pass TRIM commands through
(`/sys/block/sda/queue/discard_max_bytes` is 0) and reports the SSD as a spinning disk. With this much free space,
I can live with that. ASMedia bridges with the USB ID `174c:55aa` also have a history of UAS problems on the PI 4.
So far I have not seen any `uas_eh_abort_handler` errors, but if the disk ever drops off under load, switching it
to the older usb-storage driver is the known fix.

(Note: `lsusb` lists this ID as ASM1051E, ASM1053E or ASM1153, and the enclosure identifies itself as "ASMT 2115",
so I cannot say which chip it is exactly)

### Building a factory image for the SSD

A fresh installation needs a "factory" image instead of an upgrade image. I requested one from the same build server
(the Firmware Selector works as well) with a 1GB root partition and everything I had installed before, plus:

```text
dockerd docker docker-compose luci-app-dockerman
block-mount e2fsprogs parted resize2fs smartmontools owut
kmod-usb-storage-uas luci-proto-wireguard wireguard-tools
```

Before writing it to the SSD, I read the partition table straight out of the image to make sure the root partition
really is 1GB:

```text
disk id e875e867
p1 type=0xc start=8192s size=131072s (64 MiB) end=68 MiB
p2 type=0x83 start=147456s size=2097152s (1024 MiB) end=1096 MiB
```

Take note of the disk ID `e875e867`. It becomes important in a minute.

I wrote the image to the SSD from my Windows PC with Raspberry PI Imager ("Use custom", and "No" to the OS
customisation, which is meant for Raspberry PI OS). Then I removed the SD Card from the PI and plugged in the SSD.
Without an SD Card, the bootloader of the PI 4 tries USB next, and my Rev 1.4 board booted from the SSD without a
bootloader update. (Note: older PI 4 boards might need a bootloader update first. Raspberry PI Imager can write a
"Bootloader → USB Boot" SD Card for that)

The fresh image starts at `192.168.1.1` again. Restoring the backup from before the failed upgrade brought back the
LAN address, the WAN on `eth1`, the `board.d` script, `sysupgrade.conf` and even the SSH host keys:

```shell
root@OpenWrt:~# sysupgrade -r /tmp/backup-pre-docker.tar.gz
```

The backup also contains `/boot/cmdline.txt` from the old SD Card. If it still pointed to the root partition of the
SD Card, the PI would not boot anymore, so I checked it before rebooting. OpenWrt finds its root partition by the
disk ID instead of the device name, so the same line works for the SD Card and the SSD:

```shell
root@OpenWrt:~# grep -o "root=[^ ]*" /boot/cmdline.txt
root=PARTUUID=e875e867-02
```

### Adding a data partition

The SSD has 250GB, and the image uses about 1.1GB of it. I left a gap of about 3GB after the root partition in case
I need to grow it later, and gave the rest to a data partition mounted at `/opt`. This is where Docker will keep its
images and containers, as described in the Docker article (coming soon):

{{< mermaid >}}
flowchart LR
  subgraph SSD 250GB
    id1(Boot Partition - FAT - 64MB)
    id2(Root Partition - EXT4 - 1GB)
    id3(Free - ~3GB)
    id4(Data Partition - EXT4 - ~229GB - /opt)
  end
{{< /mermaid >}}

```shell
root@OpenWrt:~# parted -s /dev/sda mkpart primary ext4 4GiB 100%
root@OpenWrt:~# mkfs.ext4 -F -L docker /dev/sda3
root@OpenWrt:~# block info /dev/sda3    # shows the UUID of the new partition
root@OpenWrt:~# S=$(uci add fstab mount)
root@OpenWrt:~# uci set fstab.$S.uuid='ea17150f-7547-4469-9d9a-f509c771237b'
root@OpenWrt:~# uci set fstab.$S.target='/opt'
root@OpenWrt:~# uci set fstab.$S.options='noatime'
root@OpenWrt:~# uci set fstab.$S.enabled='1'
root@OpenWrt:~# uci commit fstab
root@OpenWrt:~# /etc/init.d/fstab enable
```

`/opt` is mounted by `fstab` (S11) early during boot, long before any service that stores data there. I chose `/opt`
because OpenWrt's Docker package already uses `/opt/docker/` as its default data directory.

The data partition can also hold a swap file. I preferred that over a swap partition in the free space, because
a new partition means another change to the partition table, and the reboot below shows what that can do. The Docker article
(coming soon) explains why I added one.

Then I rebooted, and the PI did not come back. The screen showed:

```text
[    2.186269] Waiting for root device PARTUUID=e875e867-02...
```

followed by the SSD and its three partitions, and then nothing. When `parted` rewrote the partition table to add the
third partition, it also gave the disk a new ID. Windows showed `7504CB19` instead of `E875E867`, so the kernel was
waiting for a disk that no longer existed. The fix was to plug the SSD into my PC and set the old ID with diskpart.

**Warning!**

**Diskpart is a powerful tool which can permanently destroy all data on the selected drive. Please make sure that you
are working with the correct disk number (`list disk`, and check the size). Neither tomcore.io nor the author of this
article is responsible for any data loss.**

```text
DISKPART> select disk 2

Disk 2 is now the selected disk.

DISKPART> uniqueid disk id=E875E867
```

`uniqueid` only changes the 4-byte disk ID in the master boot record. Partitions and data stay untouched. After that,
the PI booted from the SSD with `/opt` mounted. My rule from now on: after any change to the partition table, check
the disk ID before rebooting:

```shell
root@OpenWrt:~# dd if=/dev/sda bs=1 skip=440 count=4 2>/dev/null \
  | hexdump -e '1/4 "%08x\n"'
e875e867
```

### Future upgrades

Because of the upgrade script described above, future upgrades must use exactly the same root size:

```shell
root@OpenWrt:~# owut upgrade -S 1024
```

With an unchanged layout, the script writes the boot and root partitions one at a time and leaves the partition
table, and with it the data partition, alone. A different size would overwrite the whole disk. I have not run an
upgrade on the SSD yet, so this is what the script says rather than something I have seen myself. Before the first
one, I will take a fresh backup.

## Files to keep across upgrades

All the files I added outside of the uci configuration are listed in `/etc/sysupgrade.conf`, so that an upgrade
keeps them:

```shell
root@OpenWrt:~# cat /etc/sysupgrade.conf
## This file contains files and directories that should
## be preserved during an upgrade.

# /etc/example.conf
# /etc/openvpn/
/etc/board.d/03_usb_wan
/etc/hotplug.d/usb/21-rtl8156-modeswitch
/etc/usb-mode-rtl8156.json
```

`/boot/cmdline.txt` and the uci configuration (network, dhcp, firewall and fstab) are part of the backup anyway. The
Docker article will add its own files to this list.

## Summary and next steps

The PI now boots from the SSD and routes between the LAN (`10.0.0.1/24` and a /64 from the provider's IPv6 prefix)
and the USB WAN port. A 229GB data partition is mounted at `/opt` and waits for Docker.

The other parts of this series are coming soon:

- Docker: the installation, the firewall changes and a memory cap which makes
  sure the containers cannot take away the memory the router needs. The first real container will be a Git server
  with a web interface (Forgejo).
- A WireGuard server for remote access into the LAN. This requires a public IPv4 address from the provider and not
  one behind CGNAT.
- The second Wi-Fi network on VLAN 2 whose traffic leaves through a WireGuard tunnel in another country, as
  described in the article A Wi-Fi Network in Another Country.
