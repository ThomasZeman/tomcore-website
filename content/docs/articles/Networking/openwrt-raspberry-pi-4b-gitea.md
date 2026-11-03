---
weight: 14
title: "OpenWrt on a Raspberry PI 4B: Gitea"
draft: true
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: Gitea

{{% hint info %}}
**Built and tested in November 2026** on OpenWrt 25.12.5 with Docker 29.6.1, Docker Compose v5.1.4 and Gitea 28.3.0
(the image `gitea/gitea:28.3.0-rootless`). This article describes what is running on my router today.
{{% /hint %}}

This part of the series adds [Gitea](https://about.gitea.com/) to the router. Gitea is an open source Git server with
a web interface, similar to GitHub, but small enough to run on a PI. I use it as a private home for my own projects,
and as the place where the virtual machines I run coding agents in push their work, without any of it leaving my
LAN.

It builds directly on [OpenWrt on a Raspberry PI 4B: Docker](openwrt-raspberry-pi-4b-docker) and uses the same
network pattern as [OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn):
a Docker network of its own with a fixed bridge name, a fixed subnet and a strict firewall zone. If you haven't read
those two articles yet, I strongly suggest doing so now. Before starting, I set myself three requirements:

1. Gitea runs on the router and is reachable under a hostname in the LAN.
2. It gets a Docker network and a subnet of its own, with no access to any other Docker network.
3. It is reachable from the local LAN only. Nothing of it is reachable from the internet.

## Is the PI enough?

Gitea is a single Go program, and with SQLite as its database it does not need a database container next to it. On
my router, it uses about 96MB of memory after the start, out of the 512MB I allow it, and the whole directory with
the configuration, the database and the first repository took 2.3MB of disk after the setup. With about 12GB free
on `/opt`, there is room for a lot of repositories. Compared to [LibreChat](openwrt-raspberry-pi-4b-librechat) with
its three containers, Gitea is very light.

## How it fits together

{{< mermaid >}}
flowchart LR
  subgraph home["LAN - 10.0.0.0/24"]
    pc["PC and VMs<br/>http://gitea.lan/<br/>git@gitea.lan"]
  end
  pc --- lan
  subgraph pi["Raspberry PI 4B - OpenWrt"]
    lan["br-lan - zone lan<br/>10.0.0.1/24<br/>dnsmasq: gitea.lan"]
    fw["Routing,<br/>firewall"]
    wan["eth1 - zone wan"]
    subgraph gn["br-gitea - zone gitea - 10.0.203.0/24"]
      gitea["gitea<br/>10.0.203.2<br/>TCP 80 and 22"]
    end
    subgraph tn["br-torrent - zone torrent - 10.0.200.0/24"]
      gluetun["gluetun"]
    end
    lan --- fw
    fw -- "TCP 80 and 22<br/>from lan only" --- gitea
    fw --- tn
    fw --- wan
  end
  wan --- inet(("Internet"))
  gitea -- "no path" --x inet
  gitea -- "no path" --x gluetun
{{< /mermaid >}}

| | Value |
|---|---|
| Hostname | `gitea.lan`, a dnsmasq entry on the router |
| Bridge | `br-gitea` |
| Subnet | `10.0.203.0/24` |
| Gateway, the router | `10.0.203.1` |
| Gitea | `10.0.203.2`, fixed |
| Web interface | `http://gitea.lan/`, port 80 on the container's own address |
| Git over SSH | `git@gitea.lan:owner/repo.git`, port 22 on the container's own address |
| Docker gateway mode | `routed`: no NAT, no `docker-proxy`, nothing published on the router's addresses |
| fw4 zone | `gitea`: input reject, forward reject, no forwarding anywhere |
| To the internet | nothing |
| From the LAN | TCP ports 80 and 22 on `10.0.203.2` only |
| IPv6 | none |
| Memory | `mem_limit: 512m` |
| Database | SQLite in `/opt/gitea/data` |

The subnet follows `10.0.200.0/24` of the torrent network. `10.0.201.0/24` and `10.0.202.0/24` are reserved for the
two LibreChat networks, so Gitea gets `203`.

## The name: gitea.lan, not gitea.local

My first idea was `gitea.local`. It does not work, at least not from Ubuntu. The domain `.local` is reserved for
[multicast DNS](https://en.wikipedia.org/wiki/Multicast_DNS) ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762)),
and Ubuntu ships `libnss-mdns` with this line in `/etc/nsswitch.conf`:

```text
hosts:          files mdns4_minimal [NOTFOUND=return] dns
```

`mdns4_minimal` handles every `.local` name, and `[NOTFOUND=return]` stops the lookup right there if nobody answers
on multicast. The query never reaches the DNS server of the router, and the name does not resolve.

`.lan` is the domain of the router itself (`option domain 'lan'` in the dnsmasq configuration). Every device which
gets its address from the router is already known in the LAN as `<name>.lan`, so `gitea.lan` fits in with the rest.

## Reaching the container directly

qBittorrent and LibreChat are published on the LAN address of the router, `10.0.0.1`, through Docker's DNAT. For
Gitea, I chose a different way: the LAN reaches the container on its own address, `10.0.203.2`. The devices in the
LAN use the router as their default gateway anyway, so a packet to `10.0.203.2` goes to the router, which routes it
to `br-gitea` like any other network it knows.

This has two advantages. Gitea can use the standard ports 80 for the web interface and 22 for SSH. On `10.0.0.1`,
these ports are taken by LuCI (uhttpd on 80 and 443) and by dropbear (22), so I would have to pick other ports, and
every URL and every clone address would carry a port number. And there is no DNAT and no `docker-proxy` in between,
just plain routing.

### Docker's raw-table protection

In its default mode, Docker 29 does not let this work. It protects the addresses of its containers against exactly
this kind of direct access: for every container address, it adds a rule to the table `ip raw` which drops any packet
to that address that does not come in through the container's own bridge. The torrent network shows such a rule:

```shell
root@OpenWrt:~# nft list table ip raw 2>/dev/null | grep 10.0.200
    ip daddr 10.0.200.2 iifname != "br-torrent" counter packets 3 bytes 180 drop
```

For qBittorrent this is fine, since it is only reached through the published port on `10.0.0.1`. A packet from the
LAN directly to `10.0.203.2` would come in through `br-lan` and be dropped before any firewall rule looks at it.

### The routed gateway mode

The solution is a network option of Docker, `com.docker.network.bridge.gateway_mode_ipv4: routed`. In this mode,
Docker does no NAT and no masquerading for the network, and a port mapping does not publish anything on the router.
It only opens the container port in Docker's own filter rules. This is what Docker created for `br-gitea`
(from `iptables-save`):

```text
-A DOCKER -d 10.0.203.2/32 ! -i br-gitea -o br-gitea -p tcp -m tcp --dport 80 -j ACCEPT
-A DOCKER -d 10.0.203.2/32 ! -i br-gitea -o br-gitea -p tcp -m tcp --dport 22 -j ACCEPT
-A DOCKER -o br-gitea -p icmp -j ACCEPT
-A DOCKER ! -i br-gitea -o br-gitea -j DROP
```

Ports 80 and 22 of the container are open from any other interface, everything else to `br-gitea` is dropped. There
is no raw-table rule for `10.0.203.2`, and no NAT at all: `iptables-save -t nat | grep -c 10.0.203` gives `0`.

### A pitfall: the port mapping also opened ports on IPv6

My first try used the short form of the port mapping:

```yaml
    ports:
      - 80
      - 22
```

Docker then started two `docker-proxy` processes, listening on `[::]:32768` and `[::]:32769`. These are random ports
on every IPv6 address of the router, including the public one, forwarding to the container. The input policy of the
`wan` zone would have rejected them from the internet, but they should not exist at all. The routed mode only applies
to IPv4, and for IPv6, Docker fell back to its proxy.

Writing the mapping with an IPv4 host address and without a host port limits it to IPv4:

```yaml
    ports:
      - 0.0.0.0::80
      - 0.0.0.0::22
```

With this, no `docker-proxy` starts. `docker ps` only shows `2222/tcp, 3000/tcp`, which are the ports the image
declares with `EXPOSE`, and which mean nothing here.

## Preparing the router

### 1. The firewall zone

The firewall comes first, so that the container is never reachable without it. As described in the BitTorrent
article, the OpenWrt firewall does not know a bridge which Docker creates, unless a zone refers to it by its name.
The zone `gitea` gets the strictest rules possible:

- **Nothing into the router** (input reject).
- **Nothing out** (forward reject, and no forwarding to `wan`, `lan` or any other zone).
- **From the LAN, only the web interface and SSH**, TCP ports 80 and 22 on Gitea's address.

```shell
root@OpenWrt:~# uci batch <<EOF
set firewall.gitea=zone
set firewall.gitea.name='gitea'
add_list firewall.gitea.device='br-gitea'
set firewall.gitea.input='REJECT'
set firewall.gitea.output='ACCEPT'
set firewall.gitea.forward='REJECT'
set firewall.gitea_web=rule
set firewall.gitea_web.name='Allow-Gitea-Web'
set firewall.gitea_web.src='lan'
set firewall.gitea_web.dest='gitea'
set firewall.gitea_web.dest_ip='10.0.203.2'
set firewall.gitea_web.proto='tcp'
set firewall.gitea_web.dest_port='80'
set firewall.gitea_web.target='ACCEPT'
set firewall.gitea_ssh=rule
set firewall.gitea_ssh.name='Allow-Gitea-SSH'
set firewall.gitea_ssh.src='lan'
set firewall.gitea_ssh.dest='gitea'
set firewall.gitea_ssh.dest_ip='10.0.203.2'
set firewall.gitea_ssh.proto='tcp'
set firewall.gitea_ssh.dest_port='22'
set firewall.gitea_ssh.target='ACCEPT'
EOF
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
root@OpenWrt:~# fw4 check
Ruleset passes nftables check.
```

A few notes on this configuration:

- **Two firewalls, and both must agree.** Docker's rules from above only say "ports 80 and 22 of this container, from
  any other interface". The zone narrows that down to the LAN: fw4 only has accept rules from `lan`, so traffic from
  `wan`, or from any other zone, to `br-gitea` runs into the reject of the zone. A packet must pass both Docker's
  tables and `inet fw4`.
- **The zone matters, even though Gitea needs nothing.** As in the LibreChat article: without a zone, the bridge
  would fall back to the defaults of fw4, whose input policy is accept, and Gitea could reach SSH, LuCI and dnsmasq
  on the router through `10.0.203.1`. The zone rejects that. Gitea does not need any outgoing connection either. I
  use no mirrors, no mail, no update checks and no Gravatar, so there is no rule to `wan` at all.
- **There is no rule for the WireGuard clients.** The requirement is LAN only. The `vpn` zone from the
  [WireGuard article](openwrt-raspberry-pi-4b-wireguard) would need rules of its own, like `Allow-Chat-WebUI-VPN` in
  the LibreChat article, if that ever changes.

The chains fw4 generates for the zone are short: just `jump reject_from_gitea` for input and `jump reject_to_gitea`
for forward. In LuCI, the zone is in Network → Firewall → **General Settings**, and the two rules in **Traffic
Rules**.

### 2. The hostname

The name `gitea.lan` is a static entry in dnsmasq:

```shell
root@OpenWrt:~# uci batch <<EOF
set dhcp.gitea=domain
set dhcp.gitea.name='gitea'
set dhcp.gitea.ip='10.0.203.2'
EOF
root@OpenWrt:~# uci commit dhcp
root@OpenWrt:~# service dnsmasq reload
root@OpenWrt:~# nslookup gitea.lan 127.0.0.1
Server:        127.0.0.1
Address:    127.0.0.1:53

Name:    gitea.lan
Address: 10.0.203.2
```

The entry only says `gitea`, dnsmasq appends the local domain `lan` itself. In LuCI, it is in Network → DHCP and DNS
→ **Hostnames**.

### 3. The directories

Everything of Gitea goes into one directory, `/opt/gitea`:

```text
/opt/gitea/
  compose.yaml       the container and its network
  config/app.ini     Gitea's settings, including its secret keys
  data/              repositories, the SQLite database, avatars, logs
```

The rootless image runs Gitea as the user with the ID `1000`, which must be able to write to both directories. On my
router, this ID belongs to the user `media`, which does not matter, the container does not know about it.

```shell
root@OpenWrt:~# mkdir -p /opt/gitea/data /opt/gitea/config
root@OpenWrt:~# chown 1000:1000 /opt/gitea/data /opt/gitea/config
```

## The compose file

Create `/opt/gitea/compose.yaml` with the following content. As in the BitTorrent article, I wrote it with
`umask go=` set, so that it is readable for root only:

```yaml
# /opt/gitea/compose.yaml
services:
  gitea:
    image: gitea/gitea:28.3.0-rootless
    container_name: gitea
    networks:
      gitea:
        ipv4_address: 10.0.203.2
    ports:
      - 0.0.0.0::80
      - 0.0.0.0::22
    sysctls:
      - net.ipv4.ip_unprivileged_port_start=22
    environment:
      - TZ=Australia/Sydney
      - GITEA__server__DOMAIN=gitea.lan
      - GITEA__server__ROOT_URL=http://gitea.lan/
      - GITEA__server__HTTP_PORT=80
      - GITEA__server__SSH_DOMAIN=gitea.lan
      - GITEA__server__SSH_PORT=22
      - GITEA__server__SSH_LISTEN_PORT=22
      - GITEA__server__OFFLINE_MODE=true
      - GITEA__database__DB_TYPE=sqlite3
      - GITEA__security__INSTALL_LOCK=true
      - GITEA__service__DISABLE_REGISTRATION=true
      - GITEA__service__REQUIRE_SIGNIN_VIEW=true
      - GITEA__cron.update_checker__ENABLED=false
      - GITEA__mailer__ENABLED=false
    volumes:
      - /opt/gitea/data:/var/lib/gitea
      - /opt/gitea/config:/etc/gitea
    mem_limit: 512m
    restart: unless-stopped

networks:
  gitea:
    name: gitea
    driver: bridge
    enable_ipv6: false
    driver_opts:
      com.docker.network.bridge.name: br-gitea
      com.docker.network.bridge.gateway_mode_ipv4: routed
    ipam:
      config:
        - subnet: 10.0.203.0/24
          gateway: 10.0.203.1
```

A few notes on this file:

- **The rootless image and the ports 22 and 80.** The rootless image runs Gitea as a normal user, with Gitea's own
  built-in SSH server instead of OpenSSH. A process which is not root may not bind ports below 1024, so the sysctl
  `net.ipv4.ip_unprivileged_port_start=22` allows ports from 22 upwards. It only applies inside the network
  namespace of the container, not to the router.
- **The settings come from environment variables.** Every variable of the form `GITEA__section__KEY` sets the option
  `KEY` in the section `[section]` of `app.ini`. With `INSTALL_LOCK=true`, Gitea starts without its installer page,
  and nobody in the LAN can run it before me.
- **`OFFLINE_MODE=true`** stops Gitea from loading anything from the internet, such as Gravatar images or files from
  CDNs. Together with the disabled update checker and mailer, Gitea has no reason to open a connection to the outside,
  which the firewall would reject anyway.
- **`DISABLE_REGISTRATION=true` and `REQUIRE_SIGNIN_VIEW=true`.** Nobody can create an account on the login page, and
  nothing, not even a public repository, can be seen without logging in. How accounts are created instead is
  described below.
- **The tag is fixed.** I prefer to know which release runs on my router and to upgrade on purpose.

### The variables stay in app.ini

There is a catch with the environment variables. The image writes them into `/opt/gitea/config/app.ini` on every
start, and they stay there, even after the variable has been removed from the compose file.

I noticed this with `GITEA__picture__DISABLE_GRAVATAR=true`, which I had in my first version. Gitea 28.3 logged this
message:

```text
Deprecation: config option [picture].DISABLE_GRAVATAR present but it won't take effect because it has been moved to admin panel -> config setting
```

Removing the variable from the compose file was not enough, the message came back on the next start. I also had to
delete the line from `app.ini`. Nothing was lost by that, since `OFFLINE_MODE=true` already switches Gravatar off.
Keep in mind that the same applies to every variable: removing it from the compose file does not reset the setting.

## Starting it

```shell
root@OpenWrt:~# cd /opt/gitea
root@OpenWrt:/opt/gitea# docker-compose up -d
 gitea Your kernel does not support swap limit capabilities or the cgroup is not mounted. Memory limited without swap.
 Container gitea Started
root@OpenWrt:/opt/gitea# docker ps --filter name=gitea \
  --format "{{.Names}} {{.Status}} {{.Ports}}"
gitea Up 12 seconds 2222/tcp, 3000/tcp
root@OpenWrt:/opt/gitea# ip -br addr show br-gitea
br-gitea         UP             10.0.203.1/24 fe80::.../64
```

The warning about swap is the one explained in the Docker article. Gitea is ready once its log, `docker logs gitea`,
shows `ORM engine initialization successful!`. The bridge only has a link-local IPv6 address, which every interface
gets, and no routable one.

## Your own user

Registration is off, so every account has to be created by an administrator. Gitea has no administrator yet, so the
first one is created on the command line, inside the container. Gitea generates a random password for it. I did not
want that password on the screen or in the shell history, so it goes into a file that only root can read:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# docker exec gitea gitea admin user create --admin \
  --username thomas --email (your email) \
  --random-password --must-change-password=true \
  | grep -i password | sed "s/.*'\(.*\)'.*/\1/" \
  > /root/gitea-admin-password
root@OpenWrt:~# docker exec gitea gitea admin user list
ID   Username Email                IsActive IsAdmin 2FA   Type
2    thomas   (your email)         true     true    false User
```

(Note: the ID is 2 because I had created and deleted a test user before, see the tests below)

There are three ways to get an account to work with. For a server with one person on it, I recommend the first.

### 1. The admin account is your user

The account created above is an administrator and a normal user at the same time. The first login goes like this:

1. Read the password once with `cat /root/gitea-admin-password` on the router, open `http://gitea.lan/` and sign in
   as `thomas`.
2. Gitea asks for a new password right away, because of `--must-change-password=true`. Afterwards, delete the file
   on the router with `rm /root/gitea-admin-password`.
3. Add the SSH public key of each machine that pushes to Gitea, the content of `~/.ssh/id_ed25519.pub`. The page is
   in the user settings under **SSH / GPG Keys**, or directly at `http://gitea.lan/user/settings/keys`.
4. Optionally, switch on two-factor authentication in the user settings under **Security**, at
   `http://gitea.lan/user/settings/security`.

Whether the key works shows `ssh -T`:

```shell
ssh -T git@gitea.lan
```

Gitea answers with `Hi there, thomas! You've successfully authenticated with the SSH key named ...`, followed by the
name of the key.

### 2. A separate account in the web interface

If you prefer not to work as administrator every day, create a second account in Site Administration → User
Accounts → **Create User Account**, at `http://gitea.lan/-/admin/users/new`. It needs a user name, an email address
and a password. With "must change password", the new user sets their own password at the first login.

### 3. A separate account on the command line

This is the same command as for the administrator, just without `--admin`:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# docker exec gitea gitea admin user create \
  --username (name) --email (email) \
  --random-password --must-change-password=true \
  | grep -i password | sed "s/.*'\(.*\)'.*/\1/" \
  > /root/gitea-(name)-password
```

`gitea admin user create --help` lists a few more options which are useful here:

- `--fullname` sets the full name.
- `--restricted` creates a user who only sees what they are given access to.
- `--user-type Bot` creates an account for automation, such as a CI or an agent bot later.

### The first push

With the key in place, I create a repository in the web interface (**+** → **New Repository**) and push an existing
project to it from a machine in the LAN:

```shell
git remote add origin git@gitea.lan:thomas/myproject.git
git push -u origin main
```

## Tests

I ran these tests from an Ubuntu VM and from my Windows PC in the LAN, from inside the Gitea container, from the
torrent network and on the router:

| Test | Result |
|---|---|
| `getent hosts gitea.lan` on Ubuntu, `nslookup gitea.lan` on Windows | `10.0.203.2` |
| `curl http://gitea.lan/user/login` from Ubuntu and from Windows | HTTP 200 |
| `curl http://gitea.lan:3000/` | No connection |
| `ssh -T git@gitea.lan` without a registered key | `git@gitea.lan: Permission denied (publickey).` |
| End to end with a test user (below) | Push and clone over SSH worked |
| `nc -z -w 3` from inside the container to `1.1.1.1:443`, the internet | Blocked |
| ... to `10.0.0.124:22`, a host in the LAN | Blocked |
| ... to `10.0.0.1:80`, LuCI | Blocked |
| ... to `10.0.203.1:22`, the router through the gateway | Blocked |
| ... to `10.0.200.2:8080`, the torrent network | Blocked |
| `nc -z` inside the container to `127.0.0.1:80` and `10.0.203.2:22` | Open |
| `docker exec gluetun nc -z -w 3 10.0.203.2 80`, from the torrent network | Blocked |
| `netstat -tlnp` on the router | No `docker-proxy` for Gitea, nothing new on the router's addresses |
| `docker stats` after the start | 96MB of 512MB |

For the end-to-end test, I created a test user `smoketest`, added an SSH key named `smoke` through Gitea's API,
created a private repository, pushed to it over SSH from the Ubuntu VM and cloned it back. `ssh -T` with that key
answered `Hi there, smoketest! You've successfully authenticated with the SSH key named smoke.` Afterwards, I deleted
the user again with `gitea admin user delete --purge`.

It is worth mentioning the control test with `127.0.0.1:80` and `10.0.203.2:22`. It shows that `nc` works inside the
container and finds open ports, so the blocked connections above are really blocked by the firewall, and not just a
broken test.

## Open points

- **From the internet.** I checked this only by reading the rules, not with a connection from outside: there is no
  accept rule from `wan` to `gitea` in fw4, `10.0.203.0/24` is a private network which the internet cannot route to,
  the network has no IPv6, and nothing is published on the addresses of the router. A test from a phone on mobile
  data against the public IPv4 and IPv6 address of the router is still to do.
- **A reboot of the router.** `restart: unless-stopped` and the zone, which matches the bridge by its name, should
  bring everything back. I have not observed it yet.
- **Plain HTTP.** Passwords and session cookies travel unencrypted through the LAN, Git itself uses SSH. This is the
  same trade-off as with LibreChat, and a reverse proxy with HTTPS in front of both would be the fix.
- **Backups.** Nothing backs up `/opt/gitea` yet. `config/app.ini` holds the secret keys of Gitea, and losing it
  invalidates all sessions and tokens. A nightly backup, for example with `gitea dump`, is the next step.
- **CI.** Gitea Actions with `act_runner` is a later step. The runner needs internet access to fetch its images and
  dependencies, so it will get a network of its own, separate from `gitea`.

## Files to keep across upgrades

Nothing to add to `/etc/sysupgrade.conf`. The zone, its two rules and the hostname are part of the uci
configuration. Everything else is under `/opt/gitea` on the data partition, which a firmware upgrade does not touch.
Keep in mind that the uci backup does not contain this directory either.

## Summary and next steps

Gitea runs in a Docker network of its own, `br-gitea`, and the LAN reaches it directly on its own address under the
name `gitea.lan`, with the standard ports 80 and 22. Docker's routed mode makes this possible without NAT and without
publishing anything on the router, and the firewall zone `gitea` lets in nothing but these two ports from the LAN and
lets nothing out. With less than 100MB of memory, the PI hardly notices it. The next steps are a nightly backup and,
later, a runner for Gitea Actions on a network of its own.
