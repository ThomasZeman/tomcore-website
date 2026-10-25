---
weight: 8
title: "OpenWrt on a Raspberry PI 4B: WireGuard Server"
draft: true
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: WireGuard Server

{{% hint info %}}
**Work in progress, October 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94 and wireguard-tools 1.0.20260223.
This is the third part of a series and describes what is running today.
{{% /hint %}}

In [OpenWrt on a Raspberry PI 4B: Essentials](openwrt-raspberry-pi-4b-essentials) I described the router itself, its
IPv6 setup and the firewall defaults. If you haven't read that article yet, I suggest doing so first, because this
one builds on it, in particular on the section about IPv6.

This part adds a [WireGuard](https://www.wireguard.com/) server to the router, so that my phone and laptop can reach
the LAN from anywhere and use my home connection to the internet, for example on a public Wi-Fi. A server like this
must be reachable from the internet, which requires a public IPv4 address and not one behind
[CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT). My provider hands out a public IPv4 address and a /48 IPv6
prefix directly to the router, and there is no other router in front of it, so there is no port forwarding to set up
anywhere else.

(Note: throughout this article, `router.example.com` stands for the hostname the clients connect to. Keeping such a
hostname up to date with a dynamic IP address is the topic of a separate article. As in the Essentials article, I
replaced the ULA prefix with `fd12:3456:789a::/48` and removed all keys from the output)

## What OpenWrt offers

Everything needed was already part of the firmware image built in the Essentials article:

```text
kmod-wireguard wireguard-tools luci-proto-wireguard qrencode
```

`kmod-wireguard` is the kernel module, `wireguard-tools` provides the `wg` command and `luci-proto-wireguard` adds
WireGuard as a protocol to the interfaces in the web interface. It is worth mentioning that WireGuard on OpenWrt is
not a separate service with its own configuration file. A WireGuard server is just an interface in
`/etc/config/network`, and each client, a peer in WireGuard terms, is a section of that file as well. Once the
package is installed, the web interface (Network → Interfaces → the WireGuard interface) offers the following:

- **Generate new key pair** for the interface itself. The key is not generated in the browser. LuCI asks the router,
  which runs `wg genkey` and `wg pubkey` (`/usr/share/rpcd/ucode/luci.wireguard`).
- **Peers** with a description, their own **Generate new key pair** and **Generate preshared key** buttons, the
  allowed IPs and the keepalive interval.
- **Generate configuration…** on each peer creates a complete configuration file for the client, both as a QR code
  for the WireGuard app on a phone and as a file to download for a laptop.
- **Import configuration as peer…** goes the other way and creates a peer from a configuration that was created on
  the client.
- **Status → WireGuard** shows all peers with their latest handshake and the transferred data.

That is all there is. There is no user management and no portal where a user could create their own access. For a
handful of my own devices, I do not need any of that.

### Where the client's private key lives

There is one thing to keep in mind with the QR code. A client configuration contains the client's private key, so
the router can only generate a QR code if it stores the private key of the peer in `/etc/config/network`. That also
means it ends up in every configuration backup. There are three ways to deal with this:

1. Generate the keys on the router, scan the QR code and keep the private key on the router. The QR code can be shown
   again at any time, for example for a new phone.
2. The same, but delete the private key of the peer after scanning. The QR code then cannot be generated anymore.
3. Generate the keys on the client and only give its public key to the router. The router never sees a private key,
   but it cannot generate a QR code either.

I chose the first option. The router already holds its own private key, and anybody who has access to the router or
its backups can do much worse things than impersonating my phone. Please note, this makes the configuration backups
secret, and I treat them accordingly.

## Addresses

The tunnel is a network of its own, next to the LAN, and I gave it addresses that do not collide with anything else
on the router (the LAN is `10.0.0.0/24`, Docker uses `172.17.0.0/16`):

| | IPv4 | IPv6 |
|---|---|---|
| Tunnel network | `10.0.1.0/24` | `fd12:3456:789a:ff::/64` |
| Router | `10.0.1.1` | `fd12:3456:789a:ff::1` |
| Phone | `10.0.1.2` | `fd12:3456:789a:ff::2` |

For IPv6, I took a /64 out of the router's own ULA prefix rather than one out of the provider's /48. The latter would
be the cleaner solution in theory, since the phone would get a real public IPv6 address. But the client
configuration contains a fixed address, and as described in the Essentials article, the provider can hand out a
different prefix after a reconnect. The ULA prefix never changes.

The price for this is NAT for IPv6. As shown in the Essentials article, the router's default routes to the internet
only apply to packets with a source address out of the provider's prefix, and a ULA address has no way out. So the
firewall has to translate the tunnel's ULA addresses to the router's public IPv6 address, the same way it does for
IPv4. NAT for IPv6 is frowned upon, and rightly so in the LAN, but for a handful of road warrior clients that use
the tunnel to get out to the internet, I do not see a disadvantage.

## The interface and the first peer

I set up the interface `wg0` and the first peer on the command line. The web interface creates exactly the same
sections. `wg genkey`, `wg pubkey` and `wg genpsk` create the keys, and `umask go=` makes sure nobody but root can
read them while they are in the shell:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# ULA=fd12:3456:789a
root@OpenWrt:~# PEER_KEY=$(wg genkey)
root@OpenWrt:~# uci set network.wg0=interface
root@OpenWrt:~# uci set network.wg0.proto='wireguard'
root@OpenWrt:~# uci set network.wg0.private_key="$(wg genkey)"
root@OpenWrt:~# uci set network.wg0.listen_port='51820'
root@OpenWrt:~# uci add_list network.wg0.addresses='10.0.1.1/24'
root@OpenWrt:~# uci add_list network.wg0.addresses="$ULA:ff::1/64"
root@OpenWrt:~# uci set network.phone=wireguard_wg0
root@OpenWrt:~# uci set network.phone.description='phone'
root@OpenWrt:~# uci set network.phone.private_key="$PEER_KEY"
root@OpenWrt:~# uci set network.phone.public_key="$(echo "$PEER_KEY" | wg pubkey)"
root@OpenWrt:~# uci set network.phone.preshared_key="$(wg genpsk)"
root@OpenWrt:~# uci add_list network.phone.allowed_ips='10.0.1.2/32'
root@OpenWrt:~# uci add_list network.phone.allowed_ips="$ULA:ff::2/128"
root@OpenWrt:~# uci set network.phone.persistent_keepalive='25'
root@OpenWrt:~# uci commit network
root@OpenWrt:~# service network reload
```

A few notes on the options:

- **The section type** `wireguard_wg0` is what makes a section a peer of the interface `wg0`.
- **`allowed_ips`** on the server side are the addresses the peer may use inside the tunnel, a /32 and a /128 per
  peer. They do not need their own routes, since they are part of the tunnel network.
- **The preshared key** is optional. It adds a second, symmetric key to the handshake as protection against a
  future quantum computer breaking the public key cryptography.
- **`persistent_keepalive`** is not needed on the server, but LuCI copies it into the client configuration, where it
  keeps the connection alive through the NAT of a mobile network.

The peer has no endpoint, because the router does not know in advance where the phone will connect from. WireGuard
learns it from the first handshake.

## Firewall

The OpenWrt wiki puts the WireGuard interface into the `lan` zone. I gave it a zone of its own instead, so that what
the VPN clients may reach is written down explicitly and can be restricted later. At the moment, they may reach the
router, the LAN and the internet, but nothing can be forwarded into the tunnel from elsewhere:

```shell
root@OpenWrt:~# uci set firewall.vpn=zone
root@OpenWrt:~# uci set firewall.vpn.name='vpn'
root@OpenWrt:~# uci add_list firewall.vpn.network='wg0'
root@OpenWrt:~# uci set firewall.vpn.input='ACCEPT'
root@OpenWrt:~# uci set firewall.vpn.output='ACCEPT'
root@OpenWrt:~# uci set firewall.vpn.forward='REJECT'
root@OpenWrt:~# uci set firewall.vpn_lan=forwarding
root@OpenWrt:~# uci set firewall.vpn_lan.src='vpn'
root@OpenWrt:~# uci set firewall.vpn_lan.dest='lan'
root@OpenWrt:~# uci set firewall.vpn_wan=forwarding
root@OpenWrt:~# uci set firewall.vpn_wan.src='vpn'
root@OpenWrt:~# uci set firewall.vpn_wan.dest='wan'
```

The rule which opens the router to the internet is a single one. It allows UDP port 51820 from the `wan` zone to the
router itself. Without a `family` option, it applies to IPv4 and IPv6:

```shell
root@OpenWrt:~# uci set firewall.wg=rule
root@OpenWrt:~# uci set firewall.wg.name='Allow-WireGuard'
root@OpenWrt:~# uci set firewall.wg.src='wan'
root@OpenWrt:~# uci set firewall.wg.proto='udp'
root@OpenWrt:~# uci set firewall.wg.dest_port='51820'
root@OpenWrt:~# uci set firewall.wg.target='ACCEPT'
```

It is worth mentioning that WireGuard does not answer at all to a packet that is not signed with a known key. A port
scan gets no answer from this port, which makes it look like a filtered port rather than a service.

For IPv4, the `wan` zone already masquerades everything that leaves through it (`masq='1'`), including the tunnel.
For IPv6, `masq6` on the zone would translate the LAN as well, which is exactly what I do not want. A `nat` section
limited to the tunnel's source addresses does the job instead:

```shell
root@OpenWrt:~# uci set firewall.vpn_nat6=nat
root@OpenWrt:~# uci set firewall.vpn_nat6.name='Masquerade-VPN-IPv6'
root@OpenWrt:~# uci set firewall.vpn_nat6.family='ipv6'
root@OpenWrt:~# uci set firewall.vpn_nat6.src='wan'
root@OpenWrt:~# uci set firewall.vpn_nat6.src_ip='fd12:3456:789a:ff::/64'
root@OpenWrt:~# uci set firewall.vpn_nat6.target='MASQUERADE'
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
```

(Note: in a `nat` section, `src` is the zone the packets leave through, not the one they come from)

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

On the peer in the web interface, **Generate configuration…** opens a dialog with the QR code and the configuration
in plain text next to it. These are the defaults it fills in:

| Field | Default |
|---|---|
| Connection endpoint | A list to choose from: the hostnames of enabled DDNS services, the router's hostname if it contains a dot, then the WAN IPv4 and IPv6 addresses |
| Allowed IPs | `0.0.0.0/0` and `::/0`, so all traffic goes through the tunnel |
| DNS Servers | The LAN address of the router, `10.0.0.1` |
| Addresses | The `allowed_ips` of the peer |

The defaults were exactly what I wanted: all traffic through the tunnel, and the router as DNS server, so that names
in the LAN resolve on the phone as well. The router accepts DNS queries on its LAN address from the tunnel because
the `vpn` zone has `input='ACCEPT'`. The only field I changed is the endpoint, which I set to `router.example.com`.
The generated configuration looks like this:

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
Endpoint = router.example.com:51820
PersistentKeepAlive = 25
```

(Note: the dialog takes the client's `ListenPort` from the peer's "Endpoint Port" field. So that field must stay
empty for a phone, otherwise the client is pinned to a fixed port)

Please note, changes to peers only take effect after the WireGuard interface is restarted. "Save & Apply" alone is
not enough.

## Test

The test from the phone over the mobile network is still outstanding and follows here.

## Files to keep across upgrades

Nothing to add this time. The interface, the peers and the firewall rules are all part of the uci configuration,
which is kept across upgrades and is part of every backup. Keep in mind that this backup now contains the private
keys of the router and all peers.

## Summary and next steps

The router runs a WireGuard server on UDP port 51820 with its own firewall zone. Clients get an address from
`10.0.1.0/24` and a ULA address, may reach the LAN and the internet, and are set up by scanning a QR code from the web
interface. The next step is keeping `router.example.com` pointed at the router's current IP address, which is the
topic of a separate article.
