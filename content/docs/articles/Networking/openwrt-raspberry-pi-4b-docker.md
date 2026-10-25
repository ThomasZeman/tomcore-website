---
weight: 7
title: "OpenWrt on a Raspberry PI 4B: Docker"
draft: true
aiAssisted: true
---
# OpenWrt on a Raspberry PI 4B: Docker

{{% hint info %}}
**Work in progress, October 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94 and Docker 29.6.1. This is the
second part of a series and describes what is running today.
{{% /hint %}}

In [OpenWrt on a Raspberry PI 4B: Essentials](openwrt-raspberry-pi-4b-essentials) I described why I run OpenWrt on
the PI, how it boots from an SSD and why the SSD has a large data partition mounted at `/opt`. If you haven't read
that article yet, I suggest doing so first, because this one builds on it: the Docker packages are part of the
firmware image built there, the root partition has 1GB for them, and `/opt` holds all Docker data.

What OpenWrt does not do by itself, such as a Git server with a web interface, runs in Docker on the same box. This
article describes how I installed Docker so that it works with the OpenWrt firewall, and, more importantly, in a way
that a runaway container cannot take the router down with it.

## Packages

The Docker packages went into the firmware image together with everything else, so Docker was installed on the
first boot of the SSD:

```text
dockerd docker docker-compose luci-app-dockerman
```

`dockerd` is the daemon, `docker` the command line client, and `luci-app-dockerman` adds a Docker page to the web
interface. Please note that the binaries alone (`dockerd`, `containerd`, `runc` and the CLI) are far bigger than the
72MB of free space the stock root partition leaves, which is why the root partition is 1GB in my image.

## First start

With the packages in the image and the data on the SSD, Docker was running after the first boot:

```shell
root@OpenWrt:~# docker info \
  | grep -E "Server Version|Storage Driver|Cgroup|Docker Root Dir|WARNING"
 Server Version: 29.6.1
 Storage Driver: overlayfs
 Cgroup Driver: cgroupfs
 Cgroup Version: 2
 Docker Root Dir: /opt/docker/
WARNING: No memory limit support
WARNING: No swap limit support
```

OpenWrt's Docker package stores its data in `/opt/docker/` by default (`data_root` in `/etc/config/dockerd`), and
`/opt` is mounted by `fstab` (S11) long before `dockerd` starts (S99). The two warnings at the end are the topic of
the section about memory below.

The first `docker run --rm hello-world` failed with
`adding interface veth28c0f5d to bridge docker0 failed: Device does not exist`. On its very first start, the
`dockerd` init script adds a `docker` interface and firewall zone to the OpenWrt configuration and reloads the
network, and that reload removed the `docker0` bridge Docker had just created. A restart of `dockerd` fixed it, and
it has not come back on any of the following boots.

## Docker and the OpenWrt firewall

The Docker package comes with this note in `/etc/config/dockerd`:

```text
# Docker doesn't work well out of the box with fw4. This is because Docker relies on a compatibility layer that
# naively translates iptables rules.
```

By default, it blocks all traffic from the WAN to `docker0`. That sounds right, but it includes the replies to
connections the containers open themselves, so the containers had no internet access at all. Two changes fixed that:
a forwarding from the `docker` zone to `wan`, and an exception for replies in Docker's WAN block (the option is
already in the file, commented out with the remark "allow outbound connections"):

```shell
root@OpenWrt:~# S=$(uci add firewall forwarding)
root@OpenWrt:~# uci set firewall.$S.src='docker'
root@OpenWrt:~# uci set firewall.$S.dest='wan'
root@OpenWrt:~# uci commit firewall
root@OpenWrt:~# ARGS='--match conntrack ! --ctstate RELATED,ESTABLISHED'
root@OpenWrt:~# uci set dockerd.firewall.extra_iptables_args="$ARGS"
root@OpenWrt:~# uci commit dockerd
```

New connections from the WAN to the containers are still rejected, and the containers cannot reach the LAN. Please
note, as the comment in the config says, the firewall changes are only additive: the old rule stays loaded until the
firewall and then Docker are restarted. A reboot is the simplest way.

## Keeping Docker from starving the router

A router running Docker must never run out of memory for routing just because a container misbehaves. On the PI,
nothing prevented that: the PI firmware adds `cgroup_disable=memory` to every kernel command line, so the kernel's
memory controller is switched off, and Docker cannot limit memory, neither per container nor in total:

```shell
root@OpenWrt:~# cat /sys/fs/cgroup/cgroup.controllers
cpuset cpu io pids rdma
```

Appending `cgroup_enable=memory` to `/boot/cmdline.txt` overrides that. It is a boot file, so I made a backup copy
first and checked that the `root=PARTUUID=e875e867-02` part was unchanged:

```shell
root@OpenWrt:~# cp /boot/cmdline.txt /boot/cmdline.txt.bak
root@OpenWrt:~# sed -i "1s/\$/ cgroup_enable=memory/" /boot/cmdline.txt
root@OpenWrt:~# cat /boot/cmdline.txt
console=tty1 console=serial0,115200 root=PARTUUID=e875e867-02 rootfstype=squashfs,ext4 rootwait cgroup_enable=memory
```

