---
weight: 10
title: A Wi-Fi Network in Another Country
draft: true
---
# A Wi-Fi Network in Another Country

What if your home had a second Wi-Fi network, and every device that joined it behaved as if it were
plugged in somewhere else in the world? A TV, a games console or a guest's phone connects to it like
any other Wi-Fi network. It needs no VPN app and no configuration, and as far as the internet can tell,
it is in Frankfurt (or wherever you choose), not in Sydney.

This article describes how to build that with a router running [OpenWrt](https://openwrt.org/), a
WireGuard tunnel and a couple of Wi-Fi access points. Every piece is standard, but few people realize
that you can combine them like this.

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

There are four building blocks:

1. **A VLAN for the "remote" network.** The access points put everything that joins the "Frankfurt"
   Wi-Fi network on VLAN 2. Normal Wi-Fi traffic stays untagged. Both share the same cables and switches.
2. **A permanent WireGuard tunnel** from your router to a WireGuard server at the remote location.
   That can be a family member's home router, a small cloud VM, or a commercial VPN provider that
   supports WireGuard.
3. **Policy-based routing on the router.** Traffic that arrives from VLAN 2 is routed into the tunnel.
   Everything else uses your normal internet connection.
4. **A firewall kill switch.** VLAN 2 may only send traffic into the tunnel. If the tunnel is down,
   devices on VLAN 2 have no internet at all, rather than silently falling back to your local
   connection.

## Why not just use a VPN app?

- **Many devices can't run one.** Smart TVs, streaming sticks, consoles and printers usually have no
  VPN client.
- **No setup on the device.** A guest picks the "Frankfurt" network and is done. Leaving that
  network turns the "VPN" off.
- **Casting just works.** When you cast from your phone to a Chromecast or smart TV, the TV
  fetches the stream itself; the phone only acts as the remote control. With a VPN app on the
  phone, the TV would still stream from your real location. With both on the "Frankfurt" network,
  they find each other as usual and the TV streams from Frankfurt.
- **One tunnel for every device.** Credentials live on the router, not on each phone.

## What you need

- **A router that runs OpenWrt.** I use a Raspberry Pi 4 with a USB Ethernet adapter as the WAN port.
  A dedicated OpenWrt router such as the GL.iNet Flint 2 works the same way.
- **Access points that can map a Wi-Fi network (SSID) to a VLAN.** UniFi, Omada, OpenWrt-based
  access points and most business-grade access points can. I use UniFi access points managed from
  the UniFi Network application. You can put the remote network on its own access point or add it
  as a second SSID on the access points you already have.
- **Any switch.** You don't need a managed switch: an unmanaged switch passes the VLAN tags
  through unchanged. The access points add the tag, and the router reads it.
- **A WireGuard server at the remote location.** It must forward traffic from the tunnel to its
  internet connection and apply NAT to it.

## Addresses used in this article

| Network | Where | Subnet |
|---|---|---|
| Home LAN | untagged | `10.0.0.0/24`, router `10.0.0.1` |
| Remote LAN | VLAN 2 | `10.10.0.0/24`, router `10.10.0.1` |
| WireGuard tunnel | `wgvpn` | router `10.13.37.5`, server `10.13.37.1` |

## Step 1: The access points

In the UniFi Network application:

1. **Create a network for VLAN 2.** Under **Settings → Networks**, create a new network with
   **VLAN ID 2**. Because the router isn't a UniFi gateway, choose the third-party gateway or
   "VLAN only" option (the label depends on your UniFi Network version). UniFi then only tags the
   traffic and leaves DHCP and routing to OpenWrt.
2. **Create the Wi-Fi network.** Under **Settings → WiFi**, create an SSID such as "Frankfurt" and
   assign it to the VLAN 2 network. To broadcast it from only one access point, restrict the SSID
   to that access point or to an access point group.

The access points keep broadcasting with this configuration even when the UniFi Network application
isn't running. You only need it to make changes.

## Step 2: VLAN 2 on the router

The router's LAN port carries both networks. Turn on VLAN filtering on the LAN bridge, keep VLAN 1
untagged for the home LAN, and add VLAN 2 tagged:

```shell
uci set network.@device[0].vlan_filtering='1'     # the br-lan device; check with: uci show network | grep br-lan
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

Fill in the keys and the address of your WireGuard server:

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

`route_allowed_ips='0'` matters: without it, the tunnel would become the default route for the
whole router, and every device in the house would end up in Frankfurt.

## Step 4: Route VLAN 2 into the tunnel

Create a separate routing table (1701) whose only default route is the tunnel, and a rule that
sends everything *arriving from* VLAN 2 to that table:

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

The rule matches on the incoming interface, not on the source subnet (`from 10.10.0.0/24`). The
router's own replies to VLAN 2 devices, such as DHCP answers, come from `10.10.0.1`. That address
is inside the subnet, so a `from` rule would send those replies into the tunnel as well.

## Step 5: DHCP and DNS for VLAN 2

Devices on VLAN 2 should also resolve names in Frankfurt. Many services choose a server location
based on where your DNS lookup comes from. Hand out a DNS server that is reached through the
tunnel, for example your VPN provider's DNS server or a public resolver. Turn IPv6 off on this
network so that no traffic bypasses the IPv4-only tunnel:

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

Two new zones: `vpn` for the tunnel and `lan2` for the VLAN. The only forwarding allowed for
`lan2` is into `vpn`. There is no path from `lan2` to the WAN, so if the tunnel goes down, VLAN 2
devices lose internet access instead of leaking out through your local connection.

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

The `vpn` zone masquerades, so the remote server only ever sees the router's tunnel address
`10.13.37.5` and needs no route back to `10.10.0.0/24`.

## Step 7: The remote side

On a Linux machine at the remote location, the WireGuard server needs IP forwarding and NAT. A
minimal `/etc/wireguard/wg0.conf` for `wg-quick`:

```ini
[Interface]
Address = 10.13.37.1/24
ListenPort = 51820
PrivateKey = <SERVER_PRIVATE_KEY>
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -t nat -A POSTROUTING -s 10.13.37.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.13.37.0/24 -o eth0 -j MASQUERADE

[Peer]
# The home router
PublicKey = <ROUTER_PUBLIC_KEY>
AllowedIPs = 10.13.37.5/32
```

Replace `eth0` with the server's internet-facing interface and open UDP port 51820 to it. If the
remote side is another OpenWrt router, the same thing takes a WireGuard interface, a firewall zone
with masquerading, and a forwarding from that zone to `wan`.

## Verify

- `wg show` on the router shows a recent handshake.
- `ip rule` shows a rule with `iif br-lan.2 lookup 1701`.
- On a device connected to the "Frankfurt" network, [ifconfig.me](https://ifconfig.me) shows the
  remote location's public IP. On the "Home" network, it shows your own.
- Stop the tunnel with `ifdown wgvpn`. Devices on the "Frankfurt" network should lose internet
  access, while the "Home" network keeps working.

## More than one location

The pattern scales: add VLAN 3, a second tunnel `wgvpn2`, routing table 1702 and a third SSID, and
the house has Wi-Fi networks in two other countries.

## Limitations

- **Bandwidth and latency.** Throughput is limited by the remote location's upload speed and by how
  fast the router can encrypt WireGuard traffic. Every packet also travels to the remote location
  and back. Between Sydney and Europe, that adds roughly 250–300 ms of round-trip time.
- **IP address isn't the only location signal.** Phones also use GPS and the Wi-Fi networks they
  can see to determine their location, and some apps check those instead of the IP address.
- **Terms of service.** Some streaming services prohibit accessing content from outside its
  licensed region. Check the terms of the services you use.
