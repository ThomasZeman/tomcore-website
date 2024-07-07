# Alpine Nft Tables Setup (WIP)

Install

## forward

Edit /etc/sysctl.conf and add:
```
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
```

```shell
sudo sysctl -p
```

```shell
sudo apk add nftables iptables ip6tables
sudo rc-update add nftables
sudo service nftables start
```

Verify

```shell
localhost:~$ nft --version
nftables v1.0.2 (Lester Gooch)
localhost:~$ sudo nft list ruleset
table inet filter {
        chain input {
                type filter hook input priority filter; policy drop;
                iifname "lo" accept comment "Accept any localhost traffic"
                ct state { established, related } accept comment "Accept traffic originated from us"
                ct state invalid drop comment "Drop invalid connections"
                tcp dport 113 reject comment "Reject AUTH to make it fail fast"
                ...
```



Note: It's possible to run iptables and nft at the same time: https://unix.stackexchange.com/a/596497

Note: acceptance does not mean it cant be dropped later: https://wiki.nftables.org/wiki-nftables/index.php/Configuring_chains#:~:text=Base%20chain%20priority,-Each%20nftables%20base&text=For%20example%2C%20a%20chain%20on,subsequently%20traverse%20this%20other%20chain.

Note: Docker and Network Namespaces: https://medium.com/techlog/diving-into-linux-networking-and-docker-bridge-veth-and-iptables-a05eb27b1e72

Note: NF Overview: https://en.wikipedia.org/wiki/Netfilter#/media/File:Netfilter-packet-flow.svg

Note: NF Overview 2: https://wiki.nftables.org/wiki-nftables/index.php/Netfilter_hooks

Verify it's "sinb/iptables":
```shell
localhost:/home/tom# which iptables
/sbin/iptables
```

Relink:
```shell
sudo ln -sf /sbin/ip6tables-nft /sbin/ip6tables
sudo ln -sf /sbin/iptables-nft /sbin/iptables
sudo ln -sf /sbin/arptables-nft /sbin/arptables
```

```shell
sudo apk add docker
```

```shell
sudo mkdir -p /etc/docker
echo '{"iptables": false}' | sudo tee /etc/docker/daemon.json
rc-update add docker
/etc/init.d/docker start
# Verify
localhost:/home/tom# docker ps
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
localhost:/home/tom#
```

## Install Dnsmasq

```shell
# Create directory /docker/dnsmasq.lan under home
# Create file dnsmasq.conf
localhost:/home/tom/docker/dnsmasq.lan# vi dnsmasq.conf
```

```config
log-queries
#dont use hosts nameservers
no-resolv
#use cloudflare as default nameservers, prefer 1^4
server=1.0.0.1
server=1.1.1.1
server=8.8.8.8
strict-order
port=53

dhcp-range=10.0.0.100,10.0.0.200,2h
interface=eth0
bind-interfaces
domain-needed
bogus-priv
```

```shell
docker network create \
    --driver bridge \
    --subnet 10.1.0.0/24 \
    --gateway 10.1.0.1 \
    pihole_lan
```

- macvlan: not ideal: complex, container cant talk to host, no firewall on host level b/c mac level
- host mode: pihole hard to convince to only bind to non-eth0

## Verify

```shell
localhost:/home/tom# docker network ls
NETWORK ID     NAME          DRIVER    SCOPE
3860726bf275   bridge        bridge    local
cf3d9a249243   dnsmasq_lan   bridge    local
84befbb1853a   host          host      local
bae19ed39b0a   none          null      local
localhost:/home/tom# brctl show
bridge name     bridge id               STP enabled     interfaces
br-cf3d9a249243         8000.0242a9542d93       no
docker0         8000.024236bfc0b3       no
localhost:/home/tom#  ip a
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP qlen 1000
    link/ether dc:a6:32:d5:e8:12 brd ff:ff:ff:ff:ff:ff
    inet 192.168.8.183/24 brd 192.168.8.255 scope global eth0
       valid_lft forever preferred_lft forever
    inet6 fe80::dea6:32ff:fed5:e812/64 scope link
       valid_lft forever preferred_lft forever
3: wlan0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN qlen 1000
    link/ether dc:a6:32:d5:e8:13 brd ff:ff:ff:ff:ff:ff
4: eth1: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc pfifo_fast state DOWN qlen 1000
    link/ether 00:0e:c6:ba:21:52 brd ff:ff:ff:ff:ff:ff
    inet 10.0.0.1/24 scope global eth1
       valid_lft forever preferred_lft forever
5: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN
    link/ether 02:42:36:bf:c0:b3 brd ff:ff:ff:ff:ff:ff
    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
       valid_lft forever preferred_lft forever
6: br-cf3d9a249243: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN
    link/ether 02:42:a9:54:2d:93 brd ff:ff:ff:ff:ff:ff
    inet 10.1.0.1/24 brd 10.1.0.255 scope global br-cf3d9a249243
       valid_lft forever preferred_lft forever
```

## Build

```shell
localhost:/home/tom/docker/dnsmasq.lan# cat Dockerfile
FROM alpine:latest

RUN apk --no-cache add dnsmasq

CMD ["dnsmasq", "-k"]
```

```shell
docker build --tag dnsmasq_lan .
```

## Run

```shell
docker run -d --name dnsmasq_lan --network host -v "/home/tom/docker/dnsmasq.lan/dnsmasq.conf:/etc/dnsmasq.conf" --cap-add=NET_ADMIN dnsmasq_lan

docker run -d --name pihole_lan --network pihole_lan --ip 10.1.0.2 -e TZ='Australia/Sydney' -e WEBPASSWORD='TomPalme2' -v "$(pwd)/etc-pihole:/etc/pihole" -v "$(pwd)/etc-dnsmasq.d:/etc/dnsmasq.d" --restart unless-stopped pihole/pihole:latest
```

## Monitor
```shell
docker exec -it dnsmasq_lan tail -f /var/log/dnsmasq.log
# Reread configuration
docker exec -it dnsmasq_lan pkill -HUP dnsmasq
```

Alternatively map log file to host

Start shell

```shell
docker run --network build -it alpine sh
```

```shell
tcpdump not port 22 and icmp or arp -n -i any
```

# IP6

Debug DHCP6 and ICMP6

```shell
 tcpdump -n -i any udp port 546 or 547 or icmp6
 ```