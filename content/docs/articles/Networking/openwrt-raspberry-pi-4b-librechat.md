---
weight: 12
title: "OpenWrt on a Raspberry PI 4B: LibreChat"
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: LibreChat

{{% hint info %}}
**Built in November 2026** on a Lenovo ThinkCentre M90q with Ubuntu 26.04.1 LTS, kernel 7.0.0, Docker 29.10.0,
Docker Compose v5.8.0 and LibreChat v0.8.9. The web interface, the accounts and the restart after a reboot work. No
model provider is connected yet, I will add AWS Bedrock next and update this article then.
{{% /hint %}}

This part of the series is about [LibreChat](https://www.librechat.ai/), an open source web interface for chatting
with large language models, similar to the web interfaces of the model providers themselves. I use it with the API of
a provider, which means I pay per use instead of a monthly subscription per person, and the conversations are stored
at home instead of in somebody else's account. The models themselves still run in the data centers of the provider.
LibreChat only serves the web interface, stores the conversations and passes the requests on.

My first plan was to run LibreChat on the router itself, in Docker networks of its own, like the
[BitTorrent client](openwrt-raspberry-pi-4b-bittorrent-vpn) and [Gitea](openwrt-raspberry-pi-4b-gitea). I changed
that plan. LibreChat now runs on a small separate PC in the LAN, and the router only provides three things for it: a
fixed address, the name `chat.lan` and access from away through the
[WireGuard server](openwrt-raspberry-pi-4b-wireguard). It is meant for the whole family, from the LAN or through the tunnel.
It is not reachable from the internet, and it is not supposed to be.

(Note: the user name and the host name in the prompts below are made up, as is the MAC address)

## Why not on the router

When I prepared the router plan, I ran into one real obstacle: MongoDB. Since version 5.0, MongoDB requires the
ARMv8.2-A instruction set, and the Cortex-A72 of the Raspberry PI 4B only implements ARMv8.0. Current MongoDB images
crash with "Illegal instruction" on the PI, and the last official image which runs there, `mongo:4.4.18`, reached its
end of life in February 2024. LibreChat's own compose file uses MongoDB 8.0.

On an x86 PC, none of this is an issue. LibreChat's compose file runs as it is, with all its containers, and an
upgrade of LibreChat does not depend on an old database. It also keeps the router free for what it is there for. The
memory a chat server needs is not much, but it is memory which the router does not have to share.

## The server

The PC is a Lenovo ThinkCentre M90q, a so-called tiny PC which needs about as much space as a book:

| | |
|---|---|
| CPU | Intel Core i5-10500T, 6 cores, 12 threads |
| RAM | 14GB usable |
| Disk | NVMe SSD, 233GB root file system with 208GB free |
| OS | Ubuntu 26.04.1 LTS, kernel 7.0.0-44-generic |
| Network | Gigabit Ethernet in the LAN |

This is far more than LibreChat needs. With all five containers running and nobody chatting, they use about 1.1GB
of memory together, and the CPU is idle. It is worth mentioning that this is still not a machine for local models.
Without a graphics card, only small models run, and they generate a few tokens per second at most. The heavy work
stays at the provider.

## How it fits together

{{< mermaid >}}
flowchart LR
  phone["Phone, away from home<br/>10.0.1.2"] -. "WireGuard tunnel" .-> wg0
  lanc["PC, phones and tablets<br/>in the LAN"]
  subgraph pi["Router - OpenWrt"]
    wg0["wg0 - zone vpn"] -- "forwarding<br/>vpn to lan" --> brlan["br-lan - zone lan<br/>10.0.0.1"]
    dns["dnsmasq<br/>chat.lan = 10.0.0.196"]
  end
  subgraph m90q["ThinkCentre M90q - Ubuntu - 10.0.0.196"]
    lc["LibreChat<br/>port 80 to 3080"]
    mongo["MongoDB 8.0"]
    meili["Meilisearch"]
    rag["RAG API and<br/>PostgreSQL with pgvector"]
  end
  brlan -- "http://chat.lan" --> lc
  lanc -- "http://chat.lan" --> lc
  lanc -. "chat.lan?" .-> dns
  phone -. "chat.lan?" .-> dns
  lc --- mongo
  lc --- meili
  lc --- rag
  lc -. "HTTPS to the model API<br/>not connected yet" .-> inet(("Internet"))
{{< /mermaid >}}

- **In the LAN, the router is not involved.** The PC, the phones and the server are in the same subnet, so a browser
  talks to the server directly. The router only answers the DNS query for `chat.lan`.
- **From the tunnel, the router routes.** The zone `vpn` has a forwarding to `lan`, so the phone may reach every
  device in the LAN, including the server. Unlike the services in the Docker networks of the router, LibreChat needs
  no firewall rule of its own on the router. The NAS section of the
  [Network Architecture](openwrt-raspberry-pi-4b-network-architecture) explains the way back in detail, and it is
  the same here: the server gets its gateway `10.0.0.1` by DHCP and sends its replies to the tunnel through the
  router.
- **From the internet, nothing gets in.** There is no port forwarding on the router, and the zone `wan` drops
  everything towards the LAN, also over IPv6.

## Docker

I installed Docker Engine and the Compose plugin from Docker's own repository, as Docker recommends for Ubuntu. It
already had a section for Ubuntu 26.04 (`resolute`):

```shell
user@m90q:~$ sudo apt-get install -y ca-certificates curl
user@m90q:~$ sudo install -m 0755 -d /etc/apt/keyrings
user@m90q:~$ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
user@m90q:~$ echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu resolute stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
user@m90q:~$ sudo apt-get update
user@m90q:~$ sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
user@m90q:~$ sudo systemctl enable --now docker containerd
user@m90q:~$ sudo usermod -aG docker $USER
```

The last command lets my user run `docker` without `sudo`. It takes effect with the next login.

## LibreChat

### 1. The files

LibreChat is installed from its Git repository, which contains the compose file, an example of the `.env` file and an
example of `librechat.yaml`:

```shell
user@m90q:~$ git clone https://github.com/danny-avila/LibreChat.git librechat
user@m90q:~$ cd librechat
user@m90q:~/librechat$ cp .env.example .env && chmod 600 .env
```

The compose file of the repository is not meant to be edited. Changes go into `docker-compose.override.yml`, which
Docker Compose reads automatically and merges with it. This keeps a later `git pull` free of conflicts.

### 2. The settings and the secrets

LibreChat takes most of its settings from `.env`. Five of them are secrets: LibreChat uses them to encrypt stored API
keys and to sign the login tokens, and Meilisearch uses one as its password. Each of them gets a random value of its
own, which `openssl rand -hex 32` generates (`-hex 16` for `CREDS_IV`). These are the lines I changed:

```text
DOMAIN_CLIENT=http://chat.lan
DOMAIN_SERVER=http://chat.lan
UID=1000
GID=1000
SEARCH=true
ALLOW_REGISTRATION=true
ALLOW_EMAIL_LOGIN=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_PASSWORD_RESET=false
CREDS_KEY=(64 random hex characters)
CREDS_IV=(32 random hex characters)
JWT_SECRET=(64 random hex characters)
JWT_REFRESH_SECRET=(64 random hex characters)
MEILI_MASTER_KEY=(64 random hex characters)
SCHEDULES_SINGLE_PROCESS=true
SESSION_COOKIE_SECURE=false
```

- **`DOMAIN_CLIENT` and `DOMAIN_SERVER`** are the address the family opens LibreChat at. LibreChat builds its links
  from them and, as described further below, decides about its cookies.
- **`UID` and `GID`** are the IDs of my user on the server. The compose file runs LibreChat, MongoDB and Meilisearch
  with them, so that the files in the data directories belong to my user and not to root.
- **`ALLOW_PASSWORD_RESET=false`**, because the server sends no mails. A reset link would never arrive.
- **`SCHEDULES_SINGLE_PROCESS=true`** tells LibreChat that it runs as a single instance. Without it, v0.8.9 logs an
  error on every start and refuses to run scheduled tasks, because it cannot rule out a second instance which it
  does not know about.
- **`SESSION_COOKIE_SECURE=false`** is needed for plain HTTP, the section about HTTP below explains why.

### 3. The override file

```yaml
# ~/librechat/docker-compose.override.yml
services:
  api:
    # Stable release instead of the nightly -dev image.
    image: registry.librechat.ai/librechat-ai/librechat:latest
    # Serve on port 80 so http://chat.lan works without a port.
    ports: !override
      - "80:${PORT}"
    volumes:
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
  # Admin panel off for now.
  admin-panel:
    profiles: ["admin"]
```

A few notes on this file:

- **The stable image.** The compose file of the repository uses `librechat-dev:latest`, a nightly build of the
  development branch. For a server the whole family uses, I prefer the releases.
- **Port 80.** The compose file publishes port 3080. `!override` replaces this list instead of adding to it, so port
  3080 is no longer published at all. Inside the container, LibreChat still listens on 3080.
- **`librechat.yaml`** holds the advanced settings, such as the model providers later on. The compose file does not
  mount it, and without it, LibreChat logs an error on every start. For now, my file only contains two lines:
  `version: 1.3.19` and `cache: true`.
- **The admin panel.** The compose file of v0.8.9 also starts an admin panel on port 3000, a web interface to manage
  users, groups, roles and settings. I do not need it yet. The profile `admin` keeps it from starting, unless I ask
  for it explicitly with `docker compose --profile admin up -d`.

### 4. Starting it

```shell
user@m90q:~/librechat$ docker compose pull
user@m90q:~/librechat$ docker compose up -d
user@m90q:~/librechat$ docker compose ps
```

These are the five containers, with their memory usage shortly after the start:

| Container | Image | What it does | Memory |
|---|---|---|---|
| `LibreChat` | `librechat:latest`, v0.8.9 | The web interface and the API, a Node.js application | 509MB |
| `chat-mongodb` | `mongo:8.0.20` | Stores users, conversations and settings | 217MB |
| `chat-meilisearch` | `getmeili/meilisearch:v1.35.1` | Full-text search across the conversations | 131MB |
| `rag_api` | `librechat-rag-api-dev-lite:latest` | Indexes uploaded documents, so they can be asked about | 157MB |
| `vectordb` | `pgvector/pgvector:0.8.0-pg15-trixie` | PostgreSQL with pgvector, the storage of the RAG API | 65MB |

Only LibreChat publishes a port. MongoDB, Meilisearch and PostgreSQL are only reachable inside the Docker network of
the project. Please note, the RAG API needs an embedding model to index documents, and it has none yet. Document
uploads will only work once a provider is connected.

All containers have `restart: always` in the compose file, and the Docker service itself starts at boot. So I did not
have to set up anything else for a reboot. I rebooted the server, and a few seconds after SSH came back, all five
containers were up and the login page answered.

### 5. Changing `.env` later

One thing cost me some time. The compose file mounts `.env` as a single file into the container. If the file is
changed with `sed -i`, or by an editor which writes a new file instead of changing the existing one, the container
still sees the old file. On top of that, `docker compose up -d` does not create the container again, since nothing in
the compose file changed. The new setting is simply ignored, without any message. After a change to `.env`, I
therefore always run:

```shell
user@m90q:~/librechat$ docker compose up -d --force-recreate api
```

## Accounts

Everybody in the family creates their own account on the login page, with a mail address and a password of their
own. I do not hand out accounts or passwords. A few things are worth knowing about it:

- **The first account becomes the administrator.** LibreChat gives the role `ADMIN` to the very first account it
  creates. So I register first, before anybody else.
- **Anybody who can reach the login page can register**, as long as `ALLOW_REGISTRATION=true`. In my LAN, that
  includes guests in the Wi-Fi. Once the family has registered, I will set it to `false` and only switch it on again
  for a few minutes when somebody new needs an account.
- **The mail address is not verified.** Without a mail server, LibreChat cannot send a confirmation, and
  `ALLOW_UNVERIFIED_EMAIL_LOGIN=true` from the example file lets the account work anyway. The address is only a login
  name here.
- **A forgotten password** cannot be reset by mail. As the administrator, I can set a new one on the server with
  `docker exec -it LibreChat npm run reset-password`.

LibreChat can also log in with Google and other providers, but Google only accepts an HTTPS address on a real domain
as the target of its login. That does not fit the setup below, so I left it switched off.

## The router: a fixed address and a name

The server gets its address via DHCP from the router, like every other device in the LAN. To make sure it keeps it,
the router has a static lease for it, and a static DNS entry gives it the name `chat.lan`. In LuCI, both are in
Network → DHCP and DNS, under **Static Leases** and **Hostnames**. On the command line:

```shell
root@router:~# uci batch <<EOF
set dhcp.m90q=host
set dhcp.m90q.name='m90q'
set dhcp.m90q.mac='00:11:22:33:44:55'
set dhcp.m90q.ip='10.0.0.196'
set dhcp.chat=domain
set dhcp.chat.name='chat'
set dhcp.chat.ip='10.0.0.196'
EOF
root@router:~# uci commit dhcp
root@router:~# service dnsmasq reload
root@router:~# nslookup chat.lan 127.0.0.1
Server:    127.0.0.1
Address:  127.0.0.1:53

Name:  chat.lan
Address: 10.0.0.196
```

dnsmasq completes the entry `chat` with its local domain to `chat.lan`, in the same way as `gitea.lan` from the
[Gitea article](openwrt-raspberry-pi-4b-gitea). The phone in the tunnel uses the router as its DNS server, so the
name works there as well.

## Plain HTTP, and why `http://` has to be typed

LibreChat runs on plain HTTP, there is no certificate. This has three consequences which everybody using it notices.

### 1. The browser searches instead of opening the page

Typing only `chat.lan` into Chrome on Android does not open the page. Chrome sends it to Google as a search query
instead. Chrome only treats an input as an address if it ends in a top-level domain from the
[Public Suffix List](https://publicsuffix.org/), and `.lan` is not on it. The address has to be typed in full:

```text
http://chat.lan
```

`chat.lan/` with a slash at the end works as well. In practice, everybody types it once and then uses a bookmark or
a shortcut on the home screen.

### 2. Port 443 must be refused, not dropped

Current browsers try HTTPS first, even when the address was typed without `https://`. Nothing listens on port 443 on
the server, and its firewall (`ufw`, which only allowed SSH from the LAN) silently dropped such connections. The
browser then waited for an answer instead of falling back to HTTP right away. With the router's
`/proc/net/nf_conntrack`, I could see the phone sending its connection attempts to port 443 of the server, and none to
the port of LibreChat. Rejecting port 443 makes the server answer with a reset, and the browser falls back to HTTP
immediately:

```shell
user@m90q:~$ sudo ufw reject 443/tcp
```

It is worth mentioning that `ufw` does not see port 80 at all. Docker publishes ports with rules of its own, which
come before the rules of `ufw`. That is why LibreChat is reachable from the tunnel network `10.0.1.0/24`, even though
`ufw` only knows the LAN. Here, that is what I want. On a server which is reachable from the internet, it would be a
trap.

### 3. The login cookie must not be Secure

LibreChat keeps a user logged in with a refresh token in a cookie. In v0.8.9, the function
`shouldUseSecureCookie()` marks this cookie as
[Secure](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#block_access_to_your_cookies) whenever
`NODE_ENV` is `production`, which the image sets, and `DOMAIN_SERVER` is not `localhost`. A browser only stores a
Secure cookie over HTTPS. Over `http://chat.lan`, it would drop it silently, and the login would only last until the
next reload of the page. `SESSION_COOKIE_SECURE=false` switches this off.

Please note, this means that passwords and cookies travel unencrypted through the LAN. Through the tunnel, this does
not matter, WireGuard encrypts everything anyway. In my LAN at home, I accept it.

### What I tried instead

My first idea was a different top-level domain which is on the Public Suffix List, together with a static entry for
just that one name on the router. I tried `chat.house`: `.house` is a real top-level domain, it is not on Chrome's
HSTS preload list (unlike `.app` or `.dev`, which only work with HTTPS), and the name `chat.house` had no address on
the internet. Chrome then opened `chat.house` directly. But for a plain HTTP page under a real top-level domain,
Chrome shows a warning that the site does not support a secure connection. For `.lan`, it does not.

The only clean way out is a real certificate, and a certificate from Let's Encrypt is only issued for a domain I own.
`chat.house` belongs to somebody else since 2018. A certificate authority of my own would work technically, but its
root certificate would have to be installed on every phone and laptop of the family, and such a certificate could
intercept all HTTPS traffic of these devices, not only LibreChat. I do not want to ask anybody to install that.

So I went back to `chat.lan` and plain HTTP. A domain of my own with Let's Encrypt and a small reverse proxy on the
server would remove all three consequences above, and it would also allow the login with Google. It costs money every
year, and for now, typing `http://` is good enough.

## Tests

| Test | Result |
|---|---|
| `docker compose ps` | All five containers `Up`, none restarting |
| Log of LibreChat after the start | No errors, `Server listening on all interfaces at port 3080` |
| `http://chat.lan` from the PC in the LAN | The login page |
| `http://chat.lan` from the phone through the WireGuard tunnel | The login page |
| Port 3080 after the change to port 80 | Connection refused |
| `https://chat.lan` | Connection refused right away, no waiting |
| Reboot of the server | All five containers back without any action, the login page answers |
| Log in, reload the page | Not tested yet |
| Chat with a model | Not possible yet, no provider is connected |

## Open points

- **The model provider.** AWS Bedrock is next, with an IAM user of its own which may only call the models.
- **Registration.** It is still open. It gets switched off once the family has registered.
- **Backups.** Nothing backs up the server yet. The important parts are the directory `data-node` with the MongoDB
  database and the file `.env`. Losing `.env` makes the API keys stored in the database unreadable, so it needs to
  be in the backup as well.
- **Upgrades.** `latest` follows the releases, which means `docker compose pull` and `up -d` upgrade LibreChat to
  whatever is current. Before each upgrade, I will read the release notes.

## Summary

LibreChat runs on a small separate PC in my LAN instead of the router, with LibreChat's own compose file and an
override for the stable image and port 80. The router gives it a fixed address, the name `chat.lan` and access
through WireGuard, without a single new firewall rule. Since there is no certificate, the address has to be typed as
`http://chat.lan`, and the login cookie must not be marked Secure.