Docker creates every container's cgroup under `/sys/fs/cgroup/docker`. Instead of setting limits on each container,
a small init script caps that group as a whole, before `dockerd` starts:

```shell
root@OpenWrt:~# cat /etc/init.d/docker-memcap
#!/bin/sh /etc/rc.common
# Cap the memory of all Docker containers combined so a runaway container
# can never starve routing. Runs before dockerd (S99), which then creates
# every container cgroup under /sys/fs/cgroup/docker.

START=98

CG=/sys/fs/cgroup
DOCKER_CG=$CG/docker
MEM_HIGH=5632M
MEM_MAX=6G
SWAP_MAX=2G

start() {
  if ! grep -qw memory $CG/cgroup.controllers; then
    logger -t docker-memcap -p err "memory controller unavailable, Docker is NOT capped (check cgroup_enable=memory in /boot/cmdline.txt)"
    return 1
  fi

  grep -qw memory $CG/cgroup.subtree_control || echo +memory > $CG/cgroup.subtree_control
  mkdir -p $DOCKER_CG
  echo $MEM_HIGH > $DOCKER_CG/memory.high
  echo $MEM_MAX > $DOCKER_CG/memory.max
  [ -f $DOCKER_CG/memory.swap.max ] && echo $SWAP_MAX > $DOCKER_CG/memory.swap.max

  logger -t docker-memcap "docker cgroup capped: high=$(cat $DOCKER_CG/memory.high) max=$(cat $DOCKER_CG/memory.max) swap.max=$(cat $DOCKER_CG/memory.swap.max 2>/dev/null || echo n/a)"
}
root@OpenWrt:~# chmod +x /etc/init.d/docker-memcap
root@OpenWrt:~# /etc/init.d/docker-memcap enable
```

- `memory.max = 6G`: all containers together can never use more than this. That leaves 2GB for the router itself,
  which currently uses about 140MB.
- `memory.high = 5.5G`: containers are slowed down before they reach the hard limit.
- `memory.swap.max = 2G`: Docker may push at most 2GB into swap.

As a safety net, I also added an 8GB swap file on `/opt`. I chose a file over a swap partition on purpose: a new
partition means another change to the partition table, and the Essentials article shows what that can do to the
disk ID. Setting `vm.swappiness` to 10 means the kernel only swaps when memory is actually short:

```shell
root@OpenWrt:~# dd if=/dev/zero of=/opt/swapfile bs=4M count=2048 conv=fsync
root@OpenWrt:~# chmod 600 /opt/swapfile
root@OpenWrt:~# mkswap /opt/swapfile
root@OpenWrt:~# S=$(uci add fstab swap)
root@OpenWrt:~# uci set fstab.$S.device='/opt/swapfile'
root@OpenWrt:~# uci set fstab.$S.enabled='1'
root@OpenWrt:~# uci commit fstab
root@OpenWrt:~# echo "vm.swappiness=10" >> /etc/sysctl.conf
```

Swap alone would not protect routing. Without the cap, a runaway container would push the whole system into swap and
routing would slow to a crawl. The cap is the real protection.

### Test

To test the cap, I ran a container with `stress-ng` that tries to allocate 9GB, while my PC pinged the router and
I checked SSH and the internet connection from the router:

```shell
root@OpenWrt:~# docker run --rm --name memhog alpine \
  sh -c "apk add -q stress-ng && \
  stress-ng --vm 1 --vm-bytes 9G --vm-keep --timeout 90s"
```

(Note: my first attempt with `head -c 9G /dev/zero` did nothing, because BusyBox's `head` does not understand the
`9G` suffix)

| | Result |
|---|---|
| Docker RAM | Rose to about 5.7GiB and stayed there, the `memory.high` level |
| Docker swap | Filled its 2GiB allowance and stopped |
| Available memory for the router | Never below 1.8GiB |
| Ping from the PC to the router | 150 sent, 150 received, max 8ms |
| SSH login | 1.3 seconds |
| Ping from the router to the internet | About 14ms, as usual |

So the router itself was not affected at all. But the container was not killed either. The kernel throttled it at
the `memory.high` level 173,815 times, the out-of-memory killer never fired (`oom_kill 0`), and the container, which
should have finished after 90 seconds, was still frozen after 6 minutes until I stopped it. My interpretation is that
`memory.high` together with free swap space keeps a runaway container alive in a hung state rather than ending it.
I am considering removing `memory.high` so that the hard limit applies directly. A container that runs out of memory
would then be killed straight away, and Docker can restart it with `restart: unless-stopped`.

## Files to keep across upgrades

The init script is not part of the uci configuration, so it goes into `/etc/sysupgrade.conf` together with the link
that enables it:

```shell
root@OpenWrt:~# cat >> /etc/sysupgrade.conf <<EOF
/etc/init.d/docker-memcap
/etc/rc.d/S98docker-memcap
EOF
```

`/boot/cmdline.txt`, `/etc/sysctl.conf` and the uci configuration (firewall, fstab and dockerd) are part of the
backup anyway.

## Summary and next steps

Docker runs on the router with its data on the SSD, its containers can reach the internet but not the LAN, and all
containers together are capped at 6GB so that routing always has memory left. The first real container will be a
Git server with a web interface (Forgejo), with its data under `/opt` and its ports only bound to the LAN.
