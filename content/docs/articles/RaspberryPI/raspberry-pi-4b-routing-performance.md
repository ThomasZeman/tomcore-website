---
weight: 12
title: Raspberry PI 4B Routing Performance (draft)
---
# Raspberry PI 4B Routing Network Performance

This article discusses the IPv4 routing performance the Raspberry PI 4B shows between two network interfaces. One interface is 
the built-in Ethernet port and the other one a USB3.0 Ethernet adapter based on the Realtek rtl8153a chip. The rtl8153a
chip has proven itself to be a high-performing choice for the Raspberry PI 4B in this [article](raspberry-pi4b-usb-bnetwork-performance).

## Setup

The idea of the setup is to simulate a typical home or small office router setup where one network interface is connected to the 
Internet and the other one to the local network (LAN). Both ends, "The Internet" and "The LAN", are simulated by two Windows 10 PCs:

{{< mermaid >}}
flowchart LR
A["PC - 'The Internet' (10.0.1.100)"] --> B["RTL8153 (10.0.1.1)"]
subgraph Raspberry PI
B["RTL8153 (10.0.1.1)"] --> C["RPI4B ETH (10.0.0.1)"]
end
C["RPI4B ETH (10.0.0.1)"] --> D["PC - Home (10.0.0.100)"]
{{< /mermaid >}}

In order to make sure the PCs can deliver at full-duplex speed and are not a bottleneck themselves,
I ran a reference PC to PC measurement with iperf3 where each PC is sending with 10 concurrent TCP streams.
The following screenshot shows the measured throughput on one of the PCs. 

[![pc-pc-fullduplex](/assets/images/articles/pi4-routing-performance/pc-to-pc-reference.png)](/assets/images/articles/pi4-routing-performance/pc-to-pc-reference.png)

These numbers give confidence that the PCs are able to provide an appropriate test harness for the Raspberry PI.

### Raspberry PI Setup

On the Raspberry PI, I used Alpine Linux 3.15 and a 5.15.4-0-rpi4 aarch64 kernel with the
CPU frequency governor set to `ondemand` (with an `up_threshold` of `60`) and (obviously) IPv4 forwarding enabled.

```shell
echo 66 >/sys/devices/system/cpu/cpufreq/ondemand/up_threshold
echo ondemand >/sys/devices/system/cpu/cpufreq/policy0/scaling_governor
echo 1 >/proc/sys/net/ipv4/ip_forward
```

Furthermore, I enabled all other performance optimizations as described [here](raspberry-pi4b-usb-bnetwork-performance).

## Half Duplex

"The Internet" PC sending; "The LAN" PC downloading.

```shell
iperf3.exe -c 10.0.0.100 -P 10 -t 65 -O 5
```

[![pc-pc-fullduplex](/assets/images/articles/pi4-routing-performance/pc-a-sendto-b-half-duplex.png)](/assets/images/articles/pi4-routing-performance/pc-a-sendto-b-half-duplex.png  )

```text
[ ID] Interval           Transfer     Bandwidth
[  4]   0.00-65.00  sec  2.74 GBytes   362 Mbits/sec                  sender
[  6]   0.00-65.00  sec   128 KBytes  16.1 Kbits/sec                  sender
[  8]   0.00-65.00  sec   128 KBytes  16.1 Kbits/sec                  sender
[ 10]   0.00-65.00  sec  30.8 MBytes  3.97 Mbits/sec                  sender
[ 12]   0.00-65.00  sec  26.5 MBytes  3.42 Mbits/sec                  sender
[ 14]   0.00-65.00  sec   562 MBytes  72.5 Mbits/sec                  sender
[ 16]   0.00-65.00  sec   256 KBytes  32.3 Kbits/sec                  sender
[ 18]   0.00-65.00  sec   562 MBytes  72.5 Mbits/sec                  sender
[ 20]   0.00-65.00  sec   562 MBytes  72.6 Mbits/sec                  sender
[ 22]   0.00-65.00  sec  2.74 GBytes   362 Mbits/sec                  sender
[SUM]   0.00-65.00  sec  7.18 GBytes   949 Mbits/sec                  sender
```

Extreme unevenly distributed. Applying traffic control sfq:

```shell
tc qdisc add dev eth0 root handle 1: sfq quantum 1500
tc qdisc add dev eth1 root handle 1: sfq quantum 1500
```

fixes this problem:

```text
[ ID] Interval           Transfer     Bandwidth
[  4]   0.00-65.00  sec   690 MBytes  89.0 Mbits/sec                  sender
[  6]   0.00-65.00  sec   725 MBytes  93.6 Mbits/sec                  sender
[  8]   0.00-65.00  sec   726 MBytes  93.7 Mbits/sec                  sender
[ 10]   0.00-65.00  sec   747 MBytes  96.4 Mbits/sec                  sender
[ 12]   0.00-65.00  sec   715 MBytes  92.3 Mbits/sec                  sender
[ 14]   0.00-65.00  sec   772 MBytes  99.6 Mbits/sec                  sender
[ 16]   0.00-65.00  sec   724 MBytes  93.4 Mbits/sec                  sender
[ 18]   0.00-65.00  sec   712 MBytes  92.0 Mbits/sec                  sender
[ 20]   0.00-65.00  sec   728 MBytes  93.9 Mbits/sec                  sender
[ 22]   0.00-65.00  sec   772 MBytes  99.7 Mbits/sec                  sender
[SUM]   0.00-65.00  sec  7.14 GBytes   943 Mbits/sec                  sender
```

## PC B ("The Office PC") sending as well; uploading

with traffic control

| Up (target) | Down | Up (actual) |
| --- | --- | --- |
| 100 | 932 | 109 |
| 250 | 934 | 322 |
| 500 | 934 | 565 |
| none | 914 | 526 |

without traffic control (standard pfifo_fast)

| Up (target) | Down | Up (actual) |
| --- | --- | --- |
| 100 | 921 | 116 |
| 250 | 836 | 250 |
| 500 | 760 | 506 |
| none | 825 | 747 |

## Summary

- ...

Remarks:
- temperature
- which port for what