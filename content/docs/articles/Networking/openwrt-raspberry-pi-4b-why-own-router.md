---
weight: 4
title: "OpenWrt on a Raspberry PI 4B: Why Run Your Own Router"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: Why Run Your Own Router

{{% hint info %}}
**Status as of November 2026**, OpenWrt 25.12.5 with kernel 6.12.94 on a Raspberry PI 4B, connected to the NBN
(HFC) with Aussie Broadband. This is the introduction to the series. The setup itself starts with the
[Essentials](openwrt-raspberry-pi-4b-essentials), and
[Network Architecture](openwrt-raspberry-pi-4b-network-architecture) shows how all parts fit together.
{{% /hint %}}

Most people never think about their router. The provider sends a box, it gets plugged in, and as long as the Wi-Fi
works, nobody looks at it again. For a long time, I did the same. But over the years, the list of things I wanted
from my home network grew: reaching my files from my phone while I am away, a Git server at home, downloads which
leave the house through a VPN, and a firewall which I can actually read. A provider router offers some of this at
best, usually hidden behind menus which cannot be scripted or compared with a previous version.

This article explains why I decided to run my own router at all, what I gain and what it costs, and which features
I use or might use in the future. It also introduces OpenWrt briefly and shows how the Raspberry PI is connected,
from the NBN connection box on the wall to the LAN. If you are wondering whether this series is worth your time,
this is the place to start.

## Why not simply use the router of the provider?

A typical provider router combines several devices in one box: a modem (for some connection types), a router with
NAT and firewall, a DHCP and DNS server, a switch and a Wi-Fi access point. This is convenient, but it also means
that one device, which I do not control, decides what my network can do.

On the NBN, this is easy to change. The connection box which NBN Co installs is a separate device anyway, and the
router behind it is my choice. Aussie Broadband explicitly allows bringing your own router, so replacing it is not a
hack, it is a supported setup.

## What I gain

- **Control.** I decide which networks exist, which devices may talk to each other and what may leave the house.
  The firewall is a plain configuration file, and every change can be compared, backed up and restored.
- **Updates.** OpenWrt releases security fixes for years, and I install them when I want to. Many provider routers
  receive updates rarely, or only until the next model comes out.
- **Privacy.** No remote management by the provider, no cloud account, no telemetry. The router does exactly what
  is configured and nothing else.
- **Features.** WireGuard, VLANs, dynamic DNS, policy routing, IPv6 prefix delegation and many more come with
  OpenWrt or are one package away. What OpenWrt does not do itself can run in Docker on the same box.
- **One device for everything.** The PI is the router and a small home server at the same time. I did not want to
  run a second device with another power adapter next to it.
- **Learning.** I wanted to understand how my network actually works, and there is no better way than building it
  myself. Writing these articles forced me to look at every default before relying on it.

## What it costs

- **Time.** Everything the provider router did automatically, I now have to set up, and keep up to date. This
  series exists because I needed notes for myself.
- **I am the support desk.** If the Internet does not work, there is nobody to call except myself. The provider's
  support can only check the connection up to the NBN box.
- **A single point of failure.** If the PI fails, the whole house is offline. During one upgrade the SD card
  corrupted the root file system, which is one of the reasons the system now runs from an SSD, as described in the
  [Essentials](openwrt-raspberry-pi-4b-essentials). Keep a backup of the configuration and a spare SD card with a
  working image at hand.
- **Hardware compromises.** The PI has one Ethernet port, so the WAN needs a USB adapter, and USB network adapters
  have their own quirks (the Essentials describe the CD-ROM mode of mine). The built-in Wi-Fi of the PI is not
  suitable for a whole house, so separate access points are needed.
- **No phone port.** On HFC, a home phone plugs into the provider's router, which provides the phone port. My router
  has none. If you need a landline, you need a separate adapter or the provider's router behind yours.
- **Security is my responsibility.** A misconfigured firewall is my mistake, not the provider's. OpenWrt's defaults
  are safe, but every rule I add can open something I did not intend.

For me, the balance is clearly positive, but I would not recommend this to someone who just wants the Internet to
work and has no interest in looking behind it.

## Features I use, and features I might use

These are the features running on my router today, each with the article which describes it:

