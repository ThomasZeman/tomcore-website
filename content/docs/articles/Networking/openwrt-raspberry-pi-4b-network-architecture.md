---
weight: 6
title: "OpenWrt on a Raspberry PI 4B: Network Architecture"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: Network Architecture

{{% hint info %}}
**Status as of November 2026**, OpenWrt 25.12.5 with kernel 6.12.94. This page shows the network of the router as a
whole, across all parts of the series, and I update it together with every other part. Planned parts which are not
running yet are marked as such.
{{% /hint %}}

Each part of this series describes one piece of my router: the [Essentials](openwrt-raspberry-pi-4b-essentials),
[Docker](openwrt-raspberry-pi-4b-docker), [Dynamic DNS with AWS Route 53](openwrt-raspberry-pi-4b-ddns-route53), the
[WireGuard Server](openwrt-raspberry-pi-4b-wireguard),
[BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn), the
[Windows File Share with ksmbd](openwrt-raspberry-pi-4b-file-share-ksmbd),
[LibreChat](openwrt-raspberry-pi-4b-librechat)
and [Gitea](openwrt-raspberry-pi-4b-gitea). Every one of them adds a network, a firewall zone, a rule or a name, and
after a few parts, I found it hard to keep the whole picture in my head. This page puts everything in one place: the
networks and their addresses, the firewall zones and what may pass between them, where names are resolved, which
services the router offers on which network, and a server in the LAN, in my case a NAS, including how it can be
reached through WireGuard.

It does not repeat how each piece was set up. For that, the respective article is the place to look.

(Note: as in the other parts, I replaced my real addresses: `192.0.2.45` and `2001:db8:ffff:1::2a` stand for the WAN
addresses, `2001:db8:1234::/48` for the delegated prefix, `fd12:3456:789a::/48` for the ULA prefix and
`home.example.com` for the public name of the router. The NAS is called `nas` here, at `10.0.0.10`)

## Terms

The terms below appear throughout the series. This is only a short explanation of each, as far as it matters for
this router.

- **Port and interface.** `eth0` (onboard) and `eth1` (USB adapter) are the physical network ports of the PI. OpenWrt
  builds logical interfaces on top of them, such as `lan` and `wan`, and the configuration refers to those names.
