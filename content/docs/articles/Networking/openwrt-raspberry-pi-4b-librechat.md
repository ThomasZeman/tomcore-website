---
weight: 12
title: "OpenWrt on a Raspberry PI 4B: LibreChat"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: LibreChat

{{% hint info %}}
**Work in progress, November 2026.** This article describes the setup I am about to build on OpenWrt 25.12.5 with
Docker 29.6.1, LibreChat v0.8.8, MongoDB 4.4.18 and Meilisearch v1.35.1. The configuration below is planned but not
yet tested end to end. I will update the article once everything runs and I have verified it.
{{% /hint %}}

This part of the series adds [LibreChat](https://www.librechat.ai/) to the router. LibreChat is an open source web
interface for chatting with large language models, similar to the web interfaces of the model providers themselves.
I use it with the API of the provider, which means I pay per use instead of a monthly subscription, and the
conversations are stored on my own SSD instead of in somebody else's account. The models themselves still run in the
data centers of the provider. The router only serves the web interface and passes the requests on.

It builds directly on [OpenWrt on a Raspberry PI 4B: Docker](openwrt-raspberry-pi-4b-docker) and uses the same
network pattern as [OpenWrt on a Raspberry PI 4B: BitTorrent through a VPN](openwrt-raspberry-pi-4b-bittorrent-vpn):
a Docker network of its own with a fixed bridge name, a fixed subnet and a strict firewall zone. If you haven't read
those two articles yet, I strongly suggest doing so now. From away, I reach LibreChat through the WireGuard server
from [OpenWrt on a Raspberry PI 4B: WireGuard Server](openwrt-raspberry-pi-4b-wireguard).

## Is the PI enough?

Before installing anything, I compared what LibreChat needs with what the router has left. These are the numbers of
my router with gluetun and qBittorrent already running:

| | |
|---|---|
| CPU | 4x Cortex-A72 (ARMv8.0), aarch64 |
| RAM | 8GB, of which about 7.3GB are available, all containers together capped at 6GB |
| Swap | 8GB swap file on `/opt`, unused |
| Disk | 136GB free on `/opt` |
| Load | 1.55, 0.86, 0.68 |

LibreChat consists of the application itself and two to four helper containers. I only use two of them:

| Container | What it does | Memory limit |
|---|---|---|
| LibreChat | The web interface and the API, a Node.js application | 1GB |
| MongoDB | Stores users, conversations and settings | 512MB |
| Meilisearch | Full-text search across the conversations | 512MB |

I left out the RAG API and its PostgreSQL database with pgvector. They are only needed to upload documents and ask
questions about them, which I do not need for now. The three containers above add up to 2GB, together with the 1GB
of qBittorrent that is 3GB of the 6GB cap. The CPU has very little to do, since all the heavy work happens at the
provider. A response streams in at the speed the provider generates it, not at the speed of the PI.

It is worth mentioning that a local model is a different story. With Ollama on a PI 4, only very small models of 1 to
3 billion parameters fit, and they generate a few tokens per second at most. For that, the PI is not enough.

## MongoDB on a PI 4

The one real obstacle is MongoDB. Since version 5.0, MongoDB requires the ARMv8.2-A instruction set, and the
Cortex-A72 of the PI 4 only implements ARMv8.0. The official images of a current MongoDB start and immediately crash
with "Illegal instruction". LibreChat's own compose file uses MongoDB 8.0, so it cannot be used as it is.

The last official image that runs on the PI 4 is `mongo:4.4.18`. The later 4.4 releases were built for ARMv8.2 as
well, so I pin this exact version and not `mongo:4.4`. MongoDB 4.4 reached its end of life in February 2024 and does
not get security updates anymore. I accept that for two reasons: MongoDB sits on a network without any way out, as
described below, and nothing but the LibreChat container can reach it. And LibreChat only uses basic features which
MongoDB 4.4 has.

(Note: there are community builds of current MongoDB versions for the ARMv8.0 of the PI 4. I decided against them,
because I would have to trust a third party with the database image instead of MongoDB itself)

## How it fits together

Unlike gluetun, LibreChat gets two networks:

- **`chat`** for LibreChat itself. Through this network, it reaches the API of the provider on the internet, and the
  LAN and the WireGuard clients reach its web interface.
- **`chatdb`** for MongoDB and Meilisearch. LibreChat is connected to it as well, so that it can reach its database.
  It is a Docker network with `internal: true`, which has no route to the outside at all.

I separated them because MongoDB and Meilisearch never need the internet, and LibreChat's MongoDB runs without a
password (`--noauth`), as in LibreChat's own compose file. On a network of their own, nothing but LibreChat can
reach them, and they cannot reach anything.

{{< mermaid >}}
flowchart LR
  lan["LAN<br/>10.0.0.0/24"] ---|"10.0.0.1:3080"| fw
  vpn["WireGuard clients<br/>10.0.1.0/24"] ---|"10.0.0.1:3080"| fw
  fw["Router<br/>firewall, NAT"] ---|"TCP 443 only"| inet(("Internet<br/>model API"))
  subgraph chat["br-chat - 10.0.201.0/24 - zone chat"]
    lc["librechat<br/>10.0.201.2"]
  end
  subgraph chatdb["br-chatdb - 10.0.202.0/24 - zone chatdb"]
    lc2["librechat<br/>10.0.202.2"]
    mongo["chat-mongodb<br/>10.0.202.3:27017"]
    meili["chat-meilisearch<br/>10.0.202.4:7700"]
  end
  fw --- lc
  lc -. "same container" .- lc2
  lc2 --- mongo
  lc2 --- meili
{{< /mermaid >}}

| | `chat` | `chatdb` |
|---|---|---|
| Bridge | `br-chat` | `br-chatdb` |
| Subnet | `10.0.201.0/24` | `10.0.202.0/24` |
| Router | `10.0.201.1` | `10.0.202.1`, but no route out, the network is internal |
| LibreChat | `10.0.201.2` | `10.0.202.2` |
| MongoDB | - | `10.0.202.3`, port 27017, not published |
| Meilisearch | - | `10.0.202.4`, port 7700, not published |
| To the internet | TCP port 443 only | nothing |
| From the LAN and the tunnel | TCP port 3080 on `10.0.201.2` only | nothing |
| IPv6 | none | none |

The subnets simply follow `10.0.200.0/24` of the torrent network. The short names are on purpose: Linux limits the
name of a bridge to 15 characters, and fw4 zone names should not be longer than 11 characters, so `librechat_db`
would not work as a zone name.

## Preparing the router

### 1. The firewall zones

As described in the BitTorrent article, the OpenWrt firewall does not know a bridge which Docker creates, unless a
zone refers to it by its name. Both networks get a zone of their own with the strictest rules possible:

- **Nothing into the router** (input reject) from either network.
- **Nothing to the LAN** (no forwarding to `lan`) from either network.
- **To the internet, only TCP port 443** from `chat`, which is HTTPS to the API of the provider.
- **From the LAN and the WireGuard clients, only the web interface**, TCP port 3080 on LibreChat's address.

```shell
root@OpenWrt:~# uci batch <<EOF
set firewall.chat=zone
set firewall.chat.name='chat'
add_list firewall.chat.device='br-chat'
set firewall.chat.input='REJECT'
set firewall.chat.output='ACCEPT'
set firewall.chat.forward='REJECT'
set firewall.chatdb=zone
set firewall.chatdb.name='chatdb'
add_list firewall.chatdb.device='br-chatdb'
set firewall.chatdb.input='REJECT'
set firewall.chatdb.output='ACCEPT'
set firewall.chatdb.forward='REJECT'
set firewall.chat_https=rule
set firewall.chat_https.name='Allow-Chat-HTTPS'
set firewall.chat_https.src='chat'
set firewall.chat_https.dest='wan'
set firewall.chat_https.family='ipv4'
set firewall.chat_https.proto='tcp'
set firewall.chat_https.dest_port='443'
set firewall.chat_https.target='ACCEPT'
set firewall.chat_ui=rule
set firewall.chat_ui.name='Allow-Chat-WebUI'
set firewall.chat_ui.src='lan'
set firewall.chat_ui.dest='chat'
set firewall.chat_ui.dest_ip='10.0.201.2'
set firewall.chat_ui.proto='tcp'
set firewall.chat_ui.dest_port='3080'
set firewall.chat_ui.target='ACCEPT'
set firewall.chat_ui_vpn=rule
set firewall.chat_ui_vpn.name='Allow-Chat-WebUI-VPN'
set firewall.chat_ui_vpn.src='vpn'
set firewall.chat_ui_vpn.dest='chat'
set firewall.chat_ui_vpn.dest_ip='10.0.201.2'
set firewall.chat_ui_vpn.proto='tcp'
set firewall.chat_ui_vpn.dest_port='3080'
set firewall.chat_ui_vpn.target='ACCEPT'
EOF
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# service firewall restart
```

A few notes on this configuration:

- **`chatdb` gets a zone, even though Docker already isolates it.** The input policy of the OpenWrt defaults is
  accept. A bridge which no zone covers falls back to these defaults, so without the zone, MongoDB and Meilisearch
  could reach SSH, LuCI and dnsmasq on the router through the address `10.0.202.1`. The zone rejects that, whether
  Docker puts an address on the bridge or not.
- **There is no `forwarding` from `chat` to `wan`.** As with the torrent network, a forwarding would allow
  everything, the rule only allows HTTPS. The `wan` zone masquerades these packets like everything else.
- **The WireGuard clients need a rule of their own.** The zone `vpn` from the WireGuard article may forward to `lan`
  and `wan`, but the web interface is in the zone `chat`. The rule `Allow-Chat-WebUI-VPN` is the counterpart of
  `Allow-Chat-WebUI` for the tunnel.

In LuCI, the two zones are in Network → Firewall → **General Settings**, and the three rules in **Traffic Rules**.

### 2. The directories

As with the torrent project, everything of LibreChat goes into one directory, `/opt/librechat`:

```text
/opt/librechat/
  compose.yaml       the definition of all three containers
  .env               the secrets and the settings of LibreChat
  data/              temporary data of LibreChat
  images/            generated and uploaded images
  uploads/           uploaded files
  logs/              the log files of LibreChat
  mongodb/           the database
  meilisearch/       the search index
```

LibreChat does not run as root inside its container, but as the user `node` with the ID `1000`. It must be able to
write into its four directories. MongoDB and Meilisearch take care of their directories themselves:

```shell
root@OpenWrt:~# cd /opt && mkdir librechat && cd librechat
root@OpenWrt:/opt/librechat# mkdir data images uploads logs
root@OpenWrt:/opt/librechat# mkdir mongodb meilisearch
root@OpenWrt:/opt/librechat# chown 1000:1000 data images uploads logs
```

### 3. The settings and the secrets

LibreChat takes most of its settings from the file `.env`. Five of them are secrets which LibreChat needs in order to
encrypt stored API keys and to sign the login tokens, and which Meilisearch uses as its password. Without them,
LibreChat generates temporary values on every start, which would log out every user and make stored keys unreadable
after a restart. `openssl rand` generates them, and as in the BitTorrent article, `umask go=` makes sure that the
file is readable for root only. Replace the placeholder with the API key of your provider:

```shell
root@OpenWrt:~# umask go=
root@OpenWrt:~# cat > /opt/librechat/.env <<EOF
DOMAIN_CLIENT=http://10.0.0.1:3080
DOMAIN_SERVER=http://10.0.0.1:3080
SESSION_COOKIE_SECURE=false
NO_INDEX=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ENDPOINTS=anthropic
ANTHROPIC_API_KEY=(your API key)
CREDS_KEY=$(openssl rand -hex 32)
CREDS_IV=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
MEILI_MASTER_KEY=$(openssl rand -hex 32)
EOF
```

- **`DOMAIN_CLIENT` and `DOMAIN_SERVER`** are the address I open LibreChat at, from the LAN as well as through the
  tunnel. LibreChat uses them to build links, and as described in the next section, to decide about its cookies.
- **`SESSION_COOKIE_SECURE=false`** is needed because LibreChat runs on plain HTTP. The next section explains why.
- **`ENDPOINTS=anthropic`** limits the selection in the web interface to the provider I have a key for. Other
  providers work the same way with their own variable, for example `OPENAI_API_KEY`.
- **`ALLOW_REGISTRATION=true`** is only needed for the very first start, so that I can create my account. I switch it
  off afterwards.

The file `.env` must show `-rw-------` and the owner `root` in `ls -la /opt/librechat`.

## Logging in over plain HTTP

LibreChat keeps a user logged in with a refresh token, which it stores in a cookie. By default, it marks this cookie
as [Secure](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#block_access_to_your_cookies) whenever
`NODE_ENV` is `production`, which the image sets, and `DOMAIN_SERVER` is not `localhost`. A browser only accepts a
Secure cookie over HTTPS. Over `http://10.0.0.1:3080`, it silently drops it, and the login only lasts until the next
reload of the page.

`SESSION_COOKIE_SECURE=false` switches this off, and the cookie works over plain HTTP. Please note, this means that
the password and the cookie travel unencrypted through the LAN. For the tunnel, this does not matter, WireGuard
encrypts everything anyway. In my LAN at home, I accept it for now. Putting a reverse proxy with HTTPS in front of
LibreChat would allow me to remove the setting again.

## The compose file

Create `/opt/librechat/compose.yaml` with the following content. It is based on LibreChat's own compose file, with
the networks from above, the memory limits and MongoDB 4.4.18:

```yaml
# /opt/librechat/compose.yaml
services:
  librechat:
    image: registry.librechat.ai/librechat-ai/librechat:v0.8.8
    container_name: librechat
    depends_on:
      - mongodb
      - meilisearch
    networks:
      chat:
        ipv4_address: 10.0.201.2
      chatdb:
        ipv4_address: 10.0.202.2
    ports:
      - 10.0.0.1:3080:3080
    env_file:
      - .env
    environment:
      - HOST=0.0.0.0
      - NODE_ENV=production
      - MONGO_URI=mongodb://mongodb:27017/LibreChat
      - MEILI_HOST=http://meilisearch:7700
      - SEARCH=true
    volumes:
      - /opt/librechat/images:/app/client/public/images
      - /opt/librechat/uploads:/app/uploads
      - /opt/librechat/logs:/app/api/logs
      - /opt/librechat/data:/app/data
    mem_limit: 1g
    restart: unless-stopped

  mongodb:
    image: mongo:4.4.18
    container_name: chat-mongodb
    command: mongod --noauth --wiredTigerCacheSizeGB 0.25
    networks:
      chatdb:
        ipv4_address: 10.0.202.3
    volumes:
      - /opt/librechat/mongodb:/data/db
    mem_limit: 512m
    restart: unless-stopped

  meilisearch:
    image: getmeili/meilisearch:v1.35.1
    container_name: chat-meilisearch
    networks:
      chatdb:
        ipv4_address: 10.0.202.4
    environment:
      - MEILI_MASTER_KEY=${MEILI_MASTER_KEY}
      - MEILI_NO_ANALYTICS=true
    volumes:
      - /opt/librechat/meilisearch:/meili_data
    mem_limit: 512m
    restart: unless-stopped

networks:
  chat:
    name: chat
    driver: bridge
    enable_ipv6: false
    driver_opts:
      com.docker.network.bridge.name: br-chat
    ipam:
      config:
        - subnet: 10.0.201.0/24
          gateway: 10.0.201.1
  chatdb:
    name: chatdb
    driver: bridge
    internal: true
    enable_ipv6: false
    driver_opts:
      com.docker.network.bridge.name: br-chatdb
    ipam:
      config:
        - subnet: 10.0.202.0/24
          gateway: 10.0.202.1
```

A few notes on this file:

- **The image tags are fixed.** LibreChat's own compose file uses `latest` of its development builds. I prefer to
  know which release runs on my router and to upgrade on purpose. All three images are available for arm64.
- **Only LibreChat publishes a port**, and only on the LAN address of the router. MongoDB and Meilisearch have no
  `ports` at all. LibreChat finds them by their service names, `mongodb` and `meilisearch`, which Docker resolves on
  the network `chatdb`.
- **`--wiredTigerCacheSizeGB 0.25`** limits the cache of MongoDB. Without it, MongoDB sizes its cache by the 8GB of
  the PI, not by the 512MB its container may use, and would run into its own memory limit.
- **`internal: true`** gives the network `chatdb` no route to the outside. LibreChat still has one, through `chat`.
- **I left out the volume for `librechat.yaml`.** This file holds advanced settings, such as custom endpoints.
  LibreChat starts without it and only prints a note in its log.

## Starting it

```shell
root@OpenWrt:~# cd /opt/librechat
root@OpenWrt:/opt/librechat# docker-compose up -d
root@OpenWrt:/opt/librechat# docker logs -f librechat
```

LibreChat is ready once its log shows that it is listening on port 3080. Then I open `http://10.0.0.1:3080` from my PC
and register my account. The first account LibreChat creates is an administrator. Afterwards, I switch registration
off, so that nobody else in the LAN can create an account, and recreate the container so that it reads the changed
file:

```shell
root@OpenWrt:/opt/librechat# sed -i \
  's/^ALLOW_REGISTRATION=.*/ALLOW_REGISTRATION=false/' .env
root@OpenWrt:/opt/librechat# docker-compose up -d librechat
```

(Note: `docker-compose restart` would not be enough here. A restart keeps the environment the container was created
with, only `up -d` creates it again with the new `.env`)

The web interface reaches the LAN address of the router in the same way as the one of qBittorrent: Docker's DNAT rule
rewrites `10.0.0.1:3080` to `10.0.201.2:3080`, and the rule `Allow-Chat-WebUI` lets it through the OpenWrt firewall.
The DNAT rule applies to every interface but `br-chat` itself, so it catches the connections from the tunnel as
well, which `Allow-Chat-WebUI-VPN` then lets through. The section about the web interface in the BitTorrent article
shows these rules step by step.

## Tests

None of these tests have been run yet. With all three containers running, the plan is:

| Test | Expected result |
|---|---|
| `docker ps` | All three containers `Up`, none restarting |
| `docker exec librechat nslookup api.anthropic.com` | An address, so name resolution works inside `chat` |
| `docker exec librechat wget -qO- https://api.anthropic.com` | An answer from the API, so HTTPS to the internet works |
| `docker run --rm --network chatdb alpine wget -T 5 -qO- https://example.com` | A timeout or an error, `chatdb` has no way out |
| `netstat -tlnp` on the router | `10.0.0.1:3080` from `docker-proxy`, nothing on 27017 or 7700 |
| Log in at `http://10.0.0.1:3080` and reload the page | Still logged in |
| Search for a word of an earlier conversation | The conversation shows up, so Meilisearch works |
| Open `http://10.0.0.1:3080` on the phone through the tunnel | The login page |
| Open port 3080 from the WAN side | Nothing |
| `docker stats --no-stream` after a few days | All three containers well below their limits |

## Open points

- **Name resolution inside `chat`.** The containers use Docker's built-in DNS server, which forwards everything it
  does not know to the DNS server of the router. On the router, that is `127.0.0.1`, dnsmasq. As far as I know,
  current Docker versions send such queries from the router itself, so the zone `chat` needs no rule for DNS into the
  router. The `nslookup` test above will show it.
- **MongoDB 4.4 and future LibreChat releases.** LibreChat v0.8.8 works with MongoDB 4.4 as far as I know. A later
  release could require a newer MongoDB, which the PI 4 cannot run. Before each upgrade, I will check LibreChat's
  release notes for that.
- **Only TCP 443 to the internet.** That is all LibreChat needs for the API of the provider. Features such as web
  search or plugins could need more, the rule `Allow-Chat-HTTPS` is the place to look first.

## Files to keep across upgrades

Nothing to add to `/etc/sysupgrade.conf`. The two zones and their three rules are part of the uci configuration.
Everything else, including the secrets in `.env` and the database, is under `/opt/librechat` on the data partition,
which a firmware upgrade does not touch. Keep in mind that this directory is not part of the uci backup, and that
losing `.env` makes the API keys stored in the database unreadable, so it needs a backup of its own.

## Summary and next steps

The plan is LibreChat with MongoDB 4.4.18 and Meilisearch on the router, in two Docker networks with their own
firewall zones: LibreChat may only reach the API of the provider over HTTPS, and its database and search index can
reach nothing at all. The web interface is published on the LAN address of the router, for the LAN and the WireGuard
clients only. With 2GB of memory for all three containers, the PI has enough left for routing. Once the tests above
have passed, I will replace this plan with what is actually running.
