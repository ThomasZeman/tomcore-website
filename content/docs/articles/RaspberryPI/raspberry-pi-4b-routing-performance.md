---
weight: 12
title: Raspberry PI 4B Routing Performance
---
# Raspberry PI 4B Routing Network Performance

This article discusses the IPv4 routing performance the Raspberry PI 4B shows between two network interfaces. One interface is
the built-in Ethernet port, and the other is a USB3.0 Ethernet adapter based on the Realtek rtl8153a chip. The rtl8153a
chip has proven to be a high-performing choice for the Raspberry PI 4B in this [article](raspberry-pi-4b-usb-network-performance).

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

To make sure the PCs can deliver at full-duplex speed and are not a bottleneck themselves,
I ran a reference PC to PC measurement with iperf3 where each PC is sending with 10 concurrent TCP streams.
The following screenshot shows the measured throughput on one of the PCs.

[![pc-pc-fullduplex](/images/articles/pi4-routing-performance/pc-to-pc-reference.png)](/images/articles/pi4-routing-performance/pc-to-pc-reference.png)

These numbers give confidence that the PCs can provide an appropriate test harness for the Raspberry PI.

### Raspberry PI Setup

On the Raspberry PI, I used Alpine Linux 3.15 and a 5.15.4-0-rpi4 aarch64 kernel with the
CPU frequency governor set to `ondemand` (with an `up_threshold` of `60`) and (obviously) IPv4 forwarding enabled.

```shell
echo 66 >/sys/devices/system/cpu/cpufreq/ondemand/up_threshold
echo ondemand >/sys/devices/system/cpu/cpufreq/policy0/scaling_governor
echo 1 >/proc/sys/net/ipv4/ip_forward
```

Furthermore, I enabled all other performance optimizations described [here](raspberry-pi-4b-usb-network-performance).

## Half Duplex - Download only scenario

In the first test scenario, the "LAN" PC downloads data from the "Internet" PC but does not upload any data.
This is simulated by running the following command on the Internet PC, which will start sending with 10 concurrent TCP streams:

```shell
iperf3.exe -c 10.0.0.100 -P 10 -t 65 -O 5
```

Result:

[![pc-pc-halfduplex](/images/articles/pi4-routing-performance/pc-a-sendto-b-half-duplex.png)](/images/articles/pi4-routing-performance/pc-a-sendto-b-half-duplex.png  )

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

As you can see from the measurement results, the Raspberry PI can deliver an impressive routing throughput of 1Gbit/s.

For some reason, however, the throughput is very unevenly distributed among the 10 concurrent TCP streams.
After applying simple Stochastic Fairness Queueing (SFQ) to both interfaces:

```shell
tc qdisc add dev eth0 root handle 1: sfq quantum 1500
tc qdisc add dev eth1 root handle 1: sfq quantum 1500
```

the distribution became much more balanced out:

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

## Full-Duplex - Download and upload scenario

The second test scenario considers that devices on the LAN will usually also upload data to the Internet.
To simulate that, I let the "LAN" PC upload data to the "Internet" PC with four different target bandwidths: 100, 250, 500 and 1000 Mbit/s.

Results:

### With standard pfifo_fast traffic control

| Up (target) | Down | Up (actual) |
| --- | --- | --- |
| 100 | 921 | 116 |
| 250 | 836 | 250 |
| 500 | 760 | 506 |
| none | 825 | 747 |

### With SFQ traffic control

| Up (target) | Down | Up (actual) |
| --- | --- | --- |
| 100 | 932 | 109 |
| 250 | 934 | 322 |
| 500 | 934 | 565 |
| none | 914 | 526 |

Throughput with SFQ and 100Mbit/s target upload bandwidth:

[![pc-pc-fullduplex](/images/articles/pi4-routing-performance/pc-b-100mbit-full-duplex.png)](/images/articles/pi4-routing-performance/pc-b-100mbit-full-duplex.png  )

## Summary

With SFQ enabled the
Raspberry PI4B and the Realtek adapter can sustain a download speed of 1Gbit/s while at the same time handling upload speeds of up to 500Mbit/s.
This certainly qualifies the PI for most home and small office routing requirements.

## Remarks

### Temperature

I used a passively cooled Raspberry PI with aluminium heat sinks for this test. During extended test runs (5 minutes and more), the CPU
developed significant heat and reached around 85°C, where it started to throttle down its frequency. If you want
the PI to sustain a high routing throughput, it will require active cooling.

### What to connect where

I had "the Internet PC" connected to the USB Ethernet adapter for these tests instead of the built-in Ethernet port. The reason for this is that
when you have other USB devices connected to the PI, such as storage devices (think NAS), the LAN port and storage devices should use different IRQs and hence distribute the load over several cores. If the LAN connection and other USB devices are all using the same interrupt, it
will impact the achievable transfer speeds.