| Feature | What it does for me | Article |
|---|---|---|
| Routing, firewall, DHCP, DNS | The basics, dual stack IPv4 and IPv6 | [Essentials](openwrt-raspberry-pi-4b-essentials) |
| Docker | Runs services OpenWrt does not provide itself | [Docker](openwrt-raspberry-pi-4b-docker) |
| Dynamic DNS | A stable name for the changing public address | [Dynamic DNS with AWS Route 53](openwrt-raspberry-pi-4b-ddns-route53) |
| WireGuard | Access to the home network from my phone | [WireGuard Server](openwrt-raspberry-pi-4b-wireguard) |
| BitTorrent through a VPN | Downloads leave the house only through a VPN tunnel | [BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn) |
| Windows file share | The downloads appear as a network drive and on the TV | [A Windows File Share with ksmbd](openwrt-raspberry-pi-4b-file-share-ksmbd) |
| Git server | My own repositories with a web interface | [Gitea](openwrt-raspberry-pi-4b-gitea) |

And these are planned or worth considering, but not running yet:

| Feature | Why it might be interesting | Status |
|---|---|---|
| LibreChat | A chat interface for AI models, hosted at home | [Planned](openwrt-raspberry-pi-4b-librechat) |
| A Wi-Fi network in another country | A separate VLAN whose traffic exits through a WireGuard tunnel abroad | [Planned](wifi-network-in-another-country) |
| Guest network | Visitors get Internet, but no access to the LAN | Idea |
| Ad and tracker blocking | DNS based blocking for every device, for example with `adblock` | Idea |
| SQM (Smart Queue Management) | Keeps latency low when the upload is saturated ([bufferbloat](https://en.wikipedia.org/wiki/Bufferbloat)) | Idea |
| 4G/5G failover | A second WAN through a mobile modem when the NBN is down (`mwan3`) | Idea |

## OpenWrt in a nutshell

[OpenWrt](https://openwrt.org/) is a Linux distribution for routers and other embedded devices. It started in 2004,
when Linksys had to publish the source code of the firmware of its WRT54G router, and has grown into a project which
supports [hundreds of devices](https://openwrt.org/toh/start), from small travel routers to x86 PCs and, of course,
the Raspberry PI.

What makes it different from a general purpose distribution such as Debian or Alpine Linux, which I used before:

- **Everything a router needs is integrated.** Network interfaces, the firewall (`fw4` on top of nftables), DHCP and
  DNS (dnsmasq), IPv6 (odhcpd), WireGuard and VLANs are configured in one consistent way.
- **uci.** All configuration lives in simple text files in `/etc/config` and can be changed with the `uci` command,
  which makes it easy to document and script. Most uci blocks in this series can be copied as they are.
- **LuCI.** A web interface on top of uci, for everything I do not want to type.
- **Packages.** Since release 25.12, OpenWrt uses `apk` as package manager. Thousands of packages are available, from
  `ksmbd` to `docker`.
- **Upgrades which keep the configuration.** `sysupgrade`, or `owut` for custom images, replaces the system and keeps
  the configuration files.
- **Small.** The whole system takes a few hundred MB on disk and about 350MB of RAM on my PI, including Docker and
  its containers.

It is worth mentioning that OpenWrt is not a "set it and forget it" appliance like a provider router. It assumes that
you know what a subnet or a firewall zone is. If not, the Terms section in
[Network Architecture](openwrt-raspberry-pi-4b-network-architecture) is a good starting point.

## The hardware and how it is connected

{{< mermaid >}}
flowchart LR
  coax(("Coax outlet<br/>NBN HFC")) --- ntd["NBN connection box<br/>(HFC NTD)"]
  ntd ---|"Ethernet<br/>1 Gbit/s"| ad["RTL8156 USB<br/>2.5G adapter"]
  ad ---|"USB 3.0<br/>eth1 = WAN"| pi["Raspberry PI 4B<br/>8GB - OpenWrt"]
  ssd[("SSD in USB 3.0<br/>enclosure")] ---|"USB 3.0<br/>boot, root, /opt"| pi
  psu["USB-C power<br/>supply"] --- pi
  pi ---|"eth0 = LAN<br/>built-in, 1 Gbit/s"| sw["Switch"]
  sw --- ap["Wi-Fi<br/>access points"]
  sw --- pc["PC"]
  sw --- nas["NAS"]
  sw --- tv["TV"]
{{< /mermaid >}}

| Connection | Port on the PI | Device | Link speed |
|---|---|---|---|
| WAN | Blue USB 3.0 port | Realtek RTL8156 USB 2.5G Ethernet adapter, cable to the NBN connection box | 1000 Mbit/s |
| LAN | Built-in Gigabit Ethernet | Switch with the access points, PC, NAS and TV | 1000 Mbit/s |
| Storage | Second blue USB 3.0 port | Samsung 840 EVO 250GB SATA SSD in an ASMedia USB 3.0 enclosure | - |
| Power | USB-C | Power supply for the PI | - |

The USB adapter supports 2.5 Gbit/s, but the link to the NBN connection box comes up with 1000 Mbit/s, so the extra
speed is not used today. I chose the adapter because of its Realtek chip, as explained in my article about
[USB network performance](/docs/articles/RaspberryPI/raspberry-pi-4b-usb-network-performance/), and it leaves room
for faster plans. Please note, the WAN adapter and the SSD share the USB 3.0 controller of the PI and its single
interrupt on CPU0. The [Essentials](openwrt-raspberry-pi-4b-essentials) go into the details of each part.

The Wi-Fi of the PI (`wlan0`) is not in use. A PI in the corner of a room cannot cover a whole house, and dedicated
access points behind the switch do a much better job. This also keeps the router out of the Wi-Fi business
entirely: the access points only bridge Wi-Fi to Ethernet, and all routing and firewalling happens on the PI.

## The NBN connection box

In Australia, the last part of the Internet connection belongs to [NBN Co](https://www.nbnco.com.au/), not to the
provider. Depending on the [connection type](https://en.wikipedia.org/wiki/National_Broadband_Network) of the house,
this is fibre to the premises (FTTP), fibre to the node or curb (FTTN, FTTC), fixed wireless or, in my case, the coax
cable of the former cable TV network (HFC, Hybrid Fibre Coaxial).

For HFC, NBN Co installs a connection box, also called NTD (Network Termination Device). It is a cable modem which
converts the signal on the coax cable to Ethernet. What it offers is deliberately little:

- **An Ethernet port** for the router. This is the hand-over point between NBN Co and the provider.
- **Status lights** for power, the cable connection and the Ethernet link.
- **No routing, no NAT, no firewall, no Wi-Fi, no DHCP server for the LAN.** It works like a bridge: the router
  behind it talks directly to the provider's network.

This makes the NBN ideal for a self-built router. There is no provider modem in router mode which would have to be
switched to bridge mode, and no double NAT. The PI gets the public IPv4 address and the IPv6 prefix itself.

(Note: for FTTN and FTTB connections, the NBN does not supply a modem, and a VDSL modem is needed in front of the
router. FTTP and FTTC have their own connection boxes which work similarly to the HFC box. I can only speak for HFC)

## Aussie Broadband: plain DHCP, no PPPoE

Many providers in the world, and some in Australia, require [PPPoE](https://en.wikipedia.org/wiki/PPPoE): the router
logs in with a user name and a password, and the WAN appears as a separate interface (`pppoe-wan` in OpenWrt, `ppp0`
on many other systems).
Some also require a VLAN tag on the WAN.

Aussie Broadband needs none of this. The connection is identified by the NBN service itself, so the router simply asks
for an address via [DHCP](https://en.wikipedia.org/wiki/Dynamic_Host_Configuration_Protocol) and for an IPv6 prefix
via DHCPv6, directly on the Ethernet interface. This is exactly the default WAN configuration of OpenWrt, I only had
to point it to the USB adapter:

```text
root@router:~# uci show network.wan
network.wan=interface
network.wan.device='eth1'
network.wan.proto='dhcp'
root@router:~# uci show network.wan6
network.wan6=interface
network.wan6.device='eth1'
network.wan6.proto='dhcpv6'
network.wan6.reqaddress='try'
network.wan6.reqprefix='auto'
```

No user name, no password, no VLAN. The provider hands out a public IPv4 address with a lease time of 30 minutes,
which the router renews in the background, and a `/48` IPv6 prefix:

```text
root@router:~# ifstatus wan | jsonfilter -e '@.data.leasetime'
1800
root@router:~# ifstatus wan6 | jsonfilter -e '@["ipv6-prefix"][*].mask'
48
```

The address is not guaranteed to stay the same, which is why I keep a name for it up to date with
[Dynamic DNS](openwrt-raspberry-pi-4b-ddns-route53).

(Note: at the time of this writing, Aussie Broadband places new customers behind
[CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT) by default, which means the router gets a shared address
from `100.64.0.0/10` instead of a public one. Opting out is possible in their app or through support. Without a
public IPv4 address, WireGuard and everything else which must be reachable from the Internet would only work over
IPv6)

## Summary

Running my own router costs time and makes me responsible for my own network, but in return I get a firewall I
understand, current security updates and features no provider router offered me. On the NBN with Aussie Broadband, the
setup is particularly simple: the connection box is a plain bridge and the WAN is plain DHCP, so a Raspberry PI 4B
with a USB network adapter and OpenWrt is all it takes. How to install and secure it is described in the
[Essentials](openwrt-raspberry-pi-4b-essentials).
