---
weight: 10
title: A Wi-Fi Network in Another Country
draft: true
---
# A Wi-Fi Network in Another Country

{{% hint info %}}
**Work in progress, October 2026.** This article describes the setup I am about to build on my OpenWrt router. The
configuration below is planned but not yet tested end to end. I will update the article once everything runs and I
have verified it.
{{% /hint %}}

This article describes how I want to add a second Wi-Fi network to my home whose traffic leaves the house in another
country. Every device which joins this network, for example a TV, a games console or the phone of a guest, behaves
as if it was connected somewhere else in the world. It needs no VPN app and no configuration on the device, and as far
as the internet can tell, it is in Frankfurt (or wherever the other end of the tunnel is) and not in Sydney.

All building blocks are standard: a router running [OpenWrt](https://openwrt.org/), a
[WireGuard](https://www.wireguard.com/) tunnel and a couple of Wi-Fi access points. However, I have the impression
that not many people are aware that you can combine them like this.

The router is my Raspberry PI 4B with OpenWrt. If you haven't read how I set it up yet, I suggest starting with
[OpenWrt on a Raspberry PI 4B: Essentials](openwrt-raspberry-pi-4b-essentials).

## The idea

{{< mermaid >}}
flowchart LR
  subgraph home["Home - Sydney"]
    tv["TV, console,<br/>guest phone"] -. "Wi-Fi 'Frankfurt'<br/>(VLAN 2)" .-> ap2
    pc["Everyday<br/>devices"] -. "Wi-Fi 'Home'<br/>(untagged)" .-> ap1
    ap1["Access point 1"] --- sw
    ap2["Access point 2"] --- sw
    sw["Any switch"] ---|"untagged + VLAN 2 tagged<br/>on one cable"| router
    router["OpenWrt router"]
  end
  router -->|"WAN"| inet1(("Internet<br/>sees a Sydney IP"))
  router ==>|"WireGuard tunnel"| wgs
  subgraph remote["Remote location - Frankfurt"]
    wgs["WireGuard server"] --> inet2(("Internet<br/>sees a Frankfurt IP"))
  end
{{< /mermaid >}}

The setup consists of four parts:

1. **A [VLAN](https://en.wikipedia.org/wiki/VLAN) for the "remote" network.** The access points put every device
   which joins the "Frankfurt" Wi-Fi network on VLAN 2. Normal Wi-Fi traffic stays untagged. Both share the same
   cables and switches.
2. **A permanent WireGuard tunnel** from my router to a WireGuard server at the remote location. That can be the
   home router of a family member, a small cloud VM or a commercial VPN provider which supports WireGuard.
3. **Policy-based routing on the router.** Traffic arriving from VLAN 2 is routed into the tunnel. Everything else
   uses the normal internet connection.
4. **A firewall kill switch.** VLAN 2 may only send traffic into the tunnel. If the tunnel is down, devices on
   VLAN 2 have no internet at all instead of silently falling back to the local connection.

## Why not just use a VPN app?

- Many devices cannot run one. Smart TVs, streaming sticks, consoles and printers usually have no VPN client.
- There is no setup on the device. A guest picks the "Frankfurt" network and is done. Leaving that network turns the
  "VPN" off.
- Casting works without any tricks. When you cast from your phone to a Chromecast or smart TV, the TV fetches the
  stream itself and the phone only acts as the remote control. With a VPN app on the phone, the TV would still stream
  from the real location. With both on the "Frankfurt" network, they find each other as usual and the TV streams from
  Frankfurt.
- One tunnel serves every device, and the credentials live on the router and not on each phone.

## What you need

- **A router which runs OpenWrt.** I use a Raspberry PI 4B with a USB Ethernet adapter as the WAN port. A dedicated
  OpenWrt router such as the GL.iNet Flint 2 works the same way.
- **Access points which can map a Wi-Fi network (SSID) to a VLAN.** UniFi, Omada, OpenWrt-based access points and most
  business-grade access points can do that. I use UniFi access points managed from the UniFi Network application. The
  remote network can either get its own access point or run as a second SSID on the existing ones.
- **Any switch.** A managed switch is not required: an unmanaged switch passes the VLAN tags through unchanged. The
  access points add the tag, and the router reads it.
- **A WireGuard server at the remote location.** It must forward the traffic from the tunnel to its internet
  connection and apply [NAT](https://en.wikipedia.org/wiki/Network_address_translation) to it.

## Addresses used in this article

| Network | Where | Subnet |
|---|---|---|
| Home LAN | untagged | `10.0.0.0/24`, router `10.0.0.1` |
| Remote LAN | VLAN 2 | `10.10.0.0/24`, router `10.10.0.1` |
| WireGuard tunnel | `wgvpn` | router `10.13.37.5`, server `10.13.37.1` |

(Note: these are the same subnets and the same routing table number as in my old notes for the Alpine Linux version
of this setup, which I never finished)

## Step 1: The access points

In the UniFi Network application:

1. **Create a network for VLAN 2.** Under Settings → Networks, create a new network with VLAN ID 2. Since the router
   is not a UniFi gateway, choose the third-party gateway or "VLAN only" option (the label depends on the version of
   the UniFi Network application). UniFi then only tags the traffic and leaves DHCP and routing to OpenWrt.
2. **Create the Wi-Fi network.** Under Settings → WiFi, create an SSID such as "Frankfurt" and assign it to the VLAN 2
   network. In order to broadcast it from only one access point, restrict the SSID to that access point or to an
   access point group.

It is worth mentioning that the access points keep broadcasting with this configuration even when the UniFi Network
application is not running. It is only needed to make changes.

## Step 2: VLAN 2 on the router

The LAN port of the router carries both networks. Turn on VLAN filtering on the LAN bridge, keep VLAN 1 untagged for
the home LAN and add VLAN 2 tagged:

```shell
# the br-lan device; check with: uci show network | grep br-lan
uci set network.@device[0].vlan_filtering='1'
uci add network bridge-vlan
uci set network.@bridge-vlan[-1].device='br-lan'
uci set network.@bridge-vlan[-1].vlan='1'
uci add_list network.@bridge-vlan[-1].ports='eth0:u*'
uci add network bridge-vlan
uci set network.@bridge-vlan[-1].device='br-lan'
uci set network.@bridge-vlan[-1].vlan='2'
uci add_list network.@bridge-vlan[-1].ports='eth0:t'
uci set network.lan.device='br-lan.1'
uci set network.lan2=interface
uci set network.lan2.proto='static'
uci set network.lan2.device='br-lan.2'
uci set network.lan2.ipaddr='10.10.0.1/24'
```

## Step 3: The WireGuard tunnel

Fill in the keys and the address of the WireGuard server:

```shell
uci set network.wgvpn=interface
uci set network.wgvpn.proto='wireguard'
uci set network.wgvpn.private_key='<ROUTER_PRIVATE_KEY>'
uci add_list network.wgvpn.addresses='10.13.37.5/32'
uci add network wireguard_wgvpn
uci set network.@wireguard_wgvpn[-1].public_key='<SERVER_PUBLIC_KEY>'
uci set network.@wireguard_wgvpn[-1].endpoint_host='<SERVER_HOST>'
uci set network.@wireguard_wgvpn[-1].endpoint_port='51820'
uci add_list network.@wireguard_wgvpn[-1].allowed_ips='0.0.0.0/0'
uci set network.@wireguard_wgvpn[-1].route_allowed_ips='0'
uci set network.@wireguard_wgvpn[-1].persistent_keepalive='25'
```

Please note, `route_allowed_ips='0'` is important. Without it, the tunnel becomes the default route for the whole
router, and every device in the house ends up in Frankfurt.

## Step 4: Route VLAN 2 into the tunnel

Create a separate routing table (1701) whose only default route is the tunnel, and a rule which sends everything
*arriving from* VLAN 2 to that table:

```shell
uci add network route
uci set network.@route[-1].interface='wgvpn'
uci set network.@route[-1].target='0.0.0.0/0'
uci set network.@route[-1].table='1701'
uci add network rule
uci set network.@rule[-1].in='lan2'
uci set network.@rule[-1].lookup='1701'
uci commit network
```

The rule matches on the incoming interface and not on the source subnet (`from 10.10.0.0/24`), which is what I used
in my old Alpine notes. The reason is that the router's own replies to devices on VLAN 2, such as DHCP answers, come
from `10.10.0.1`. That address is inside the subnet, so a `from` rule would send those replies into the tunnel as
well.

## Step 5: DHCP and DNS for VLAN 2

Devices on VLAN 2 should also resolve names in Frankfurt, because many services choose a server location based on
where the DNS lookup comes from. So the DHCP server hands out a DNS server which is reached through the tunnel, for
example the DNS server of the VPN provider or a public resolver. IPv6 is turned off on this network so that no
traffic bypasses the IPv4-only tunnel:

```shell
uci set dhcp.lan2=dhcp
uci set dhcp.lan2.interface='lan2'
uci set dhcp.lan2.start='100'
uci set dhcp.lan2.limit='100'
uci set dhcp.lan2.leasetime='12h'
uci add_list dhcp.lan2.dhcp_option='6,<DNS_SERVER_IP>'
uci set dhcp.lan2.ra='disabled'
uci set dhcp.lan2.dhcpv6='disabled'
uci commit dhcp
```

## Step 6: Firewall and kill switch

There are two new firewall zones: `vpn` for the tunnel and `lan2` for the VLAN. The only forwarding allowed for
`lan2` is into `vpn`. There is no path from `lan2` to the WAN, so if the tunnel goes down, devices on VLAN 2 lose
internet access instead of leaking out through the local connection.

```shell
uci add firewall zone
uci set firewall.@zone[-1].name='vpn'
uci add_list firewall.@zone[-1].network='wgvpn'
uci set firewall.@zone[-1].input='REJECT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='REJECT'
uci set firewall.@zone[-1].masq='1'
uci set firewall.@zone[-1].mtu_fix='1'
uci add firewall zone
uci set firewall.@zone[-1].name='lan2'
uci add_list firewall.@zone[-1].network='lan2'
uci set firewall.@zone[-1].input='REJECT'
uci set firewall.@zone[-1].output='ACCEPT'
uci set firewall.@zone[-1].forward='REJECT'
uci add firewall forwarding
uci set firewall.@forwarding[-1].src='lan2'
uci set firewall.@forwarding[-1].dest='vpn'
uci add firewall rule
uci set firewall.@rule[-1].name='Allow-DHCP-lan2'
uci set firewall.@rule[-1].src='lan2'
uci set firewall.@rule[-1].proto='udp'
uci set firewall.@rule[-1].dest_port='67'
uci set firewall.@rule[-1].target='ACCEPT'
uci commit firewall
reboot
```

The `vpn` zone masquerades, so the remote server only ever sees the tunnel address of the router (`10.13.37.5`) and
needs no route back to `10.10.0.0/24`.

## Step 7: The remote side

On a Linux machine at the remote location, the WireGuard server needs IP forwarding and NAT. A minimal
`/etc/wireguard/wg0.conf` for `wg-quick` looks like this:

```ini
[Interface]
Address = 10.13.37.1/24
ListenPort = 51820
PrivateKey = <SERVER_PRIVATE_KEY>
PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -t nat -A POSTROUTING -s 10.13.37.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.13.37.0/24 -o eth0 -j MASQUERADE

[Peer]
# The home router
PublicKey = <ROUTER_PUBLIC_KEY>
AllowedIPs = 10.13.37.5/32
```

Replace `eth0` with the internet-facing interface of the server and open UDP port 51820 to it. If the remote side is
another OpenWrt router, the same is achieved with a WireGuard interface, a firewall zone with masquerading and a
forwarding from that zone to `wan`.

## Verify

These are the checks I am going to run once the setup is in place:

- `wg show` on the router shows a recent handshake.
- `ip rule` shows a rule with `iif br-lan.2 lookup 1701`.
- On a device connected to the "Frankfurt" network, [ifconfig.me](https://ifconfig.me) shows the public IP of the
  remote location. On the "Home" network, it shows my own.
- After stopping the tunnel with `ifdown wgvpn`, devices on the "Frankfurt" network lose internet access, while the
  "Home" network keeps working.

## More than one location

The pattern scales: VLAN 3, a second tunnel `wgvpn2`, routing table 1702 and a third SSID give the house a Wi-Fi
network in yet another country.

## Limitations

- **Bandwidth and latency.** The throughput is limited by the upload speed at the remote location and by how fast the
  router can encrypt WireGuard traffic. Every packet also travels to the remote location and back. Between Sydney and
  Europe, that adds roughly 250-300 ms of round-trip time.
- **The IP address is not the only location signal.** Phones also use GPS and the Wi-Fi networks they can see to
  determine their location, and some apps check those instead of the IP address.
- **Terms of service.** Some streaming services prohibit accessing content from outside their licensed region. Check
  the terms of the services you use.
