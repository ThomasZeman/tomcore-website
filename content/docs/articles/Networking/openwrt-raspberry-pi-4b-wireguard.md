---
weight: 9
title: "OpenWrt on a Raspberry PI 4B: WireGuard Server"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: WireGuard Server

{{% hint info %}}
**Set up and tested in November 2026** on OpenWrt 25.12.5 with kernel 6.12.94 and wireguard-tools 1.0.20260223. This
part of the series builds on the Essentials and the Dynamic DNS article.
{{% /hint %}}

In [OpenWrt on a Raspberry PI 4B: Essentials](openwrt-raspberry-pi-4b-essentials) I described the router itself, its
IPv6 setup and the firewall defaults. If you haven't read that article yet, I suggest doing so first, because this
one builds on it, in particular on the section about IPv6. The name the clients connect to comes from
[OpenWrt on a Raspberry PI 4B: Dynamic DNS with AWS Route 53](openwrt-raspberry-pi-4b-ddns-route53), which keeps an
A and an AAAA record pointed at the router's current addresses.

This part adds a [WireGuard](https://www.wireguard.com/) server to the router, so that my phone and laptop can reach
the LAN from anywhere and use my home connection to the internet, for example on a public Wi-Fi. A server like this
must be reachable from the internet, which requires a public IPv4 address and not one behind
[CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT). My provider hands out a public IPv4 address and a /48 IPv6
prefix directly to the router's WAN port, and there is no other router in front of it, so there is no port forwarding
to set up anywhere else. The [WAN](https://en.wikipedia.org/wiki/Wide_area_network) port, `eth1` on my PI, is the
side of the router that faces the provider and the internet, as opposed to the LAN port that faces my devices at
home. The addresses on it are the router's WAN addresses, and they are the only addresses of my home that the
internet ever sees.

(Note: as in the Dynamic DNS article, `home.example.com` stands for the real name of the router, and `192.0.2.45`
and `2001:db8:ffff:1::2a` for its WAN addresses. As in the Essentials article, I replaced the delegated prefix with
`2001:db8:1234::/48` and the ULA prefix with `fd12:3456:789a::/48`, and removed all keys from the output)

## What OpenWrt offers

Everything needed was already part of the firmware image built in the Essentials article:

```text
kmod-wireguard wireguard-tools luci-proto-wireguard qrencode
```

`kmod-wireguard` is the kernel module, `wireguard-tools` provides the `wg` command and `luci-proto-wireguard` adds
WireGuard as a protocol to the interfaces in the web interface. It is worth mentioning that WireGuard on OpenWrt is
not a separate service with its own configuration file. A WireGuard server is just an interface in
`/etc/config/network`, and each client, a peer in WireGuard terms, is a section of that file as well. Once the
package is installed, the web interface (Network → Interfaces) can create such an interface, and it offers two
ways to add a client to it:

- **The router creates the configuration for the client.** On a new peer, the router generates the client's keys
  with **Generate new key pair** and **Generate preshared key**. **Generate configuration…** then turns them into a
  complete client configuration, as a QR code for the WireGuard app on a phone or as a file to download for a laptop.
  This is the way I use, and it is described in this article.
- **The router reads an existing client configuration.** If a client already has a configuration, for example one
  created in the WireGuard app, **Import configuration as peer…** creates the peer out of it, so nothing has to be
  typed in by hand.

Apart from that, Status → WireGuard shows all peers with their latest handshake and the transferred data. That is
all there is. There is no user management and no portal where a user could create their own access. For a handful of
my own devices, I do not need any of that.

### Where the client's private key lives

A client configuration contains the client's private key. So the router can only generate the QR code if it stores
that key with the peer in `/etc/config/network`, and I keep it there. That way, I can show the QR code again at any
time, for example for a new phone. The router holds its own private key anyway, and anybody who has access to the
router or its backups can do much worse things than impersonating my phone. Please note, this makes the
configuration backups secret, and I treat them accordingly.

(Note: the key can also be deleted from the router once the client is set up, as the help text of the field
suggests, or generated on the client so that the router only ever sees the public key. Either way, the QR code cannot
be generated anymore. For setups other than mine, the
[OpenWrt WireGuard documentation](https://openwrt.org/docs/guide-user/services/vpn/wireguard/start) is the place to
start)

## Addresses

In order to get a better understanding of where the tunnel fits in, this is the whole picture: the router with its
three networks, the LAN behind it, and the phone somewhere on a mobile network:

{{< mermaid >}}
flowchart TB
  subgraph away["Away from home"]
    phone["Phone<br/>in the tunnel:<br/>10.0.1.2<br/>fd12:3456:789a:ff::2"]
  end
  phone ---|"mobile network"| inet(("Internet"))
  inet --- modem["NBN HFC modem<br/>(bridge only)"]
  modem ---|"eth1 - WAN<br/>192.0.2.45<br/>2001:db8:ffff:1::2a/128"| fw
  subgraph pi["Raspberry PI 4B - OpenWrt"]
    direction LR
    wg0["wg0 - zone vpn<br/>10.0.1.1/24<br/>fd12:3456:789a:ff::1/64"]
    fw["Routing,<br/>firewall, NAT"]
    docker0["docker0 - zone docker<br/>172.17.0.1/16<br/>no IPv6"]
    wg0 --- fw
    fw --- docker0
  end
  fw ---|"eth0 - br-lan - zone lan<br/>10.0.0.1/24<br/>2001:db8:1234::1/64<br/>fd12:3456:789a::1/64"| lan
  subgraph home["LAN"]
    lan["PC, TV, ...<br/>10.0.0.100 - 10.0.0.249<br/>2001:db8:1234::/64<br/>fd12:3456:789a::/64"]
  end
  phone -. "WireGuard tunnel<br/>UDP 51820 to home.example.com" .-> wg0
{{< /mermaid >}}

| Network | Where | IPv4 | IPv6 |
|---|---|---|---|
| WAN | `eth1`, the link to the provider | `192.0.2.45`, public, by DHCP | `2001:db8:ffff:1::2a/128`, public, by DHCPv6 |
| Delegated prefix | Handed to the router by the provider | - | `2001:db8:1234::/48`, public |
| LAN | `br-lan` on `eth0`, and every device behind it | `10.0.0.0/24`, devices get `.100` to `.249` by DHCP | `2001:db8:1234::/64` out of the delegated prefix, plus `fd12:3456:789a::/64` (ULA) |
| Docker | `docker0`, inside the router | `172.17.0.0/16` | none |
| Tunnel | `wg0`, inside the router | `10.0.1.0/24` | `fd12:3456:789a:ff::/64` (ULA) |

The phone's own address on the mobile network does not matter and is often behind the provider's
[CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT). The phone
only needs to reach `home.example.com`, which resolves to the two WAN addresses, on UDP port 51820. Inside the tunnel,
it uses its tunnel addresses, and everything it sends to the internet leaves the router with the WAN addresses
`192.0.2.45` and `2001:db8:ffff:1::2a`, exactly like the traffic from the LAN.

The tunnel is a network of its own, next to the LAN, and I gave it addresses that do not collide with anything else
on the router:

| | IPv4 | IPv6 |
|---|---|---|
| Tunnel network | `10.0.1.0/24` | `fd12:3456:789a:ff::/64` |
| Router | `10.0.1.1` | `fd12:3456:789a:ff::1` |
| Phone | `10.0.1.2` | `fd12:3456:789a:ff::2` |

The IPv4 addresses simply follow the LAN: `10.0.0.0/24` is the LAN, so `10.0.1.0/24` is the next network, with the
router at `.1` and the phone at `.2`. The IPv6 addresses need a little more explanation. They come from the router's
[Unique Local Address](https://en.wikipedia.org/wiki/Unique_local_address) (ULA) prefix, the IPv6 counterpart of a
private IPv4 range. As described in the Essentials article, OpenWrt generated this prefix randomly at the first boot
and it never changes:

```shell
root@OpenWrt:~# uci get network.globals.ula_prefix
fd12:3456:789a::/48
```

A /48 prefix fixes the first three groups of the address, and the fourth group selects one of 65,536 networks of /64
each. The LAN uses network `0`, which is `fd12:3456:789a::/64` (the zeros are omitted), and I picked network `ff` for
the tunnel, which is `fd12:3456:789a:ff::/64`. That keeps it well away from the low numbers OpenWrt hands out to new
interfaces with `ip6assign`, such as a VLAN later on. Within the tunnel network, the router gets `::1` and the phone
`::2`, the same last numbers as in IPv4.

I took this /64 out of the ULA prefix rather than out of the provider's /48. The latter would be the cleaner
solution in theory, since the phone would get a real public IPv6 address. But the client configuration contains a
fixed address, and as described in the Essentials article, the provider can hand out a different prefix after a
reconnect. The ULA prefix never changes.

The price for this is NAT for IPv6. As shown in the Essentials article, the router's default routes to the internet
only apply to packets with a source address out of the provider's prefix, and a ULA address has no way out. So the
firewall has to translate the tunnel's ULA addresses to the router's public IPv6 address, the same way it does for
IPv4. NAT for IPv6 is frowned upon, and rightly so in the LAN, but for a handful of road warrior clients that use
the tunnel to get out to the internet, I do not see a disadvantage.

## The interface and the first peer

### The interface

The WireGuard server is an interface like the LAN and the WAN, and it is created in the same place:

1. Network → Interfaces → **Add new interface…**
2. Name `wg0`, protocol **WireGuard VPN**, then **Create interface**.
3. In the tab **General Settings**, **Generate new key pair** fills in the private and the public key of the router.
   The listen port is `51820`, and the IP addresses are `10.0.1.1/24` and `fd12:3456:789a:ff::1/64` from the table
   above.
4. In the tab **Firewall Settings**, I typed `vpn` into **Create / Assign firewall-zone** to create a new zone for the
   tunnel. The zone itself is the topic of the next section.

### The first peer

Each client is a peer in the tab **Peers** of the same dialog. **Add peer** opens the dialog for it:

| Field | Value |
|---|---|
| Description | `phone` |
| Public Key, Private Key | **Generate new key pair**. The private key stays on the router, as described above |
| Preshared Key | **Generate preshared key** |
| Allowed IPs | `10.0.1.2/32` and `fd12:3456:789a:ff::2/128` |
| Route Allowed IPs | Off |
| Endpoint Host, Endpoint Port | Empty |
| Persistent Keep Alive | `25` |

A few notes on these fields, since some of them do not mean what their names suggest:

- **Allowed IPs** on the router are not the addresses the phone may reach. They are the addresses the phone may use
  inside the tunnel, a /32 and a /128 per peer. LuCI also copies them into the client configuration as the phone's
  own addresses, so they must be filled in before the configuration is generated. Otherwise, the configuration has
  no address, and the WireGuard app refuses to start the tunnel with "at least one address must be specified".
- **Route Allowed IPs** is not needed, since the addresses are already part of the tunnel network.
- **Endpoint Host and Endpoint Port** are where the router would find the peer. The router does not know in advance
  where the phone will connect from, and WireGuard learns it from the first handshake. So both stay empty, in
  particular the port, because LuCI writes it into the client configuration as its `ListenPort`, which pins the
  phone to a fixed port.
- **The preshared key** is optional. It adds a second, symmetric key to the handshake as protection against a future
  quantum computer breaking the public key cryptography.
- **Persistent Keep Alive** is not needed on the router either, but LuCI copies it into the client configuration,
  where it keeps the connection alive through the NAT of a mobile network.

After **Save** in both dialogs and **Save & Apply** on the Interfaces page, the interface is up.

**Warning!**

**Changes to peers only take effect after the interface is restarted (Restart on `wg0`). "Save & Apply" alone is not
enough. This applies in particular to new keys. The router keeps using the old key, and it silently ignores every
handshake from a client which already has the new one.**

I ran into exactly this. I generated a new key pair for the phone, imported it, and the phone kept sending handshakes
which never got an answer. The section about troubleshooting below shows how to spot this on the router.

### On the command line

The same on the command line, for example to set up the next router quickly. `umask go=` makes sure nobody but root
can read the keys while they are in the shell:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# PEER_KEY=$(wg genkey)
root@OpenWrt:~# uci batch <<EOF
set network.wg0=interface
set network.wg0.proto='wireguard'
set network.wg0.private_key='$(wg genkey)'
set network.wg0.listen_port='51820'
add_list network.wg0.addresses='10.0.1.1/24'
add_list network.wg0.addresses='fd12:3456:789a:ff::1/64'
set network.phone=wireguard_wg0
set network.phone.description='phone'
set network.phone.private_key='$PEER_KEY'
set network.phone.public_key='$(echo "$PEER_KEY" | wg pubkey)'
set network.phone.preshared_key='$(wg genpsk)'
add_list network.phone.allowed_ips='10.0.1.2/32'
add_list network.phone.allowed_ips='fd12:3456:789a:ff::2/128'
set network.phone.persistent_keepalive='25'
EOF
root@OpenWrt:~# uci commit network
root@OpenWrt:~# service network reload
```

The section type `wireguard_wg0` is what makes a section a peer of the interface `wg0`. Unlike changes to an
existing peer, a new interface comes up with its peers on `service network reload`.

## Firewall

The OpenWrt wiki puts the WireGuard interface into the `lan` zone. I gave it a zone of its own instead, so that what
the VPN clients may reach is written down explicitly and can be restricted later. Three things are needed: the zone,
a rule that lets the clients in from the internet, and NAT for IPv6.

### The zone

A zone created from the interface dialog takes the firewall's defaults, which reject everything into the router and
everything forwarded. In Network → Firewall → **General Settings**, **Edit** on the zone `vpn`:

| Field | Value |
|---|---|
| Input | accept |
| Output | accept |
| Intra zone forward | reject |
| Covered networks | `wg0` (already set by the interface dialog) |
| Allow forward to destination zones | `lan` and `wan` |

So the clients may reach the router, the LAN and the internet, but nothing can be forwarded into the tunnel from
elsewhere. Input must be accepted, because the router is the DNS server of the clients. For IPv4, the `wan` zone
already masquerades everything that leaves through it (IPv4 Masquerading), including the tunnel.

Please note, `lan` and `wan` do not include the services which run in Docker networks with zones of their own. From
the tunnel, those need rules of their own, which are optional and described in the respective articles:
`Allow-Torrent-WebUI-VPN` in the [BitTorrent article](openwrt-raspberry-pi-4b-bittorrent-vpn),
`Allow-Gitea-Web-VPN` and `Allow-Gitea-SSH-VPN` in the [Gitea article](openwrt-raspberry-pi-4b-gitea), and
`Allow-Chat-WebUI-VPN` in the [article about LibreChat](openwrt-raspberry-pi-4b-librechat).

### Opening the port

The rule which opens the router to the internet is a single one. In Network → Firewall → **Traffic Rules**, **Add**:

| Field | Value |
|---|---|
| Name | `Allow-WireGuard` |
| Protocol | UDP |
| Source zone | `wan` |
| Destination zone | Device (input), the router itself |
| Destination port | `51820` |
| Action | accept |

"Restrict to address family" stays at "IPv4 and IPv6", so the rule applies to both. It is worth mentioning that
WireGuard does not answer at all to a packet that is not signed with a known key. A port scan gets no answer from
this port, which makes it look like a filtered port rather than a service.

### NAT for IPv6

The `wan` zone also has an option "IPv6 Masquerading", but it would translate the whole LAN as well, which is exactly
what I do not want. And restricting it to the tunnel with "Restrict Masquerading to given source subnets" would
restrict the masquerading for IPv4 as well. A NAT rule limited to the tunnel's addresses does the job instead. In
Network → Firewall → **NAT Rules**, **Add**:

| Field | Value |
|---|---|
| Name | `Masquerade-VPN-IPv6` |
| Restrict to address family | IPv6 only |
| Outbound zone | `wan` |
| Source address | `fd12:3456:789a:ff::/64` |
| Action | MASQUERADE - Automatically rewrite to outbound interface IP |

The generated nftables rules show that the translation only applies to the tunnel and only on the WAN port:

```shell
root@OpenWrt:~# nft list chain inet fw4 srcnat_wan
table inet fw4 {
  chain srcnat_wan {
    ip6 saddr fd12:3456:789a:ff::/64 counter packets 0 bytes 0 masquerade comment "!fw4: Masquerade-VPN-IPv6"
    meta nfproto ipv4 masquerade comment "!fw4: Masquerade IPv4 wan traffic"
  }
}
```

### On the command line

The same on the command line. The zone gets its own section name here, which the interface dialog does not do, but
it does not make a difference:

```shell
root@OpenWrt:~# uci batch <<EOF
set firewall.vpn=zone
set firewall.vpn.name='vpn'
add_list firewall.vpn.network='wg0'
set firewall.vpn.input='ACCEPT'
set firewall.vpn.output='ACCEPT'
set firewall.vpn.forward='REJECT'
set firewall.vpn_lan=forwarding
set firewall.vpn_lan.src='vpn'
set firewall.vpn_lan.dest='lan'
set firewall.vpn_wan=forwarding
set firewall.vpn_wan.src='vpn'
set firewall.vpn_wan.dest='wan'
set firewall.wg=rule
set firewall.wg.name='Allow-WireGuard'
set firewall.wg.src='wan'
set firewall.wg.proto='udp'
set firewall.wg.dest_port='51820'
set firewall.wg.target='ACCEPT'
set firewall.vpn_nat6=nat
set firewall.vpn_nat6.name='Masquerade-VPN-IPv6'
set firewall.vpn_nat6.family='ipv6'
set firewall.vpn_nat6.src='wan'
set firewall.vpn_nat6.src_ip='fd12:3456:789a:ff::/64'
set firewall.vpn_nat6.target='MASQUERADE'
EOF
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
```

(Note: in a `nat` section, `src` is the zone the packets leave through, not the one they come from)

## Checking it on the router

After the reload, the interface is up with both addresses and listens on port 51820:

```shell
root@OpenWrt:~# wg show wg0
interface: wg0
  public key: (hidden)
  private key: (hidden)
  listening port: 51820

peer: (hidden)
  preshared key: (hidden)
  allowed ips: 10.0.1.2/32, fd12:3456:789a:ff::2/128
  persistent keepalive: every 25 seconds
root@OpenWrt:~# ip addr show wg0 | grep inet
    inet 10.0.1.1/24 brd 10.0.1.255 scope global wg0
    inet6 fd12:3456:789a:ff::1/64 scope global
```

The peer has no `endpoint` and no `latest handshake` yet, since no client has connected so far.

## Connecting the phone

The QR code is a little hidden. It is not on the interface itself, but in the edit dialog of each peer:

1. Network → Interfaces, then **Edit** on `wg0`.
2. The **Peers** tab, then **Edit** on the peer `phone`.
3. At the very bottom of the peer dialog, the field "Configuration Export" has the button **Generate configuration…**.

The button is greyed out if the router does not store the private key of the peer, as described above. It opens a
dialog with the QR code and the configuration in plain text next to it. The configuration is built from the fields of
the peer as they are shown in the dialog, so they must be filled in first, as described in the section about the
first peer.

It is worth mentioning that LuCI keeps changes which were saved in a dialog but not yet applied for each login
session, and it shows them as if they were already in effect. They are not visible in `uci changes` on the command
line either, since that one only shows the changes of the shell. In my case, an earlier attempt had left such a
change behind: it deleted the peer `phone` and added a new peer which had nothing but a key pair. The peer list
showed only the new peer, and the configuration generated from it had no `Address`, no `PresharedKey` and no
`PersistentKeepAlive`. The WireGuard app then refused the tunnel with "at least one address must be specified". So
before generating a configuration, I check two things:

1. **Unsaved Changes** at the top right of LuCI shows no changes I do not know about. If it does, **Revert** throws
   them away. "Save & Apply" would make them permanent.
2. The peer is a saved one, and its Allowed IPs are filled in. **Add peer** followed by **Generate configuration…**
   produces a configuration without any warning, but it lacks everything that was not entered before.

These are the defaults the dialog fills in:

| Field | Default |
|---|---|
| Connection endpoint | A list to choose from: the hostnames of enabled DDNS services, the router's hostname if it contains a dot, then the WAN IPv4 and IPv6 addresses |
| Allowed IPs | `0.0.0.0/0` and `::/0`, so all traffic goes through the tunnel |
| DNS Servers | The LAN address of the router, `10.0.0.1` |
| Addresses | The `allowed_ips` of the peer |

The defaults were exactly what I wanted: all traffic through the tunnel, and the router as DNS server, so that names
in the LAN resolve on the phone as well. The router accepts DNS queries on its LAN address from the tunnel because
the `vpn` zone has `input='ACCEPT'`. Since the two DDNS services from the Dynamic DNS article are enabled, the dialog
picks their `lookup_host`, `home.example.com`, as the endpoint, and I did not have to change anything. The
generated configuration looks like this:

```text
[Interface]
PrivateKey = (hidden)
Address = 10.0.1.2/32, fd12:3456:789a:ff::2/128
# ListenPort not defined
DNS = 10.0.0.1

[Peer]
PublicKey = (hidden)
PresharedKey = (hidden)
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = home.example.com:51820
PersistentKeepAlive = 25
```

The phone needs nothing else. In the WireGuard app, "Create from QR code" imports the whole configuration.

Please note, the configuration contains the private key of the client and the preshared key, and anybody who has it
can connect to my LAN, because the endpoint is public. I do not send it by email or paste it into a chat. If that
happens anyway, **Generate new key pair** and **Generate preshared key** on the peer, followed by a restart of `wg0`,
make the old configuration worthless.

## More devices

A peer is not a user account which several devices can share. It is exactly one device. On the router, a peer
consists of three things:

1. **A public key.** It identifies the device, since only the device which has the matching private key can complete
   a handshake.
2. **The Allowed IPs.** The tunnel addresses that belong to this key.
3. **The endpoint.** The address and port the router last received a valid packet from with this key. There is only
   one endpoint per peer, and the router sends everything for the peer's tunnel addresses there.

If two devices imported the same configuration, they would have the same key and the same tunnel address. Every
handshake moves the endpoint to the device which made it, so the router sends the replies to whichever device spoke
last, and the other one receives nothing until it takes over again. At most one of them works at a time, and none of
them works reliably. Apart from that, a single device could not be locked out without locking out the others.

So every device gets a peer of its own, with its own keys and the next free addresses:

| Peer | Allowed IPs |
|---|---|
| `phone` | `10.0.1.2/32`, `fd12:3456:789a:ff::2/128` |
| `laptop` | `10.0.1.3/32`, `fd12:3456:789a:ff::3/128` |
| `tablet` | `10.0.1.4/32`, `fd12:3456:789a:ff::4/128` |

The interface, the port, the firewall zone and the NAT rules stay as they are, since they apply to the whole tunnel
network and not to a single peer. A new device needs nothing but a new peer:

1. Network → Interfaces, **Edit** on `wg0`, the **Peers** tab, **Add peer**. The fields are the same as for the
   first peer, with a description of its own, **Generate new key pair**, **Generate preshared key** and the next free
   Allowed IPs.
2. **Save** in both dialogs, **Save & Apply**, then **Restart** on `wg0`.
3. **Edit** on the new peer, **Generate configuration…**, and scan the QR code or download the file on the new device.

## Test

I tested the tunnel from the phone over the mobile network, with Wi-Fi switched off. After the restart of `wg0`
described in the warning above, the router showed the handshake within seconds:

```shell
root@OpenWrt:~# wg show wg0
interface: wg0
  public key: (hidden)
  private key: (hidden)
  listening port: 51820

peer: (hidden)
  preshared key: (hidden)
  endpoint: (hidden)
  allowed ips: 10.0.1.2/32, fd12:3456:789a:ff::2/128
  latest handshake: 1 minute, 32 seconds ago
  transfer: 1.36 MiB received, 2.95 MiB sent
  persistent keepalive: every 25 seconds
```

The phone connected to the IPv4 address of the router. In the connection tracking table of the router, I found
about 100 IPv4 connections from `10.0.1.2` to the internet, all masqueraded to the WAN address, and 77 DNS queries
to `10.0.0.1`. So the internet and the router's DNS work through the tunnel.

Noticeably, the counter of the rule `Masquerade-VPN-IPv6` was still at 0 packets. The phone did not use IPv6 inside
the tunnel at all. My interpretation is that this is the standard address selection of
[RFC 6724](https://datatracker.ietf.org/doc/html/rfc6724): a ULA source address has a lower precedence than IPv4,
so a client which has nothing but a ULA address in the tunnel prefers IPv4 for destinations in the internet.

## Troubleshooting

These are the cases I ran into, and how they show up on the router:

| Symptom | Cause | What helps |
|---|---|---|
| The WireGuard app says "at least one address must be specified" | The configuration has no `Address`, because the peer had no Allowed IPs when it was generated | Fill in the Allowed IPs of a saved peer, check **Unsaved Changes**, generate the configuration again |
| The counter of `Allow-WireGuard` stays at 0 | No packet reaches the router. The interface does not exist, the name resolves to an old address, or the client is not connected at all | `wg show wg0`, `nslookup home.example.com`, and the tunnel status in the app |
| The counter of `Allow-WireGuard` goes up, but there is no `latest handshake` | The router does not know the key of the client, typically new keys without a restart of `wg0` | **Restart** on `wg0`, or `ifup wg0` |

The counter is in the input chain of the WAN zone:

```shell
root@OpenWrt:~# nft list chain inet fw4 input_wan | grep Allow-WireGuard
    udp dport 51820 counter packets 19 bytes 3344 accept comment "!fw4: Allow-WireGuard"
```

Whether the key the router uses is the one in the configuration can be checked as well. The first command prints
the public key of the running interface's peer, the second the saved one. If they differ, the interface was not
restarted after a change:

```shell
root@OpenWrt:~# wg show wg0 peers
root@OpenWrt:~# uci get network.phone.public_key
```

(Note: a WireGuard app may show a tunnel as active even if not a single handshake succeeded. "Latest handshake" and
the received data in the details of the tunnel are what count)

## Files to keep across upgrades

Nothing to add this time. The interface, the peers and the firewall rules are all part of the uci configuration,
which is kept across upgrades and is part of every backup. Keep in mind that this backup now contains the private
keys of the router and all peers.

## Summary and next steps

The router runs a WireGuard server on UDP port 51820 with its own firewall zone. Clients get an address from
`10.0.1.0/24` and a ULA address, may reach the LAN and the internet, and are set up by scanning a QR code from the web
interface, one peer per device. They connect to `home.example.com`, which the router keeps up to date in Route 53
itself. The two pitfalls I ran into are LuCI's unsaved changes and peer changes which need a restart of `wg0`. The
next part
of the series is the second Wi-Fi network on VLAN 2 whose traffic leaves through a WireGuard tunnel in another
country.
