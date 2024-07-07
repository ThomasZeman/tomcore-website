# Route VLAN via Wireguard interface



Add new routing table (Example 1701 name 'wg')

```shell
localhost:/home/tom/docker/dnsmasq.vpn# cat /etc/iproute2/rt_tables
#
# reserved values
#
1701    wg0
255     local
254     main
253     default
0       unspec
#
# local
#
#1      inr.ruhep
```

```shell
# Setup VLAN
ip link add link lan name lan.2 type vlan id 2
ip addr add 10.10.0.1/24 dev lan.2
ip link set lan.2 up

# Setup "standard" route: tells the kernel how to reach 10.10.0.0/24 via lan.2 in table 1701
ip route add 10.10.0.0/24 dev lan.2 table 1701
# Policy based routing: Every packet from that subnet should be routed via 1701 first
# If this is not specified all packets from 10.10.0.0 will be handled by the local (0) / main (32766) / default (32767) tables and not 1701
ip rule add from 10.10.0.0/24 table 1701

# Setup WireGuard
ip link add dev wg0 type wireguard
wg setconf wg0 /home/tom/wg0.conf
ip link set wg0 up
ip addr add 10.13.37.5 dev wg0
ip route add 10.13.37.0/24 dev wg0 proto kernel scope link src 10.13.37.5
# Make wg0 default gateway for table 1701
ip route add 0.0.0.0/0 dev wg0 table 1701
```