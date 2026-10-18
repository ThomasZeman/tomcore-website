---
weight: 5
title: "OpenWrt on a Raspberry PI 4B: Essentials"
draft: true
---
# OpenWrt on a Raspberry PI 4B: Essentials

{{% hint info %}}
**Work in progress, October 2026.** Built on OpenWrt 25.12.5 with kernel 6.12.94. This is the first part of a series
and describes what is running today. Later parts will cover the WireGuard server, the VLAN that exits in another
country and the first Docker containers.
{{% /hint %}}

For a few years my Raspberry PI ran Alpine Linux as a home router. I configured the network interfaces, nftables and
a couple of Docker containers (dnsmasq and Pi-hole) by hand and started to write down every step on this site. Those
notes were never finished, and every new feature, such as a WireGuard tunnel routed through its own VLAN, meant more
hand-written firewall rules.

So I decided to start over with [OpenWrt](https://openwrt.org/). Routing, the firewall, DHCP, WireGuard and VLANs
come out of the box, together with a web interface (LuCI). What OpenWrt does not do by itself, such as a Git server
with a web interface, will run in Docker on the same box. I did not want to run a second device with another power
adapter for that.

This article describes the foundation: the hardware, the installation, the quirks of the USB network adapter, moving
the system from the SD card to an SSD, and installing Docker in a way that a runaway container cannot take the router
down with it.

## Hardware

| Part | What I use |
|---|---|
| Board | Raspberry PI 4 Model B Rev 1.4, 8GB RAM |
| LAN | The built-in Gigabit Ethernet port (`eth0`) |
| WAN | A USB 3.0 2.5G Ethernet adapter based on the Realtek RTL8156 chip (`eth1`) |
| Storage | A Samsung 840 EVO 250GB SATA SSD in a USB 3.0 enclosure with an ASMedia ASM1051 bridge chip |
| SD Card | Only needed for the first installation, not anymore |

In my [USB network performance](/docs/articles/RaspberryPI/raspberry-pi-4b-usb-network-performance/)
article, the Realtek RTL8153 clearly outperformed the ASIX ax88179 on the PI, which is why I stayed with Realtek and
picked its 2.5G successor. Keep in mind, as described in that article, that all USB devices share one interrupt
which is always handled by CPU0. With the WAN adapter and the SSD on the two blue USB 3.0 ports, network and disk
traffic now compete for that one interrupt.

{{< mermaid >}}
flowchart LR
    inet(("Internet")) --- up["NBN HFC modem<br/>(coax)"]
    up ---|"eth1 - USB 2.5G"| pi
    subgraph pi["Raspberry PI 4B - OpenWrt"]
        r["Routing, firewall,<br/>DHCP, DNS"]
        d["Docker"]
    end
    ssd[("USB SSD<br/>boot, root, /opt")] --- pi
    pi ---|"eth0 - built-in<br/>10.0.0.1/24"| lan["LAN"]
{{< /mermaid >}}

On the WAN side, the PI connects to an Australian NBN HFC (coax) modem. The modem does not route by itself, it only
bridges the cable connection to Ethernet, so the PI is the only router in the house and gets the public address
directly. (Note: depending on the provider, the WAN uses DHCP or PPPoE. The image contains `ppp-mod-pppoe` for the
latter)

## Installing OpenWrt

There is a chicken-and-egg problem with a USB WAN port: a stock OpenWrt image does not include the driver for the
Realtek adapter, and without the driver, the PI cannot get online to install it. The way out is to build an image
which already contains the driver. The [OpenWrt Firmware Selector](https://firmware-selector.openwrt.org/) does that
online: select "Raspberry Pi 4B/400/CM4 (64bit)", open "Customize installed packages" and add at least:

```text
kmod-usb-net-rtl8152 r8152-firmware usb-modeswitch usbutils
```

(Note: `kmod-usb-net-rtl8152` is the driver for the whole RTL815x family, including the RTL8156)

I picked the ext4 image instead of squashfs because I knew I was going to install many packages later. I wrote it to
the SD Card with Raspberry PI Imager ("Use custom"). OpenWrt boots with the LAN address `192.168.1.1` and a root
account without password, so connect a PC directly to the built-in port, open `http://192.168.1.1` and set a root
password first (System → Administration).

My network configuration is small. The LAN moved to `10.0.0.1/24` (the same subnet as in my old Alpine setup) and
the WAN is the USB adapter, configured via DHCP:

```shell
root@OpenWrt:~# uci show network
...
network.@device[0]=device
network.@device[0].name='br-lan'
network.@device[0].type='bridge'
network.@device[0].ports='eth0'
network.lan=interface
network.lan.device='br-lan'
network.lan.proto='static'
network.lan.ipaddr='10.0.0.1/24'
network.lan.ip6assign='64'
network.wan=interface
network.wan.device='eth1'
network.wan.proto='dhcp'
network.wan6=interface
network.wan6.device='eth1'
network.wan6.proto='dhcpv6'
```

## The USB adapter is missing in the Port status

Everything worked, but the overview page of the web interface showed only one port, `eth0`, in its "Port status"
box. The WAN port was not there, even though it was up and passing traffic.

The box does not look at which interfaces actually exist. It asks the router for its built-in Ethernet ports
(`getBuiltinEthernetPorts` in `/usr/share/rpcd/ucode/luci`), and that function reads the `lan` and `wan` entries
in `/etc/board.json`:

```shell
root@OpenWrt:~# ubus call luci getBuiltinEthernetPorts
{
        "result": [
                {
                        "role": "lan",
                        "device": "eth0"
                }
        ]
}
```

`board.json` is generated once at first boot from the hardware profile of the board, and the profile of the
Raspberry PI 4 only knows its single built-in port. The function has a workaround that scans for additional `ethN`
devices, but it only runs on x86_64:

```text
/* Workaround for targets that do not enumerate  all netdevs in board.json */
if (uname().machine in [ 'x86_64' ] &&
```

The durable fix is a small script in `/etc/board.d/`, written in the same style as the stock `02_network` script,
which declares `eth1` as the WAN port:

```shell
root@OpenWrt:~# cat /etc/board.d/03_usb_wan
# Declare the USB Ethernet adapter as the WAN port. The Raspberry Pi
# profile in 02_network only knows the onboard eth0, so without this
# board.json has no wan entry and LuCI's Port status omits eth1.

. /lib/functions/uci-defaults.sh

board_config_update

ucidef_set_interface_wan "eth1"

board_config_flush

exit 0
```

However, the `board.d` scripts only run when `board.json` does not exist yet. Do not delete `board.json` to force
a rebuild: I tested that by generating a fresh file into `/tmp`, and the result was missing its `wlan` section,
which is added by the Wi-Fi setup and not by these scripts. Instead, I backed up the file and added only the `wan`
entry:

```shell
root@OpenWrt:~# cp /etc/board.json /etc/board.json.bak
root@OpenWrt:~# ucode -l fs -e 'let f="/etc/board.json"; let b=json(fs.readfile(f)); b.network.wan={device:"eth1",protocol:"dhcp"}; fs.writefile(f, sprintf("%.J\n", b));'
root@OpenWrt:~# jsonfilter -i /etc/board.json -e "@.network"
{ "lan": { "device": "eth0", "protocol": "static" }, "wan": { "device": "eth1", "protocol": "dhcp" } }
```

After a reload of the overview page, both ports show up. Routing and DHCP do not read `board.json`, so this change
does not touch the live network at all.

A firmware upgrade only keeps files listed in `/etc/sysupgrade.conf`, so the script goes in there:

```shell
root@OpenWrt:~# echo "/etc/board.d/03_usb_wan" >> /etc/sysupgrade.conf
```

## The USB adapter boots as a CD-ROM

Many Realtek USB network adapters contain a small flash chip with a Windows driver. When plugged in, they first
pretend to be a USB CD-ROM drive (USB ID `0bda:8151`) so that Windows can install the driver from it. Only after
receiving a switch command do they turn into a network adapter (`0bda:8156`).

Usually this happens automatically and I did not notice it. But after one reboot, `eth1` simply did not exist,
and the PI had no internet connection:

```shell
root@OpenWrt:~# dmesg | grep -iE "8151|cd-rom"
[    3.036876] usb 2-1: New USB device found, idVendor=0bda, idProduct=8151, bcdDevice=31.04
[    4.155722] scsi 1:0:0:0: CD-ROM            Realtek  USB CD-ROM       2.00 PQ: 0 ANSI: 0
root@OpenWrt:~# ip -br addr show eth1
Device "eth1" does not exist.
```

OpenWrt switches such devices with `usbmode` and the rules in `/etc/usb-mode.json`, but that file has no rule for
this adapter. A software re-plug of the USB device did not help, and neither did the generic "StandardEject" mode.
What worked was Realtek's own vendor switch message, which I put into a separate rule file:

```shell
root@OpenWrt:~# cat /etc/usb-mode-rtl8156.json
{
	"messages": [
		"555342430860d9a9c0000000800006e0000000000000000000000000000000"
	],
	"devices": {
		"0bda:8151": {
			"*": {
				"t_vendor": 3034,
				"t_product": [ 33110 ],
				"msg": [ 0 ]
			}
		}
	}
}
root@OpenWrt:~# usbmode -s -v -c /etc/usb-mode-rtl8156.json
root@OpenWrt:~# dmesg | tail -3
[  310.865800] r8152-cfgselector 2-1: reset SuperSpeed USB device number 4 using xhci_hcd
[  310.987873] r8152 2-1:1.0 eth1: v1.12.13
[  314.221036] r8152 2-1:1.0 eth1: carrier on
```

(Note: `t_vendor` and `t_product` are the target USB IDs in decimal: 3034 is `0x0bda` and 33110 is `0x8156`)

To send this message automatically whenever the adapter shows up as a CD-ROM, I added a hotplug script:

```shell
root@OpenWrt:~# cat /etc/hotplug.d/usb/21-rtl8156-modeswitch
# The Realtek 2.5G WAN adapter sometimes enumerates in its driver-CD mode
# (0bda:8151) instead of as a NIC (0bda:8156), leaving eth1 missing.
# Send Realtek's vendor switch message whenever it shows up that way.

[ "$ACTION" = add ] && [ "$DEVTYPE" = usb_device ] || exit 0

case "$PRODUCT" in
bda/8151/*)
	logger -t rtl8156-modeswitch "switching $DEVPATH from CD-ROM to NIC mode"
	usbmode -s -c /etc/usb-mode-rtl8156.json
	;;
esac
```

Both files are listed in `/etc/sysupgrade.conf`. Since then, the adapter has come up as a network adapter by itself
on every boot, which means the script has not been needed yet and its automatic run at boot is still unproven. If
`eth1` ever goes missing again, `logread | grep rtl8156` shows whether it ran.

## From SD Card to SSD

### Why the default layout is too small

The OpenWrt image creates two small partitions on the SD Card and leaves the rest of it empty. On my 64GB card,
OpenWrt used about 170MB:

| Partition | Size | Purpose |
|---|---|---|
| `/boot` | 64MB | Firmware, kernel and boot configuration |
| `/` | 104MB (72MB free) | Root filesystem with all packages and configuration |
| Unpartitioned | ~59GB | Nothing |

For a router this is fine, since logs and temporary files live in RAM. For Docker it is not: the binaries alone
(`dockerd`, `containerd`, `runc` and the CLI) need more than the 72MB that were left, and the images and container
data should not live on an SD Card anyway. Growing the root partition by hand does not help either, because the next
firmware upgrade writes the image back with its original partition sizes.

### Upgrading the firmware with a bigger root partition

The supported way is to build the upgrade with a larger root partition. OpenWrt's upgrade tool `owut` requests a
custom image from the official build server, and `-S` sets the root partition size in MB:

```shell
root@OpenWrt:~# owut upgrade -a "dockerd docker docker-compose luci-app-dockerman" -S 1024
...
Build succeeded in 192s total =   0s in queue + 192s to build:
Image saved : /tmp/firmware.bin
Installing /tmp/firmware.bin and rebooting...
```

The help text marks this option with "DANGER: See wiki before using!", and the reason is in the upgrade script of
the Raspberry PI target (`/lib/upgrade/platform.sh`). It compares the partition table of the new image with the one
on the disk. If the layout is unchanged, it writes the partitions one at a time. If it has changed, it writes the
full image over the whole disk, including the partition table:

```shell
	if [ -n "$diff" ]; then
		get_image "$@" | dd of="/dev/$diskdev" bs=2M conv=fsync
```

Changing the root size from 104MB to 1GB is such a change. Before running it, I saved a backup of the settings
(System → Backup / Flash Firmware → Generate archive, or `sysupgrade -b`) and copied it to my PC. I was glad I did.

The image was written, and the PI booted it, but during startup the kernel found a damaged block group on the root
partition and switched it to read-only:

```text
EXT4-fs error (device mmcblk0p2): ext4_validate_block_bitmap:431: comm mkdir: bg 7 ...
Aborting journal on device mmcblk0p2-8.
EXT4-fs (mmcblk0p2): Remounting filesystem read-only
```

With a read-only `/etc`, the startup could not complete, the PI handed out no DHCP addresses, and shortly after I
could not get a working console anymore either. I do not know yet whether the write went wrong or whether the SD Card
itself is failing. Damage right after a large write is a classic sign of a failing or counterfeit card, so I will test
it with H2testw before I use it again.

Instead of reflashing the SD Card, I decided to run the whole system from the SSD, which is far more reliable than an
SD Card and was going to hold the Docker data anyway.

### Checking the SSD

Before trusting the SSD with the system, I checked its health with `smartmontools`:

```shell
root@OpenWrt:~# smartctl -H -A -d sat /dev/sda
...
SMART overall-health self-assessment test result: PASSED
...
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  5 Reallocated_Sector_Ct   0x0033   100   100   010    Pre-fail  Always       -       0
  9 Power_On_Hours          0x0032   096   096   000    Old_age   Always       -       15639
177 Wear_Leveling_Count     0x0013   097   097   000    Pre-fail  Always       -       30
187 Reported_Uncorrect      0x0032   100   100   000    Old_age   Always       -       0
199 UDMA_CRC_Error_Count    0x003e   100   100   000    Old_age   Always       -       0
```

More than 15,000 hours of power-on time, but no reallocated sectors and almost no wear. A sequential read of 2GiB took
8 seconds, about 268MB/s, which is normal for a SATA SSD behind a USB 3.0 bridge. The ASM1051 uses the faster UAS
driver. It is worth mentioning that this bridge chip does not pass TRIM commands through
(`/sys/block/sda/queue/discard_max_bytes` is 0) and reports the SSD as a spinning disk. With this much free space,
I can live with that. The ASM1051 also has a history of UAS problems on the PI 4. So far I have not seen any
`uas_eh_abort_handler` errors, but if the disk ever drops off under load, switching it to the older usb-storage
driver is the known fix.

### Building a factory image for the SSD

A fresh installation needs a "factory" image instead of an upgrade image. I requested one from the same build server
(the Firmware Selector works as well) with a 1GB root partition and everything I had installed before, plus:

```text
dockerd docker docker-compose luci-app-dockerman
block-mount e2fsprogs parted resize2fs smartmontools owut
kmod-usb-storage-uas luci-proto-wireguard wireguard-tools
```

Before writing it to the SSD, I read the partition table straight out of the image to make sure the root partition
really is 1GB:

```text
disk id e875e867
p1 type=0xc start=8192s size=131072s (64 MiB) end=68 MiB
p2 type=0x83 start=147456s size=2097152s (1024 MiB) end=1096 MiB
```

Take note of the disk ID `e875e867`. It becomes important in a minute.

I wrote the image to the SSD from my Windows PC with Raspberry PI Imager ("Use custom", and "No" to the OS
customisation, which is meant for Raspberry PI OS). Then I removed the SD Card from the PI and plugged in the SSD.
Without an SD Card, the bootloader of the PI 4 tries USB next, and my Rev 1.4 board booted from the SSD without a
bootloader update. (Note: older PI 4 boards might need a bootloader update first. Raspberry PI Imager can write a
"Bootloader → USB Boot" SD Card for that)

The fresh image starts at `192.168.1.1` again. Restoring the backup from before the failed upgrade brought back the
LAN address, the WAN on `eth1`, the `board.d` script, `sysupgrade.conf` and even the SSH host keys:

```shell
root@OpenWrt:~# sysupgrade -r /tmp/backup-pre-docker.tar.gz
```

The backup also contains `/boot/cmdline.txt` from the old SD Card. If it still pointed to the root partition of the
SD Card, the PI would not boot anymore, so I checked it before rebooting. OpenWrt finds its root partition by the
disk ID instead of the device name, so the same line works for the SD Card and the SSD:

```shell
root@OpenWrt:~# grep -o "root=[^ ]*" /boot/cmdline.txt
root=PARTUUID=e875e867-02
```

### Adding the Docker partition

The SSD has 250GB, and the image uses about 1.1GB of it. I left a gap of about 3GB after the root partition in case
I need to grow it later, and gave the rest to Docker:

{{< mermaid >}}
flowchart LR
    subgraph SSD 250GB
        id1(Boot Partition - FAT - 64MB)
        id2(Root Partition - EXT4 - 1GB)
        id3(Free - ~3GB)
        id4(Docker Partition - EXT4 - ~229GB - /opt)
    end
{{< /mermaid >}}

```shell
root@OpenWrt:~# parted -s /dev/sda mkpart primary ext4 4GiB 100%
root@OpenWrt:~# mkfs.ext4 -F -L docker /dev/sda3
root@OpenWrt:~# block info /dev/sda3    # shows the UUID of the new partition
root@OpenWrt:~# S=$(uci add fstab mount)
root@OpenWrt:~# uci set fstab.$S.uuid='ea17150f-7547-4469-9d9a-f509c771237b'
root@OpenWrt:~# uci set fstab.$S.target='/opt'
root@OpenWrt:~# uci set fstab.$S.options='noatime'
root@OpenWrt:~# uci set fstab.$S.enabled='1'
root@OpenWrt:~# uci commit fstab
root@OpenWrt:~# /etc/init.d/fstab enable
```

`/opt` is mounted by `fstab` (S11) long before `dockerd` starts (S99), and OpenWrt's Docker package already stores
its data in `/opt/docker/` (`data_root` in `/etc/config/dockerd`).

Then I rebooted, and the PI did not come back. The screen showed:

```text
[    2.186269] Waiting for root device PARTUUID=e875e867-02...
```

followed by the SSD and its three partitions, and then nothing. When `parted` rewrote the partition table to add the
third partition, it also gave the disk a new ID. Windows showed `7504CB19` instead of `E875E867`, so the kernel was
waiting for a disk that no longer existed. The fix was to plug the SSD into my PC and set the old ID with diskpart.

**Warning!**

**Diskpart is a powerful tool which can permanently destroy all data on the selected drive. Please make sure that you
are working with the correct disk number (`list disk`, and check the size). Neither tomcore.io nor the author of this
article is responsible for any data loss.**

```text
DISKPART> select disk 2

Disk 2 is now the selected disk.

DISKPART> uniqueid disk id=E875E867
```

`uniqueid` only changes the 4-byte disk ID in the master boot record. Partitions and data stay untouched. After that,
the PI booted from the SSD with `/opt` mounted. My rule from now on: after any change to the partition table, check
the disk ID before rebooting:

```shell
root@OpenWrt:~# dd if=/dev/sda bs=1 skip=440 count=4 2>/dev/null | hexdump -e '1/4 "%08x\n"'
e875e867
```

### Future upgrades

Because of the upgrade script described above, future upgrades must use exactly the same root size:

```shell
root@OpenWrt:~# owut upgrade -S 1024
```

With an unchanged layout, the script writes the boot and root partitions one at a time and leaves the partition
table, and with it the Docker partition, alone. A different size would overwrite the whole disk. I have not run an
upgrade on the SSD yet, so this is what the script says rather than something I have seen myself. Before the first
one, I will take a fresh backup.

## Docker

With the packages in the image and the data on the SSD, Docker was running after the first boot:

```shell
root@OpenWrt:~# docker info | grep -E "Server Version|Storage Driver|Cgroup|Docker Root Dir|WARNING"
 Server Version: 29.6.1
 Storage Driver: overlayfs
 Cgroup Driver: cgroupfs
 Cgroup Version: 2
 Docker Root Dir: /opt/docker/
WARNING: No memory limit support
WARNING: No swap limit support
```

The two warnings at the end are the topic of the next section.

The first `docker run --rm hello-world` failed with
`adding interface veth28c0f5d to bridge docker0 failed: Device does not exist`. On its very first start, the
`dockerd` init script adds a `docker` interface and firewall zone to the OpenWrt configuration and reloads the
network, and that reload removed the `docker0` bridge Docker had just created. A restart of `dockerd` fixed it, and
it has not come back on any of the following boots.

### Docker and the OpenWrt firewall

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
root@OpenWrt:~# uci set dockerd.firewall.extra_iptables_args='--match conntrack ! --ctstate RELATED,ESTABLISHED'
root@OpenWrt:~# uci commit dockerd
```

New connections from the WAN to the containers are still rejected, and the containers cannot reach the LAN. Please
note, as the comment in the config says, the firewall changes are only additive: the old rule stays loaded until the
firewall and then Docker are restarted. A reboot is the simplest way.

### Keeping Docker from starving the router

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
partition means another change to the partition table, and we have seen above what that can do to the disk ID.
Setting `vm.swappiness` to 10 means the kernel only swaps when memory is actually short:

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

#### Test

To test the cap, I ran a container with `stress-ng` that tries to allocate 9GB, while my PC pinged the router and
I checked SSH and the internet connection from the router:

```shell
root@OpenWrt:~# docker run --rm --name memhog alpine sh -c "apk add -q stress-ng && stress-ng --vm 1 --vm-bytes 9G --vm-keep --timeout 90s"
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

All the files I added outside of the uci configuration are listed in `/etc/sysupgrade.conf`, so that an upgrade
keeps them:

```shell
root@OpenWrt:~# cat /etc/sysupgrade.conf
## This file contains files and directories that should
## be preserved during an upgrade.

# /etc/example.conf
# /etc/openvpn/
/etc/board.d/03_usb_wan
/etc/init.d/docker-memcap
/etc/rc.d/S98docker-memcap
/etc/hotplug.d/usb/21-rtl8156-modeswitch
/etc/usb-mode-rtl8156.json
```

`/boot/cmdline.txt`, `/etc/sysctl.conf` and the uci configuration (network, firewall, fstab and dockerd) are part
of the backup anyway.

## Summary and next steps

The PI now boots from the SSD and routes between the LAN (`10.0.0.1/24`) and the USB WAN port. Docker stores its
data on a 229GB partition, and a cap makes sure the containers cannot take away the memory the router needs.

Open points for the next parts of this series:

- A WireGuard server for remote access into the LAN. This requires a public IPv4 address from the provider and not
  one behind CGNAT.
- A Git server with a web interface (Forgejo) as the first real Docker container, with its data under `/opt` and
  its ports only bound to the LAN.
- The second Wi-Fi network on VLAN 2 whose traffic leaves through a WireGuard tunnel in another country, as
  described in [A Wi-Fi Network in Another Country](wifi-network-in-another-country).
