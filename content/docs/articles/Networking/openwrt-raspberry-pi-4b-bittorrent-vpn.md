---
weight: 11
title: "OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN

{{% hint info %}}
**Set up and tested in November 2026** on OpenWrt 25.12.5 with Docker 29.6.1. This part of the series builds on the
Essentials and the Docker article (coming soon).
{{% /hint %}}

This part of the series adds a BitTorrent client to the router whose traffic can only reach the internet through a
commercial VPN. If the tunnel goes down, the client must not fall back to my home connection, it must lose its
internet access entirely. No device in the LAN needs to be on all the time for this, and the downloads end up on the
SSD of the router.

It builds directly on the Docker article of this series (coming soon). Three things from it are important here:
all Docker data lives on the SSD under `/opt`, containers can reach the internet but not the LAN, and all
containers together are capped at 6GB of memory so that routing always has memory left.

(Note: I use BitTorrent for legal content, such as Linux images. Neither tomcore.io nor the author of this article
can be held liable for how you use the setup described here, or for any damage it may cause)

## What the VPN provider must offer

Not every VPN provider is suited for this. Before choosing one, I wrote down the technical criteria it has to fulfill:

1. **WireGuard.** [WireGuard](https://www.wireguard.com/) runs in the kernel, and the kernel module is already part
   of my firmware image (see the WireGuard Server article). OpenVPN would work as well, but it runs in user space,
   and on a CPU like the one of the PI it is generally much slower than WireGuard. I did not measure this myself.
2. **A WireGuard configuration for a device without the provider's app.** The router cannot run a vendor app. The
   provider must let me create a configuration, or at least a private key, in its web interface and use it on any
   WireGuard client.
3. **Port forwarding.** For browsing, this does not matter, but for BitTorrent it makes a big difference. Without it,
   the VPN server drops all connections other peers try to open to my client. My client can still connect to others,
   but only to peers which accept incoming connections themselves, and two peers behind such a VPN can never talk to
   each other. Downloads become slower and seeding hardly works. The port does not have to be fixed, but it must be
   possible to request and renew it automatically.
4. **P2P traffic allowed.** Some providers only allow BitTorrent on certain servers, or not at all.
5. **Supported by gluetun.** The container I use for the tunnel, described in the next section, knows the server
   lists of many providers, and it can handle port forwarding for some of them. Without this support, the forwarded
   port would have to be requested and passed on by a script of my own.

One provider which fulfills all five is [ProtonVPN](https://protonvpn.com/), and this article is based on it. It
offers WireGuard configurations for routers in its web interface, and port forwarding on its P2P servers with the
paid plans. The port is not fixed, it is assigned by the server via
[NAT-PMP](https://en.wikipedia.org/wiki/NAT_Port_Mapping_Protocol) and renewed by the client every minute.

(Note: ProtonVPN is not the only provider which fulfills these criteria, and this article is not a comparison of
providers. The [gluetun documentation](https://github.com/qdm12/gluetun-wiki) lists the providers it supports,
including those for which it can handle port forwarding. With another provider, most of this article stays the same,
only the Proton specific parts change)

## Why gluetun

The obvious OpenWrt way would be a second WireGuard interface on the router, with policy routing that sends the
traffic of the torrent client into it, and a firewall zone that can only forward to the tunnel. This is close to
what the article A Wi-Fi Network in Another Country (coming soon) plans for VLAN 2. For a single
Docker container, I decided against it for three reasons:

- Docker manages its own firewall rules next to fw4, as described in the Docker article. Routing a Docker network
  into a tunnel would mean more rules that both have to agree on.
- The port Proton forwards changes after every reconnect, and the torrent client has to be told about it. That
  needs a NAT-PMP client and a script on the router.
- A mistake in the routing of the router affects the whole house, not just the torrent client.

[gluetun](https://github.com/qdm12/gluetun) is a container which does all of this in one place. It opens the
WireGuard tunnel to the VPN provider, has a built-in kill switch, supports Proton's port forwarding, and can run a
command whenever the forwarded port changes. The torrent client, [qBittorrent](https://www.qbittorrent.org/) in the
[linuxserver.io image](https://docs.linuxserver.io/images/docker-qbittorrent/), does not get a network of its own.
It shares the network of the gluetun container (`network_mode: service:gluetun`), so the only network interfaces it
can see are the ones of gluetun: the tunnel, and the link to a Docker network of its own which gluetun's firewall
closes for everything but the tunnel itself and the web interface.

## How it fits together

{{< mermaid >}}
flowchart LR
  subgraph home["LAN"]
    pc["PC<br/>browser to<br/>http://10.0.0.1:8080"]
  end
  pc --- lan
  subgraph pi["Raspberry PI 4B - OpenWrt"]
    lan["br-lan - zone lan<br/>10.0.0.1/24"]
    fw["Routing,<br/>firewall, NAT"]
    wan["eth1 - zone wan"]
    subgraph ns["br-torrent - zone torrent - 10.0.200.0/24<br/>network of the gluetun container"]
      gluetun["gluetun<br/>WireGuard to Proton<br/>kill switch"]
      qbt["qBittorrent<br/>web UI on :8080"]
    end
    lan --- fw
    fw --- ns
    fw --- wan
  end
  wan --- inet(("Internet"))
  proton["ProtonVPN<br/>P2P server"]
  gluetun -. "WireGuard tunnel, UDP 51820<br/>the only traffic out" .-> proton
  proton --- peers(("BitTorrent<br/>peers"))
{{< /mermaid >}}

From the point of view of the router, the only traffic which leaves the gluetun container is UDP to the Proton
server. Everything else, the BitTorrent traffic and the DNS queries, is inside that tunnel. The peers only ever see
the address of the Proton server. The router does not just trust gluetun with this, it enforces it with a firewall
zone of its own, as described below.

It is worth mentioning that IPv6 cannot leak either. The Docker network of the two containers has no IPv6, so they
have no IPv6 route to the internet outside the tunnel in the first place.

## Proton: the WireGuard configuration

gluetun needs one secret from Proton: the private key of a WireGuard configuration. It is created in the Proton
account, under Downloads → **WireGuard configuration**:

| Field | Value |
|---|---|
| Name | `openwrt-torrent` |
| Platform | Router |
| NetShield blocker filtering | No filter |
| Moderate NAT | Off |
| NAT-PMP (Port Forwarding) | On |
| VPN Accelerator | On |
| Server | Any P2P server, gluetun picks its own server anyway |

NetShield filters through Proton's DNS server, but gluetun uses its own DNS resolver, so the setting would most
likely have no effect anyway. Moderate NAT helps peer-to-peer traffic which has no forwarded port, and with port
forwarding switched on, it is not needed.

Please note, **NAT-PMP must be switched on when the configuration is created.** It cannot be switched on later for an
existing key, and gluetun cannot fix it either. The page shows the private key only once, in the configuration it
creates. Only the line `PrivateKey = ...` is needed, the rest gluetun knows by itself.

## Preparing the router

The router from the Essentials and the Docker article is not quite ready for gluetun yet. Two things are missing:
the TUN device, and a network for the two containers which the OpenWrt firewall knows about.

### 1. The TUN device

[TUN](https://en.wikipedia.org/wiki/TUN/TAP) is a virtual network device of the Linux kernel. Through the special
file `/dev/net/tun`, a program can create a network interface of its own and send and receive packets on it as if
it was a network card. VPN software which runs in user space, such as OpenVPN or the user space version of
WireGuard, depends on it. gluetun expects the device in every case and checks for it at startup, and the compose
file below passes it into the container.

The firmware image from the Essentials article contains `kmod-wireguard`, but not the TUN module `kmod-tun`, so
`/dev/net/tun` does not exist on the router. My first start of the containers failed with this error:

```text
Error response from daemon: error gathering device information while adding custom device "/dev/net/tun": no such file or directory
```

Install the module and check that the device exists. OpenWrt 25.12 uses `apk` as its package manager:

```shell
root@OpenWrt:~# apk update
root@OpenWrt:~# apk add kmod-tun
root@OpenWrt:~# ls -l /dev/net/tun
```

`ls` must show a character device, a line which starts with `crw`. `owut` keeps installed packages when it builds the
image for the next upgrade, but I also added `kmod-tun` to the package list of my image, so that it is part of a
fresh installation as well.

### 2. A network of its own

Without further instructions, `docker-compose` creates a network for every project, in this case called
`torrent_default`. Its bridge gets a random name, such as `br-32f5d71a9de9`, and a subnet out of Docker's address
pool, such as `172.18.0.0/16`. A look at the nftables rules on my router showed what that means: Docker's own rules
know the new bridge, but the OpenWrt firewall does not. The `docker` zone from the Docker article, and the WAN block
in `/etc/config/dockerd`, only cover `docker0`. The firewall would most likely drop the traffic of gluetun to Proton,
and the web interface would not be reachable from the LAN either.

Instead of adding the containers to `docker0`, which other containers share, I give the two of them a network of
their own with a fixed name and a fixed subnet, unrelated to anything else Docker runs on the router:

| | Value |
|---|---|
| Bridge | `br-torrent` |
| Subnet | `10.0.200.0/24`, outside of Docker's address pools, so Docker never hands it out to another network |
| Gateway, the router | `10.0.200.1` |
| gluetun, and with it qBittorrent | `10.0.200.2`, fixed |
| IPv6 | none |

The `200` in `10.0.200.0/24` is an arbitrary choice of mine. It has no technical meaning, I only picked it to make
the network distinct: it is well away from the LAN (`10.0.0.0/24`), the WireGuard server (`10.0.1.0/24`) and any
network I am likely to add next to them, but it is still easy to recognize as one of mine. Any other free /24 works
just as well. Docker creates the bridge
itself when the containers start, as defined in the compose file below. The router only needs a firewall zone for
it, which refers to the bridge by its name, so it does not matter that the bridge does not exist yet. The zone gets
the strictest rules possible:

- **Nothing into the router** (input reject). gluetun does not need the router, not even as DNS server.
- **Nothing to the LAN** (no forwarding to `lan`).
- **To the internet, only UDP port 51820**, the port of Proton's WireGuard servers. This is a second kill switch,
  independent of gluetun. Even if gluetun's own firewall failed, nothing but WireGuard packets could leave the
  network of the two containers.
- **From the LAN, only the web interface**, TCP port 8080 on gluetun's address.

```shell
root@OpenWrt:~# uci batch <<EOF
set firewall.torrent=zone
set firewall.torrent.name='torrent'
add_list firewall.torrent.device='br-torrent'
set firewall.torrent.input='REJECT'
set firewall.torrent.output='ACCEPT'
set firewall.torrent.forward='REJECT'
set firewall.torrent_wg=rule
set firewall.torrent_wg.name='Allow-Torrent-WireGuard'
set firewall.torrent_wg.src='torrent'
set firewall.torrent_wg.dest='wan'
set firewall.torrent_wg.family='ipv4'
set firewall.torrent_wg.proto='udp'
set firewall.torrent_wg.dest_port='51820'
set firewall.torrent_wg.target='ACCEPT'
set firewall.torrent_ui=rule
set firewall.torrent_ui.name='Allow-Torrent-WebUI'
set firewall.torrent_ui.src='lan'
set firewall.torrent_ui.dest='torrent'
set firewall.torrent_ui.dest_ip='10.0.200.2'
set firewall.torrent_ui.proto='tcp'
set firewall.torrent_ui.dest_port='8080'
set firewall.torrent_ui.target='ACCEPT'
EOF
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
```

A few notes on this configuration:

- **The zone has a `device` and no `network`.** A zone usually covers an OpenWrt interface from
  `/etc/config/network`. I do not want OpenWrt's network configuration to touch a bridge Docker manages, as the
  Docker article showed what a network reload can do to `docker0`. fw4 can match a device by its name directly.
- **There is no `forwarding` from `torrent` to `wan`.** A forwarding would allow everything, the rule only allows
  WireGuard. The `wan` zone masquerades these packets like everything else that leaves through it.
- **The LAN reaches the web interface through Docker's port forwarding.** Docker translates a connection to
  `10.0.0.1:8080` to `10.0.200.2:8080`, so the firewall sees a connection from `lan` to `torrent`, which the second
  rule allows. The section about starting qBittorrent shows this step by step.

In LuCI, the zone is in Network → Firewall → **General Settings**, and the two rules in **Traffic Rules**.

## The directories

All files of the two containers go into one directory, `/opt/torrent`. As described in the Essentials article,
`/opt` is the data partition on the SSD, so the downloads do not fill up the root partition, and a firmware upgrade
does not touch them. When we are done, the directory will look like this:

```text
/opt/torrent/
  compose.yaml       the definition of both containers
  .env               the WireGuard private key, readable by root only
  gluetun/           data of gluetun and the port script
  qbittorrent/       configuration of qBittorrent
  downloads/         the downloaded files
```

### 1. Create the directories

Create the directory and its three subdirectories by executing the following:

```shell
root@OpenWrt:~# mkdir -p /opt/torrent/gluetun
root@OpenWrt:~# mkdir -p /opt/torrent/qbittorrent
root@OpenWrt:~# mkdir -p /opt/torrent/downloads
```

### 2. Hand the qBittorrent directories to its user

qBittorrent does not run as root inside its container, but as the user and group with the ID `1000` (`PUID` and
`PGID` in the compose file below). The linuxserver.io image takes care of the permissions of its configuration
directory, but I do not want to rely on it for the download directory. If that directory belongs to root,
qBittorrent cannot write a single file into it. Change the owner of both directories:

```shell
root@OpenWrt:~# chown 1000:1000 /opt/torrent/qbittorrent
root@OpenWrt:~# chown 1000:1000 /opt/torrent/downloads
```

(Note: there is no user with the ID `1000` on the router itself. That does not matter, the owner is stored as a
number, and `ls -l` simply shows `1000` instead of a name)

### 3. Store the private key

The private key from Proton does not belong in the compose file itself. Docker Compose reads variables from a file
called `.env` in the same directory, and the compose file only refers to it as `${WIREGUARD_PRIVATE_KEY}`. That way,
the compose file can be shown and copied without giving away the key.

`umask go=` makes sure that the file is created readable for root only. It only applies to the current shell, so it
must be executed in the same session. Replace the placeholder with the value after `PrivateKey = ` from the Proton
configuration:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# cat > /opt/torrent/.env <<EOF
WIREGUARD_PRIVATE_KEY=(the PrivateKey from Proton)
EOF
```

### 4. Check the result

```shell
root@OpenWrt:~# ls -la /opt/torrent
```

The file `.env` must show `-rw-------` and the owner `root`, the directories `qbittorrent` and `downloads` the
owner `1000`. If `.env` is readable for others, fix it with `chmod 600 /opt/torrent/.env`.

## The containers

### Where the compose file goes

The compose file goes into the same directory as the data of its containers, `/opt/torrent/compose.yaml`. I follow
a simple rule for every Docker project on the router: one directory under `/opt` per project, and everything that
belongs to it lives in that directory, the compose file, the `.env` file and the data. This has a few advantages:

- **Docker Compose finds everything by itself.** When `docker-compose` is executed in `/opt/torrent`, it picks up
  `compose.yaml` and `.env` from there without any further options.
- **The project gets a sensible name.** Compose names a project after its directory, so the containers, networks
  and volumes of this one are grouped under `torrent` and cannot collide with those of another project, such as the
  Git server.
- **Backup and removal are one directory.** Copying `/opt/torrent` saves the whole project, and deleting it, after
  `docker-compose down`, removes it completely.
- **Nothing ends up on the root partition.** `/etc` would be the obvious place on OpenWrt, but it is on the small
  root partition and part of the firmware backup, and the compose file would be separated from its data.

`compose.yaml` is the file name the current Docker Compose looks for first. The older `docker-compose.yml` still
works as well.

### The compose file

Create `/opt/torrent/compose.yaml` with the following content, for example with `vi`. It describes both
containers. gluetun publishes the web interface of qBittorrent, because qBittorrent has no network of its own to
publish anything on, and it publishes it on the LAN address of the router only:

```yaml
# /opt/torrent/compose.yaml
services:
  gluetun:
    image: qmcgaw/gluetun
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    networks:
      torrent:
        ipv4_address: 10.0.200.2
    ports:
      - 10.0.0.1:8080:8080
    environment:
      - VPN_SERVICE_PROVIDER=protonvpn
      - VPN_TYPE=wireguard
      - WIREGUARD_PRIVATE_KEY=${WIREGUARD_PRIVATE_KEY}
      - SERVER_COUNTRIES=Switzerland
      - PORT_FORWARD_ONLY=on
      - VPN_PORT_FORWARDING=on
      - VPN_PORT_FORWARDING_UP_COMMAND=/bin/sh /gluetun/qbt-port.sh {{PORTS}}
      - TZ=Australia/Sydney
    volumes:
      - /opt/torrent/gluetun:/gluetun
    restart: unless-stopped

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent
    container_name: qbittorrent
    network_mode: service:gluetun
    depends_on:
      gluetun:
        condition: service_healthy
    environment:
      - PUID=1000
      - PGID=1000
      - WEBUI_PORT=8080
      - TZ=Australia/Sydney
    volumes:
      - /opt/torrent/qbittorrent:/config
      - /opt/torrent/downloads:/downloads
    mem_limit: 1g
    restart: unless-stopped

networks:
  torrent:
    name: torrent
    driver: bridge
    enable_ipv6: false
    driver_opts:
      com.docker.network.bridge.name: br-torrent
    ipam:
      config:
        - subnet: 10.0.200.0/24
          gateway: 10.0.200.1
```

A few notes on this file:

- **`networks`** at the end defines the network from the section about preparing the router. `name: torrent`
  keeps Compose from prefixing it with the project name, and `com.docker.network.bridge.name` gives the bridge the
  fixed name the firewall zone refers to. gluetun gets the fixed address `10.0.200.2`. qBittorrent has no entry of its
  own, because it uses gluetun's network.

- **`PORT_FORWARD_ONLY=on`** limits gluetun to the Proton servers which support port forwarding, which are the P2P
  servers.
- **`VPN_PORT_FORWARDING_UP_COMMAND`** runs every time Proton assigns a port, `{{PORTS}}` is replaced with it. The
  script is described in the next section.
- **`mem_limit: 1g`** limits qBittorrent on its own, below the 6GB cap for all containers. A torrent client uses
  memory as a disk cache, and I do not want it to take memory away from the other containers.
- **`/dev/net/tun`** is the TUN device from the section about preparing the router. Since `kmod-wireguard` is
  loaded, gluetun should still use the WireGuard of the kernel. Its log shows which implementation it picked.

## Telling qBittorrent about the port

Behind a VPN, my public address is the address of the VPN server, which many customers share. The server is a NAT,
just like my home router. A connection which arrives at one of its ports is dropped, because the server does not know
which customer it is meant for, unless that port is forwarded to me. With ProtonVPN, I cannot choose this port, and I
do not keep it forever:

1. Inside the tunnel, the client asks the gateway of the VPN server for a port via NAT-PMP.
2. The server picks a random free port and grants it for about 60 seconds.
3. The client must renew this lease before it runs out, so every 45 seconds or so. If it stops, the port is gone.
4. After a reconnect, a change of server or an expired lease, the server usually hands out a different port.

gluetun takes care of requesting and renewing the port. But qBittorrent listens on a fixed port of its own, which
is a setting in its options. If the VPN server forwards one port and qBittorrent listens on another one, every
incoming connection goes nowhere. So the port cannot be set once in the web interface. It would work until the next
reconnect and then stop working without any error message.

Instead, gluetun calls a small script in its own directory whenever it gets a new port, and the script sets the port
through the web API of qBittorrent. Because both containers share one network, qBittorrent is reachable from gluetun
on `127.0.0.1`:

```shell
root@OpenWrt:~# cat > /opt/torrent/gluetun/qbt-port.sh <<'EOF'
#!/bin/sh
# Called by gluetun with the port ProtonVPN forwards. Sets it as the
# listening port of qBittorrent, which shares gluetun's network.
# qBittorrent may still be starting, so keep trying for a minute.
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  wget -q -O /dev/null --post-data "json={\"listen_port\":$1}" \
    http://127.0.0.1:8080/api/v2/app/setPreferences && exit 0
  sleep 5
done
exit 1
EOF
root@OpenWrt:~# chmod +x /opt/torrent/gluetun/qbt-port.sh
```

The loop is needed because both containers start at almost the same time. gluetun can have its port before the web
interface of qBittorrent is ready, and a single attempt would fail.

This only works without a login if qBittorrent trusts requests from its own host. In the web interface of
qBittorrent, Tools → Options → **WebUI**, "Bypass authentication for clients on localhost" must be switched on.
Please note, requests from the LAN arrive through Docker's port forwarding with a different address, so they still
need the password.

Keep in mind that the trackers and the DHT still know the old port for a while after a change, until qBittorrent
announces the new one. Until then, there are fewer incoming connections. This is not a leak, all outgoing
connections keep going through the tunnel. The same is true if any link in the chain from gluetun to the script to
qBittorrent fails: nothing leaks, but the incoming connections stop without any notice. That is why I check the
port in qBittorrent after restarting both containers.

## Starting it

I start the two containers one after the other. If something does not work, it is much easier to find out whether
the tunnel or the torrent client is the problem. And qBittorrent must not run before I know that its only way to the
internet really is the tunnel.

### 1. gluetun on its own

`docker-compose` can start a single service of the project. qBittorrent stays down for now:

```shell
root@OpenWrt:~# cd /opt/torrent
root@OpenWrt:/opt/torrent# docker-compose up -d gluetun
root@OpenWrt:/opt/torrent# docker logs -f gluetun
```

`-f` follows the log, Ctrl+C ends it without stopping the container. These are the things to look for in the log:

- **The WireGuard implementation.** It should be the one of the kernel, since `kmod-wireguard` is loaded.
- **No firewall errors.** gluetun sets up its own kill switch with iptables first. Errors at this point mean that
  something is missing in the kernel of the router.
- **The public IP address** after the connection is up, which must be the address of a Proton server.
- **The forwarded port.** gluetun reports the port Proton assigned. Right after it, gluetun runs the port script,
  which fails for now, because qBittorrent is not running yet. That is expected.

Then I check from the router that gluetun is healthy, that its traffic really leaves through the tunnel and which
port it got:

```shell
root@OpenWrt:~# docker ps --filter name=gluetun
root@OpenWrt:~# docker exec gluetun wget -qO- https://ipinfo.io/json
root@OpenWrt:~# docker exec gluetun cat /tmp/gluetun/forwarded_port
root@OpenWrt:~# nft list ruleset | grep br-torrent
```

1. `docker ps` must show the status `(healthy)`. gluetun checks its connection through the tunnel by itself.
2. `wget` prints what [ipinfo.io](https://ipinfo.io/) knows about the address the request came from. `ip` must be
   the address of the Proton server, not my WAN address, and `country` the two-letter code of the country in
   `SERVER_COUNTRIES`, for example `CH` for Switzerland. Please note, `org` names the network the server is in,
   which is often a data center and not Proton itself.
3. `forwarded_port` contains the port from the log.
4. The firewall rules for the zone `torrent` must now refer to the bridge `br-torrent`.

Last but not least, the kill switch on the router. I disable the rule which lets WireGuard out to the internet and
repeat the `wget`. Once the tunnel notices the lost connection, the request must time out instead of falling back to
my WAN address. Afterwards, I enable the rule again:

```shell
root@OpenWrt:~# uci set firewall.torrent_wg.enabled='0'
root@OpenWrt:~# uci commit firewall && service firewall reload
root@OpenWrt:~# docker exec gluetun wget -T 10 -qO- https://ipinfo.io/ip
root@OpenWrt:~# uci delete firewall.torrent_wg.enabled
root@OpenWrt:~# uci commit firewall && service firewall reload
```

Only when all of this works do I continue with qBittorrent.

### 2. qBittorrent

```shell
root@OpenWrt:/opt/torrent# docker-compose up -d qbittorrent
root@OpenWrt:/opt/torrent# docker logs qbittorrent
```

The linuxserver.io image prints a temporary password for the web interface into the log on its first start. With
it, I log in at `http://10.0.0.1:8080` and set these options, under Tools → Options:

1. **WebUI**: a real password instead of the temporary one, and "Bypass authentication for clients on localhost"
   on, so that the port script from gluetun is allowed to change the port.
2. **Downloads**: the default save path is `/downloads`.
3. **Connection**: "Use UPnP / NAT-PMP port forwarding from my router" off. gluetun takes care of that.
4. **Advanced**: "Network interface" set to gluetun's tunnel interface instead of "Any interface". This is a
   second kill switch inside qBittorrent itself. It refuses to send anything if the tunnel interface does not exist.

The port script failed when gluetun got its port, because qBittorrent was not running at the time. Instead of
waiting for the next port change, I run the script once by hand with the current port:

```shell
root@OpenWrt:~# docker exec gluetun sh -c \
  '/bin/sh /gluetun/qbt-port.sh $(cat /tmp/gluetun/forwarded_port)'
```

Afterwards, the listening port in Tools → Options → **Connection** must be the same as in `forwarded_port`. From
now on, `docker-compose up -d` starts both containers together. qBittorrent only starts once gluetun reports itself
healthy, and the port script keeps trying until the web API of qBittorrent answers.

(Note: qBittorrent lives in the network of the gluetun container. If only gluetun is restarted or recreated,
qBittorrent loses its network, and it has to be restarted as well. `docker-compose restart` restarts both)

### 3. How the web interface gets to 10.0.0.1

The web interface of qBittorrent runs at `10.0.200.2:8080`, but I open it at `http://10.0.0.1:8080`, the LAN address
of the router. The reason is this line in the compose file:

```yaml
    ports:
      - 10.0.0.1:8080:8080
```

It tells Docker to publish port 8080 of the gluetun container on the LAN address of the router. Docker does this with
destination NAT ([DNAT](https://en.wikipedia.org/wiki/Network_address_translation)), and the rules it created can be
seen on the router. After I had opened the web interface once from my PC, they looked like this:

```shell
root@OpenWrt:~# nft list table ip nat 2>/dev/null | grep -E "chain|8080"
  chain DOCKER {
    ip daddr 10.0.0.1 iifname != "br-torrent" tcp dport 8080 counter packets 12 bytes 624 xt target "DNAT"
  chain PREROUTING {
  chain OUTPUT {
  chain POSTROUTING {
root@OpenWrt:~# nft list table ip filter 2>/dev/null | grep 10.0.200
    ip daddr 10.0.200.2 iifname != "br-torrent" oifname "br-torrent" tcp dport 8080 counter packets 12 bytes 624 accept
root@OpenWrt:~# nft list ruleset 2>/dev/null | grep Allow-Torrent-WebUI
    ip daddr 10.0.200.2 tcp dport 8080 counter packets 12 bytes 624 jump accept_to_torrent comment "!fw4: Allow-Torrent-WebUI"
```

(Note: `ip nat` and `ip filter` are Docker's own tables, which it manages through `iptables-nft`. The OpenWrt
firewall fw4 lives in the table `inet fw4`. `2>/dev/null` hides the warning "table ip nat is managed by iptables-nft,
do not touch!" which `nft` prints for each of Docker's tables)

A connection from my PC takes three steps:

1. **Docker rewrites the destination.** Before the router decides where a packet goes, the DNAT rule changes its
   destination from `10.0.0.1:8080` to `10.0.200.2:8080`, the address of gluetun. So the router does not treat the
   packet as traffic for itself, but forwards it from `br-lan` to `br-torrent`.
2. **Two firewalls let it through.** Docker's own rule accepts the forwarded packet, and so does the rule
   `Allow-Torrent-WebUI` from the section about preparing the router. Without that rule, fw4 would drop it. All three
   rules show the same 12 packets, which were exactly the packets of my browser.
3. **qBittorrent answers on gluetun's address.** qBittorrent has no network of its own (`network_mode:
   service:gluetun`) and listens on port 8080 inside the network of gluetun. So `10.0.200.2:8080` is qBittorrent.

Docker also starts a small proxy program which listens on `10.0.0.1:8080` itself:

```shell
root@OpenWrt:~# netstat -tlnp | grep 8080
tcp        0      0 10.0.0.1:8080           0.0.0.0:*               LISTEN      1513/docker-proxy
```

It only handles connections which the DNAT rule does not catch, for example those which start on the router itself.
The connections from the LAN never reach it, because the DNAT rule has already redirected them. It is worth
mentioning that the web interface is only published on the LAN address. Nothing is published on the WAN address,
and the firewall zone keeps everything else in `10.0.200.0/24` closed to the LAN.

## A hostname, and access through WireGuard

### 1. A hostname for the web interface

`http://10.0.0.1:8080` works, but a name is easier to remember. The name must point to the address the web interface
is published on, which is the LAN address of the router, and not to gluetun's `10.0.200.2`. From the LAN, only the
published address goes through Docker's DNAT and the rule `Allow-Torrent-WebUI`. Like `gitea.lan` in the
[Gitea article](openwrt-raspberry-pi-4b-gitea), the name is a static entry in dnsmasq:

```shell
root@OpenWrt:~# uci batch <<EOF
set dhcp.torrent=domain
set dhcp.torrent.name='torrent'
set dhcp.torrent.ip='10.0.0.1'
EOF
root@OpenWrt:~# uci commit dhcp
root@OpenWrt:~# service dnsmasq reload
root@OpenWrt:~# nslookup torrent.lan 127.0.0.1
Server:    127.0.0.1
Address:  127.0.0.1:53

Name:  torrent.lan
Address: 10.0.0.1
```

dnsmasq appends the local domain `lan` itself, so the web interface is now at `http://torrent.lan:8080`. In LuCI, the
entry is in Network → DHCP and DNS → **Hostnames**. The same name works from the WireGuard clients, since they use
the router as their DNS server as well. I asked the router on its tunnel address `10.0.1.1`, which is where the
phone sends its queries, and got the same answer.

A few notes on this:

- **The port stays in the URL.** A DNS name only points to an address, not to a port. Without `:8080`, the browser
  connects to port 80 of the router, which is LuCI. Getting rid of the port would need a reverse proxy on port 80
  which distinguishes the names, and that is not part of this article.
- **qBittorrent accepts the new name.** qBittorrent can check the name in the `Host` header of each request. On my
  installation, the list of allowed names is `*` (`WebUI\ServerDomains=*` in `qBittorrent.conf`), so any name
  works. If a name is rejected, Tools → Options → **Web UI** → "Server domains" is the place to look.

### 2. Optional: access from the WireGuard clients

This step is optional. Without it, the web interface stays reachable from the LAN only. I added it, because I want
to check the downloads from the phone when I am away, through the WireGuard server described in
[OpenWrt on a Raspberry PI 4B: WireGuard Server](openwrt-raspberry-pi-4b-wireguard).

The name resolves through the tunnel, but the connection does not work yet. Docker's DNAT rule matches every
incoming interface except `br-torrent`, so it also rewrites a connection from the tunnel to `10.0.0.1:8080`. After
that, the firewall sees a connection from the zone `vpn` to the zone `torrent`, and `vpn` may only forward to `lan`
and `wan`. One rule, the same as `Allow-Torrent-WebUI` but with `vpn` as source, lets it through:

```shell
root@OpenWrt:~# uci batch <<EOF
set firewall.torrent_ui_vpn=rule
set firewall.torrent_ui_vpn.name='Allow-Torrent-WebUI-VPN'
set firewall.torrent_ui_vpn.src='vpn'
set firewall.torrent_ui_vpn.dest='torrent'
set firewall.torrent_ui_vpn.dest_ip='10.0.200.2'
set firewall.torrent_ui_vpn.proto='tcp'
set firewall.torrent_ui_vpn.dest_port='8080'
set firewall.torrent_ui_vpn.target='ACCEPT'
EOF
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
root@OpenWrt:~# nft list chain inet fw4 forward_vpn | grep Torrent
    ip daddr 10.0.200.2 tcp dport 8080 counter packets 0 bytes 0 jump accept_to_torrent comment "!fw4: Allow-Torrent-WebUI-VPN"
```

Like the rule for the LAN, it allows exactly one port on gluetun's address and nothing else in `10.0.200.0/24`.
Docker's own accept rule matches every incoming interface except `br-torrent` as well, so Docker needs no change.
From the phone, the web interface is at the same address as from the LAN, `http://torrent.lan:8080`.

I opened `http://torrent.lan:8080` on the phone over the mobile network, with Wi-Fi switched off, and got the web
interface. The counter of the rule on the router went up with it, which shows that the connection really came
through the tunnel:

```shell
root@OpenWrt:~# nft list chain inet fw4 forward_vpn | grep Torrent
    ip daddr 10.0.200.2 tcp dport 8080 counter packets 3 bytes 180 jump accept_to_torrent comment "!fw4: Allow-Torrent-WebUI-VPN"
```

## Files to keep across upgrades

Nothing to add to `/etc/sysupgrade.conf`. The firewall zone and its two rules, the optional rule for WireGuard and
the hostname are part of the uci configuration, and `owut` keeps the package `kmod-tun`. Everything else,
including the private key in `.env`, is under `/opt/torrent` on the data partition, which a firmware upgrade does
not touch. Keep in mind that the uci backup does not contain it either, so `/opt/torrent/.env` and the compose file
need a backup of their own.

## Summary and next steps

Two containers run on a Docker network of their own: gluetun keeps a WireGuard tunnel to a ProtonVPN P2P server with
port forwarding, and qBittorrent shares its network, so it can reach the internet only through that tunnel. The
router enforces this with a firewall zone which lets nothing but WireGuard out to the internet. The web interface is
only published on the LAN address of the router, under the name `torrent.lan`, and optionally one more rule makes it
reachable for the WireGuard clients.