- **Bridge.** A software switch inside Linux. [Bridges](https://en.wikipedia.org/wiki/Network_bridge) connect ports
  and virtual cables so that they form one network. `br-lan` contains `eth0`, and Docker creates a bridge for each of
  its networks.
- **veth.** A virtual cable with two ends. Docker plugs one end into a container and the other into the bridge of
  its network.
- **Subnet.** A range of addresses which forms one network, written in [CIDR](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing)
  notation: `10.0.0.0/24` means `10.0.0.0` to `10.0.0.255`. Every network on the router has its own subnet.
- **Gateway.** The address a device sends everything to which is not in its own subnet. In every network of this
  router, the gateway is the router itself at `.1`.
- **WAN and LAN.** The [WAN](https://en.wikipedia.org/wiki/Wide_area_network) is the side towards the provider and
  the internet, the [LAN](https://en.wikipedia.org/wiki/Local_area_network) the side towards my devices at home.
- **Firewall zone.** OpenWrt's firewall (fw4) groups interfaces into zones and decides per zone, not per interface.
  Each zone has three policies: **input** (connections to the router itself), **output** (connections from the router)
  and **forward** (connections between interfaces of the same zone).
- **Forwarding.** Allows all connections from one zone to another, for example from `lan` to `wan`. Without a
  forwarding, nothing passes from one zone to another.
- **Traffic rule.** A narrow exception, for example "from `lan` to `gitea`, TCP port 80 on `10.0.203.2` only". I use
  rules instead of forwardings wherever a zone should get exactly one service.
- **NAT and masquerading.** [NAT](https://en.wikipedia.org/wiki/Network_address_translation) rewrites addresses.
  Masquerading replaces the private source address of outgoing packets with the router's WAN address, so that the
  whole LAN shares one public IPv4 address.
- **DNAT, port forwarding.** Destination NAT rewrites the destination. Docker uses it to make a container port
  reachable on an address of the router, such as `10.0.0.1:8080`.
- **Prefix delegation.** The provider hands the router a whole block of public IPv6 addresses (`/48`), out of which the
  router assigns one `/64` per network.
- **ULA.** A [Unique Local Address](https://en.wikipedia.org/wiki/Unique_local_address), the IPv6 counterpart of a
  private IPv4 range. It never changes, unlike the delegated prefix.
- **DHCP and SLAAC.** [DHCP](https://en.wikipedia.org/wiki/Dynamic_Host_Configuration_Protocol) hands out IPv4
  addresses, the gateway and the DNS server. For IPv6, devices build their address themselves out of the router
  advertisements (SLAAC) or ask DHCPv6.
- **DNS, dnsmasq.** [DNS](https://en.wikipedia.org/wiki/Domain_Name_System) turns names into addresses. dnsmasq is
  the DNS and DHCP server of OpenWrt. Every device which gets its address from it is known as `<name>.lan`.
- **mDNS, Avahi.** [Multicast DNS](https://en.wikipedia.org/wiki/Multicast_DNS) resolves `.local` names without a
  server: the devices ask everybody in the network at once. Avahi is the daemon which answers for the router. Multicast
  stays inside one network.
- **WireGuard, peer.** [WireGuard](https://www.wireguard.com/) is the VPN. On OpenWrt, the server is the interface
  `wg0`, and each client is a peer with its own key and its own tunnel address.
- **Docker network.** A bridge plus a subnet which Docker manages. In the default mode, Docker masquerades the
  containers' traffic and protects their addresses. In the routed mode, it does neither, and the router simply routes
  to the containers.
- **Kill switch.** A rule which only lets the VPN traffic out, so that nothing leaks if the VPN breaks down.

## The whole picture

This is the router with its networks, the devices in the LAN and the connections to the outside:

{{< mermaid >}}
flowchart TB
  phone["Phone, away from home<br/>tunnel: 10.0.1.2"]
  r53["AWS Route 53<br/>home.example.com"]
  inet(("Internet"))
  phone ---|"mobile network"| inet
  r53 --- inet
  inet --- modem["NBN HFC modem<br/>(bridge only)"]
  modem --- wan
  subgraph pi["Raspberry PI 4B - OpenWrt - router.lan"]
    wan["eth1 - zone wan<br/>192.0.2.45<br/>2001:db8:ffff:1::2a/128"]
    fw["Routing,<br/>firewall fw4, NAT"]
    wg0["wg0 - zone vpn<br/>10.0.1.1/24<br/>fd12:3456:789a:ff::1/64"]
    dk["Docker networks<br/>see the next diagram"]
    brlan["br-lan - zone lan<br/>10.0.0.1/24<br/>2001:db8:1234::1/64<br/>fd12:3456:789a::1/64"]
    wan --- fw
    fw --- wg0
    fw --- dk
    fw --- brlan
  end
  brlan ---|"eth0"| sw["Switches and<br/>Wi-Fi access points"]
  subgraph home["LAN - 10.0.0.0/24"]
    pc["PC<br/>.100 - .249 by DHCP"]
    tv["LG TV"]
    nas["NAS<br/>nas.lan - 10.0.0.10"]
  end
  sw --- pc
  sw --- tv
  sw --- nas
  phone -. "WireGuard tunnel<br/>UDP 51820" .-> wg0
  wan -. "ddns-scripts<br/>A and AAAA record" .-> r53
{{< /mermaid >}}

Docker runs on the router itself, and each of its networks is a bridge of the router with a firewall zone of its own:

{{< mermaid >}}
flowchart TB
  fw["Router: routing, firewall fw4, NAT<br/>connections from br-lan and wg0"]
  docker0["docker0 - zone docker<br/>172.17.0.1/16<br/>no containers"]
  gluetun["br-torrent - zone torrent<br/>10.0.200.0/24<br/>gluetun + qBittorrent<br/>10.0.200.2"]
  gitea["br-gitea - zone gitea<br/>10.0.203.0/24<br/>gitea<br/>10.0.203.2"]
  lc["planned<br/>br-chat, br-chatdb<br/>10.0.201.0/24, 10.0.202.0/24<br/>LibreChat, MongoDB,<br/>Meilisearch"]
  fw --- docker0
  fw --- gluetun
  fw --- gitea
  fw -.- lc
  gluetun -. "WireGuard tunnel to Proton<br/>UDP 51820, the only way out" .-> wan["eth1 - zone wan"]
  wan --- proton["ProtonVPN<br/>P2P server"]
{{< /mermaid >}}

A few things are worth pointing out:

- **The router is the only way between the networks.** The LAN, the tunnel and each Docker network are subnets of
  their own, and every packet from one to another goes through the routing and the firewall of the router.
- **Inside the LAN, the router is not involved.** The PC, the TV and the NAS are in the same subnet, so they talk to
  each other directly through the switches. The firewall of the router never sees this traffic, which means it cannot
  protect the NAS from other devices in the LAN.
- **Docker runs on the router itself.** Its bridges are interfaces of the router like `br-lan`, and the containers
  are behind them like devices behind a switch. Only `docker0` is an OpenWrt interface (`network.docker`), the other
  bridges exist only in Docker, and the firewall knows them by their device name.
- **There are two WireGuard tunnels, in opposite directions.** `wg0` is the server, the phone connects to it from
  the outside. The tunnel to Proton is a client inside the gluetun container, and the router only sees UDP packets
  to Proton's server.

## Networks and addresses

| Network | Device | IPv4 | IPv6 | Article |
|---|---|---|---|---|
| WAN | `eth1` | `192.0.2.45`, public, by DHCP | `2001:db8:ffff:1::2a/128` by DHCPv6, plus the delegated `2001:db8:1234::/48` | [Essentials](openwrt-raspberry-pi-4b-essentials) |
| LAN | `br-lan` on `eth0` | `10.0.0.0/24`, router `.1`, DHCP pool `.100` to `.249` | `2001:db8:1234::/64` and `fd12:3456:789a::/64` | [Essentials](openwrt-raspberry-pi-4b-essentials) |
| Tunnel | `wg0` | `10.0.1.0/24`, router `.1`, phone `.2` | `fd12:3456:789a:ff::/64` | [WireGuard](openwrt-raspberry-pi-4b-wireguard) |
| Docker default | `docker0` | `172.17.0.0/16`, unused | none | [Docker](openwrt-raspberry-pi-4b-docker) |
| torrent | `br-torrent` | `10.0.200.0/24`, gluetun `.2` | none | [BitTorrent](openwrt-raspberry-pi-4b-bittorrent-vpn) |
| chat (planned) | `br-chat` | `10.0.201.0/24`, LibreChat `.2` | none | [LibreChat](openwrt-raspberry-pi-4b-librechat) |
| chatdb (planned) | `br-chatdb` | `10.0.202.0/24`, internal | none | [LibreChat](openwrt-raspberry-pi-4b-librechat) |
| gitea | `br-gitea` | `10.0.203.0/24`, Gitea `.2` | none | [Gitea](openwrt-raspberry-pi-4b-gitea) |

The numbering follows a simple scheme of mine: `10.0.0.0/24` is the LAN, `10.0.1.0/24` the tunnel, and the Docker
networks start at `10.0.200.0/24` and count up. They are outside of Docker's own address pools, so Docker never hands
them out to another network. Only the LAN gets public IPv6 addresses. The tunnel uses the ULA prefix, which needs
NAT for IPv6 on the way out, and the Docker networks have no IPv6 at all, so their containers cannot leak through it.

## Firewall zones

The defaults of fw4 on my router are input reject, output accept and forward reject. They apply to everything which
no zone covers.

| Zone | Covers | Input | Output | Forward | Forwardings | Masq |
|---|---|---|---|---|---|---|
| `lan` | `lan` (`br-lan`) | accept | accept | accept | to `wan` | - |
| `wan` | `wan`, `wan6` (`eth1`) | reject | accept | drop | - | IPv4 |
| `vpn` | `wg0` | accept | accept | reject | to `lan`, to `wan` | - |
| `docker` | `docker` (`docker0`) | accept | accept | accept | to `wan` | - |
| `torrent` | device `br-torrent` | reject | accept | reject | - | - |
| `gitea` | device `br-gitea` | reject | accept | reject | - | - |
| `chat` (planned) | device `br-chat` | reject | accept | reject | - | - |
| `chatdb` (planned) | device `br-chatdb` | reject | accept | reject | - | - |

This is what may pass between the zones. The thick lines are forwardings, which allow everything, the dashed lines
are rules, which allow single ports only:

{{< mermaid >}}
flowchart TB
  vpn["vpn<br/>10.0.1.0/24"]
  lan["lan<br/>10.0.0.0/24"]
  docker["docker<br/>172.17.0.0/16"]
  torrent["torrent<br/>10.0.200.0/24"]
  gitea["gitea<br/>10.0.203.0/24"]
  wan["wan"]
  inet(("Internet"))
  vpn ==> lan
  vpn ==> wan
  lan ==> wan
  docker ==> wan
  lan -. "TCP 8080" .-> torrent
  vpn -. "TCP 8080" .-> torrent
  lan -. "TCP 80, 22" .-> gitea
  vpn -. "TCP 80, 22" .-> gitea
  torrent -. "UDP 51820 to Proton only<br/>the VPN tunnel out" .-> wan
  wan --- inet
{{< /mermaid >}}

Connections to the router itself are not in the diagram. They follow the input policy in the table above: `lan`,
`vpn` and `docker` may reach the router's services, the other zones may not, and from `wan` only WireGuard and the
rules OpenWrt ships get in. No line leaves `gitea`: it can neither reach the internet nor any other zone.

The custom rules in detail:

| Rule | From | To | What | Article |
|---|---|---|---|---|
| `Allow-WireGuard` | `wan` | router | UDP 51820, the WireGuard server | [WireGuard](openwrt-raspberry-pi-4b-wireguard) |
| `Allow-Torrent-WireGuard` | `torrent` | `wan` | UDP 51820, IPv4, the tunnel to Proton | [BitTorrent](openwrt-raspberry-pi-4b-bittorrent-vpn) |
| `Allow-Torrent-WebUI` | `lan` | `torrent` | TCP 8080 on `10.0.200.2` | [BitTorrent](openwrt-raspberry-pi-4b-bittorrent-vpn) |
| `Allow-Torrent-WebUI-VPN` | `vpn` | `torrent` | TCP 8080 on `10.0.200.2` | [BitTorrent](openwrt-raspberry-pi-4b-bittorrent-vpn) |
| `Allow-Gitea-Web` | `lan` | `gitea` | TCP 80 on `10.0.203.2` | [Gitea](openwrt-raspberry-pi-4b-gitea) |
| `Allow-Gitea-SSH` | `lan` | `gitea` | TCP 22 on `10.0.203.2` | [Gitea](openwrt-raspberry-pi-4b-gitea) |
| `Allow-Gitea-Web-VPN` | `vpn` | `gitea` | TCP 80 on `10.0.203.2` | [Gitea](openwrt-raspberry-pi-4b-gitea) |
| `Allow-Gitea-SSH-VPN` | `vpn` | `gitea` | TCP 22 on `10.0.203.2` | [Gitea](openwrt-raspberry-pi-4b-gitea) |
| `Masquerade-VPN-IPv6` | `vpn` | `wan` | NAT rule: masquerade `fd12:3456:789a:ff::/64` | [WireGuard](openwrt-raspberry-pi-4b-wireguard) |

Apart from these, the `wan` zone has the rules OpenWrt ships: `Allow-DHCP-Renew`, `Allow-Ping`, `Allow-IGMP`,
`Allow-DHCPv6`, `Allow-MLD`, the two ICMPv6 rules, and `Allow-IPSec-ESP` and `Allow-ISAKMP` towards the LAN. The
[Essentials](openwrt-raspberry-pi-4b-essentials) explain why the IPv6 ones must stay.

Please note, Docker keeps its own rules in the tables `ip filter`, `ip nat` and `ip raw`, next to fw4's table
`inet fw4`. A packet into a Docker network must pass both: Docker's rules (published ports, the protection of the
container addresses) and the zone of fw4. The [Gitea article](openwrt-raspberry-pi-4b-gitea) describes how the two
interact.

## NAT

| Where | What | Why |
|---|---|---|
| `wan`, IPv4 | Masquerading of everything leaving through `eth1` | One public IPv4 address for the LAN, the tunnel and the containers |
| `wan`, IPv6 | Masquerading of `fd12:3456:789a:ff::/64` only | The tunnel's ULA addresses have no route to the internet. The LAN keeps its public addresses |
| Docker, `torrent` | DNAT `10.0.0.1:8080` to `10.0.200.2:8080` | The web interface of qBittorrent on the router's LAN address |
| Docker, `gitea` | none, routed mode | The LAN reaches `10.0.203.2` directly, on the standard ports 80 and 22 |

## Name resolution

Names are resolved in five different places, depending on who asks and for which name:

{{< mermaid >}}
flowchart LR
  subgraph clients["Who asks"]
    lanc["Devices in the LAN"]
    phone["Phone in the tunnel"]
    gitea["gitea container"]
    gluetun["gluetun container"]
    outside["Phone on the<br/>mobile network"]
  end
  subgraph pi["Router"]
    dnsmasq["dnsmasq<br/>10.0.0.1:53, 10.0.1.1:53<br/>*.lan from the DHCP leases<br/>router.lan, nas.lan<br/>gitea.lan = 10.0.203.2<br/>torrent.lan = 10.0.0.1"]
    avahi["Avahi, mDNS<br/>router.local<br/>on br-lan only"]
    dockerdns["Docker's embedded DNS<br/>127.0.0.11"]
  end
  upstream["DNS servers<br/>of the provider"]
  gluetundns["gluetun's own resolver<br/>through the Proton tunnel"]
  r53["AWS Route 53<br/>home.example.com"]
  lanc -- "DNS, by DHCP" --> dnsmasq
  lanc -- ".local" --> avahi
  phone -- "DNS = 10.0.0.1<br/>in the client config" --> dnsmasq
  dnsmasq -- "everything else" --> upstream
  gitea --> dockerdns
  gluetun --> gluetundns
  outside -- "WireGuard endpoint" --> r53
{{< /mermaid >}}

- **dnsmasq** is the DNS server for the LAN and the tunnel. It knows every device which got its address via DHCP as
  `<name>.lan`, the router itself as `router.lan`, and two static entries: `gitea.lan` points to the container
  directly, `torrent.lan` to the router's LAN address, where Docker publishes the web interface. Everything else it
  forwards to the DNS servers of the provider. In LuCI, the static entries are in Network → DHCP and DNS →
  **Hostnames**.
- **The short name without `.lan`** only works in the LAN. DHCP hands out `lan` as the search domain, so `router` is
  completed to `router.lan`. The phone in the tunnel does not get the search domain and needs the full name.
- **Avahi** announces `router.local` and the SMB share via multicast. It only runs on `br-lan`, and multicast does not
  cross the tunnel either, so `.local` names and discovery are LAN only.
- **The containers** do not use dnsmasq. The gitea container has Docker's embedded DNS (`127.0.0.11`) for the names
  of its network, and its zone rejects input to the router anyway. gluetun brings its own resolver, which sends all
  queries through the Proton tunnel.
- **Route 53** holds the public name `home.example.com`, which ddns-scripts keeps pointed at the WAN addresses. Only
  the WireGuard clients need it, to find the router from the outside.

## Services on the router

| Service | Port | Listens on | Reachable from |
|---|---|---|---|
| dnsmasq, DNS | 53 | every interface | `lan`, `vpn`, `docker`. The other zones reject input |
| dnsmasq, DHCP | UDP 67 | `br-lan` | `lan` |
| odhcpd, DHCPv6 and router advertisements | UDP 547 | `br-lan` | `lan` |
| LuCI (uhttpd) | 80, 443 | every address | `lan`, `vpn`, `docker` |
| SSH (dropbear) | 22 | `lan` addresses | `lan`, `vpn` (the tunnel reaches the LAN address) |
| ttyd, web terminal | 7681 | `10.0.0.1` | `lan`, `vpn` |
| WireGuard server | UDP 51820 | every address | `wan` (`Allow-WireGuard`) and everybody who may send input |
| ksmbd, SMB | 445 | `br-lan`, `wg0` | `lan`, `vpn` |
| Avahi, mDNS | UDP 5353 | `br-lan` | `lan` |
| minidlna, DLNA | 8200, UDP 1900 | `br-lan` | `lan` |
| qBittorrent web interface | 8080 | `10.0.0.1`, via Docker's DNAT | `lan`, `vpn` |
| Gitea | 80, 22 | `10.0.203.2`, the container | `lan`, `vpn` |

It is worth mentioning that "listens on every interface" does not mean "reachable from everywhere". The zone policy
decides about input to the router, and the `wan` zone rejects everything except WireGuard and the shipped rules. The
other way around, the `docker` zone accepts input, but ksmbd, Avahi and minidlna do not listen on `docker0`.

## A server in the LAN: the NAS

My LAN has one server apart from the router, a NAS. It is a separate device which offers SMB shares and a web
interface for its administration (ports 80, 443, 445, 5000 and 5001 answered on mine). For the router, it is just
another device in the LAN, like the PC or the TV. The same applies to any other server which sits in the LAN, such
as a second file server, a printer or a home automation box.

### How it gets its address and name

The NAS gets its address from dnsmasq via DHCP and sends its host name with the request. dnsmasq then knows it as
`nas.lan`, without any entry on the router:

```shell
root@router:~# nslookup nas.lan 127.0.0.1
Server:    127.0.0.1
Address:  127.0.0.1:53

Name:  nas.lan
Address: 10.0.0.10
```

A server should keep its address, because firewall rules, mapped drives and bookmarks refer to it. A dynamic lease
usually stays the same as long as the device renews it, but a static lease makes sure. In LuCI, it is in Network →
DHCP and DNS → **Static Leases**, or on the command line (the MAC address is a placeholder):

```shell
root@router:~# uci batch <<EOF
set dhcp.nas=host
set dhcp.nas.name='nas'
set dhcp.nas.mac='00:11:22:33:44:55'
set dhcp.nas.ip='10.0.0.10'
EOF
root@router:~# uci commit dhcp
root@router:~# service dnsmasq reload
```

(Note: my NAS still runs with a dynamic lease. The commands above show the static lease
for the generic example, I did not run them)

### Access through WireGuard

From the router's point of view, the NAS is reachable from the tunnel already. The zone `vpn` has a forwarding to
`lan`, so a WireGuard client may open any connection to any device in the LAN, including the NAS:

{{< mermaid >}}
flowchart LR
  phone["Phone<br/>10.0.1.2"] -. "WireGuard tunnel" .-> wg0
  subgraph pi["Router"]
    wg0["wg0 - zone vpn"] -- "forwarding<br/>vpn to lan" --> brlan["br-lan - zone lan"]
    dns["dnsmasq<br/>nas.lan = 10.0.0.10"]
  end
  brlan --> nas["NAS<br/>10.0.0.10<br/>gateway 10.0.0.1"]
  phone -. "nas.lan?" .-> dns
  nas -- "reply to 10.0.1.2<br/>via its gateway" --> brlan
{{< /mermaid >}}

Three things have to be right for this to work:

1. **The name.** The phone asks dnsmasq through the tunnel, so `nas.lan` resolves to `10.0.0.10`. The short name
   `nas` does not work there, as described above, and the NAS does not show up in any discovery list, because mDNS
   and SMB discovery do not cross the tunnel.
2. **The way back.** The NAS sees the real address of the phone, `10.0.1.2`, which is not in its own subnet. It sends
   the reply to its gateway, which must be the router at `10.0.0.1`. With DHCP from the router, that is the case.
3. **The firewall of the NAS itself.** Many NAS systems have their own firewall or an option like "allow access from
   the local network only". Such a setting usually means the NAS's own subnet, `10.0.0.0/24`, and rejects
   `10.0.1.2`. The tunnel network `10.0.1.0/24`, and `fd12:3456:789a:ff::/64` for IPv6, then has to be added to the
   allowed addresses on the NAS.

I checked the first two points on the router: `nas.lan` resolves through dnsmasq, and the NAS answered both a ping
and its web interface on port 5000 when I sent them from the router's tunnel address `10.0.1.1`, so it accepts and
routes back to an address outside of its own subnet:

```shell
root@router:~# ping -c 2 -W 1 -I 10.0.1.1 10.0.0.10
PING 10.0.0.10 (10.0.0.10) from 10.0.1.1: 56 data bytes
64 bytes from 10.0.0.10: seq=0 ttl=64 time=0.264 ms
64 bytes from 10.0.0.10: seq=1 ttl=64 time=0.314 ms
...
root@router:~# curl -s -o /dev/null -w "%{http_code}\n" --interface 10.0.1.1 \
  -m 3 http://10.0.0.10:5000/
200
```

(Note: the test from the phone itself, over the mobile network, is still outstanding)

Once it works, the NAS is used through the tunnel with its full name, for example `\\nas.lan\share` in a file manager
or VLC, or `http://nas.lan:5000` for its web interface.

### Optional: only the NAS, not the whole LAN

The forwarding from `vpn` to `lan` gives the WireGuard clients the whole LAN. That is what I want for my own phone,
but for a peer with less trust, it is too much. In that case, the forwarding is replaced by a rule which only allows
the ports of the NAS, the same pattern as for Gitea and qBittorrent:

```shell
root@router:~# uci delete firewall.vpn_lan
root@router:~# uci batch <<EOF
set firewall.nas_vpn=rule
set firewall.nas_vpn.name='Allow-NAS-VPN'
set firewall.nas_vpn.src='vpn'
set firewall.nas_vpn.dest='lan'
set firewall.nas_vpn.dest_ip='10.0.0.10'
set firewall.nas_vpn.proto='tcp'
set firewall.nas_vpn.dest_port='445 5000 5001'
set firewall.nas_vpn.target='ACCEPT'
EOF
root@router:~# uci commit firewall
root@router:~# service firewall restart
```

Please note, this applies to all peers of `wg0`, since they share one zone. The services of the router itself, such
as `router.lan` for the file share and DNS, are input and not forward, so they keep working. Separate permissions per
peer would need a second WireGuard interface with a zone of its own. I did not make this change, my router still has
the forwarding.

### Optional: when the NAS cannot be told about the tunnel

If the NAS only accepts its own subnet and offers no setting to change that, the router can masquerade the
connections from the tunnel to the NAS. The NAS then sees the router's LAN address `10.0.0.1` instead of the phone:

```shell
root@router:~# uci batch <<EOF
set firewall.nas_masq=nat
set firewall.nas_masq.name='Masquerade-VPN-to-NAS'
set firewall.nas_masq.family='ipv4'
set firewall.nas_masq.src='lan'
set firewall.nas_masq.src_ip='10.0.1.0/24'
set firewall.nas_masq.dest_ip='10.0.0.10'
set firewall.nas_masq.proto='all'
set firewall.nas_masq.target='MASQUERADE'
EOF
root@router:~# uci commit firewall
root@router:~# service firewall restart
```

As with `Masquerade-VPN-IPv6`, `src` is the outbound zone, here `lan`. The disadvantage is that the NAS can no longer
tell the phone from the router, in its logs and in its own access rules. So I would only use this as a last resort.
(Note: I have not tested this rule, since my NAS did not need it)

## Summary

The router connects six networks: the WAN, the LAN, the WireGuard tunnel, Docker's default bridge, and one Docker
network each for BitTorrent and Gitea, with two more planned for LibreChat. Each of them is a firewall zone, and
apart from the LAN and the tunnel, every zone gets exactly the ports it needs and nothing more. Names are resolved by
dnsmasq for the LAN and the tunnel, and a server in the LAN, such as my NAS, is reachable through WireGuard as long as
its own firewall accepts the tunnel's addresses.
