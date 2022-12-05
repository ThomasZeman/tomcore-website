# Alpine Linux Network Tools

### Busybox Network Tools

Alpine Linux employs [BusyBox](https://en.wikipedia.org/wiki/BusyBox) to provide essential network tools such as `ping` or `wget`.
Most of the commands supplied by BusyBox are stripped-down versions of their original (GNU)
implementation and do not support all parameters and use cases.

When building BusyBox, you can configure which commands you want your version to support,
and Alpine chooses to support [only a subset](https://git.alpinelinux.org/aports/tree/main/busybox/busyboxconfig) of all available commands.

The following table lists the network commands supported by the generic version of
BusyBox, whether included in the bespoke Alpine version, and which package contains the “original” version of the tool.

| Command | Path | Description | Alpine BusyBox | Package with original |
| --- | --- | --- | --- | --- |
| arp | /sbin | Manipulate ARP cache | ✔️| net-tools |
| arping | /usr/sbin | Send ARP requests/replies | ✔️| iputils |
| brctl | /usr/sbin | Manage ethernet bridges | ✔️| bridge-utils |
| dhcprelay | | Relay DHCP requests between clients and server | ❌ | dhcrelay |
| dnsd | | Small static DNS server daemon | ❌ | |
| dnsdomainname | /bin | | ✔️| net-tools |
| dumpleases | | Display DHCP leases granted by udhcpd | ❌ | |
| ftpd | | ftpd should be used as an inetd service. | ❌ | |
| ftpget | | Retrieve a remote file via FTP | ❌ | |
| ftpput | | Store a local file on a remote machine via FTP | ❌ | |
| hostname | /bin | Get or set hostname or DNS domain name | ✔️| net-tools |
| httpd | | Listen for incoming HTTP requests | ❌ | |
| ifconfig | /sbin | Configure a network interface | ✔️| net-tools |
| ifdown | /sbin | ifdown [-ainmvf] ifaces... | ✔️| ifupdown-ng ifupdown |
| ifenslave | /sbin | Configure network interfaces for parallel routing | ✔️| ? |
| ifplugd | | Network interface plug detection daemon | ❌ | |
| ifup | /sbin | ifup [-ainmvf] ifaces... | ✔️| ifupdown-ng ifupdown |
| inetd | | Listen for network connections and launch programs | ❌ | |
| ip | /sbin | | ✔️| iproute2-minimal |
| ipaddr | /sbin | | ✔️| iproute2-minimal |
| ipcalc | /bin | Calculate IP network settings from a IP address | ✔️| ? |
| iplink | /sbin | | ✔️| iproute2-minimal |
| iproute | /sbin | | ✔️| iproute2-minimal |
| iprule | /sbin | | ✔️| iproute2-minimal |
| iptunnel | /sbin | | ✔️| net-tools |
| nameif | /sbin | Rename network interface while it in the down state | ✔️| net-tools |
| nc | /usr/bin | | ✔️| netcat-openbsd |
| netstat | /bin | Display networking information | ✔️| net-tools |
| nslookup | /usr/bin | | ✔️| bind-tools |
| ping | /bin | Send ICMP ECHO_REQUEST packets to network hosts | ✔️| iputils |
| ping6 | /bin | Send ICMP ECHO_REQUEST packets to network hosts | ✔️| iputils |
| popmaildir | | Fetch content of remote mailbox to local maildir | ❌  | |
| route | /sbin | Edit kernel routing tables | ✔️| net-tools |
| rx | | Receive a file using the xmodem protocol | ❌ | |
| sendmail | /usr/sbin | Read email from stdin and send it | ✔️| postfix ssmtp opensmtpd |
| slattach | /sbin | Attach network interface(s) to serial line(s) | ✔️| net-tools |
| tcpsvd | | Create TCP socket, bind to IP:PORT and listen for incoming connection. | ❌ | |
| telnet | | Connect to telnet server | ❌ | |
| telnetd | | Handle incoming telnet connections | ❌ | |
| tftp | | Transfer a file from/to tftp server | ❌ | |
| tftpd | | Transfer a file on tftp client's request | ❌ | |
| traceroute | /usr/bin | | ✔️| traceroute |  
| udhcpc | /sbin | | ✔️| dhclient dhcpcd |
| udhcpd | | DHCP server | ❌ | dhcp-server-vanilla |
| udpsvd | | Create UDP socket, bind to IP:PORT and wait for incoming packets. | ❌ | |
| wget | /usr/bin | Retrieve files via HTTP or FTP | ✔️| wget |

To replace the most commonly used BusyBox network commands with their originals, execute:

```shell
apk add bind-tools dhclient net-tools net-tools bridge-utils ifupdown-ng iputils iproute2-minimal netcat-openbsd traceroute wget 
```

Some of these packages do not just install the command listed above but also deploy other tools. 
For example, the entire content of the package `net-tools` is [here](https://pkgs.alpinelinux.org/contents?branch=edge&name=net-tools&arch=x86_64&repo=main) and
of `iproute2-minimal` [here](https://pkgs.alpinelinux.org/contents?branch=edge&name=iproute2-minimal&arch=x86_64&repo=main).

The package `iproute2` depends on and hence installs: `iproute2-minimal`, `iproute2-ss` and `iproute2-tc` (see below for details). Its own additional
tools are [here](https://pkgs.alpinelinux.org/contents?branch=edge&name=iproute2&arch=x86_64&repo=main).

### Other Network Tools

Other important network tools which are not part of BusyBox are:

| Command | Path | Description | Package with original |
| --- | --- | --- | --- | 
| dig | /usr/bin | Tool for interrogating DNS name servers | [bind-tools](https://pkgs.alpinelinux.org/package/edge/main/x86_64/bind-tools) |
| mdig | /usr/bin | Multiple/pipelined query version of dig | [bind-tools](https://pkgs.alpinelinux.org/package/edge/main/x86_64/bind-tools) |
| iptables | /sbin | Administration tool for IPv4 packet filtering and NAT  | [iptables](https://pkgs.alpinelinux.org/package/edge/main/x86_64/iptables) |
| ip6tables | /sbin | Administration tool for IPv6 packet filtering and NAT  | [ip6tables](https://pkgs.alpinelinux.org/package/edge/main/x86_64/ip6tables) |
| ss | /sbin | Another Utility to investigate sockets  | [iproute2-ss](https://pkgs.alpinelinux.org/package/edge/main/x86_64/iproute2-ss) |
| tcpdump | /usr/bin | Prints contents of packets on a network interface | [tcpdump](https://pkgs.alpinelinux.org/package/edge/main/x86_64/tcpdump) |
| tc | /sbin | Traffic control | [iproute2-tc](https://pkgs.alpinelinux.org/package/edge/main/x86_64/iproute2-tc) |
| dhcping | /usr/bin | Dhcp daemon ping program | [dhcping](https://pkgs.alpinelinux.org/package/edge/community/x86_64/dhcping) |

Install them all by running:

```shell
apk add bind-tools iptables ip6tables iproute2 tcpdump dhcping
```








