---
weight: 11
title: Raspberry PI 4B USB Network Performance
---
# Raspberry PI 4B USB Network Performance

This article discusses the performance of two USB 3.0 Gigabit network adapters connected to the Raspberry Pi 4B. I ran all measurements on Alpine Linux 3.15 and a 5.15.4-0-rpi4 aarch64 kernel. My measurement tool of choice was iperf3. As communication peer, I used a Windows 10 PC.


The first adapter was built by UGreen and is based on the [ASIX ax88179 Chip](https://www.asix.com.tw/en/product/USBEthernet/Super-Speed_USB_Ethernet/AX88179).
The second one is based on the [RTL8153 chip](https://www.realtek.com/en/products/communications-network-ics/item/rtl8153b-vb-cg) and was manufactured by CableCreations. (Note:
It seems that at the time of this writing, CableCreations stopped using the Realtek Chip for their adapter and resorted to the ax88179 as well)

## Performance Optimizations

For conducting the tests, I wanted to apply the same optimizations as I did when testing the [built-in Ethernet](raspberry-pi-4b-network-performance) port. If
you haven't read this article yet, I strongly suggest doing so now.

### 1. Changing affinity for the hardware receive and send interrupts

All interrupts for the USB Ethernet controllers, whether receive or send, are routed through the USB controller and hence the xhci_hcd USB driver which does not support changing the CPU affinity of the interrupt:

```text
lbox:~# cat /proc/interrupts
           CPU0       CPU1       CPU2       CPU3
  9:          0          0          0          0     GICv2  25 Level     vgic
 11:     522396     187835     254790     146022     GICv2  30 Level     arch_timer
 12:          0          0          0          0     GICv2  27 Level     kvm guest vtimer
 18:      44021          0          0          0     GICv2  65 Level     fe00b880.mailbox
 22:          0          0          0          0     GICv2 112 Level     bcm2708_fb DMA
 24:        347          0          0          0     GICv2 114 Level     DMA IRQ
 31:         55          0          0          0     GICv2  66 Level     VCHIQ doorbell
 32:      93810          0          0          0     GICv2 158 Level     mmc1, mmc0
 33:         16          0          0          0     GICv2  48 Level     arm-pmu
 34:          0          4          0          0     GICv2  49 Level     arm-pmu
 35:          0          0          4          0     GICv2  50 Level     arm-pmu
 36:          0          0          0          2     GICv2  51 Level     arm-pmu
 38:        780     313196          0          0     GICv2 189 Level     eth0
 39:         11          0       4358          0     GICv2 190 Level     eth0
 46:     668625          0          0          0  BRCM STB PCIe MSI 524288 Edge      xhci_hcd
IPI0:       620        789       1446        547       Rescheduling interrupts
IPI1:      5724      93336     238551      16606       Function call interrupts
IPI2:         0          0          0          0       CPU stop interrupts
IPI3:         0          0          0          0       CPU stop (for crash dump) interrupts
IPI4:         0          0          0          0       Timer broadcast interrupts
IPI5:    485339      84509     175734      43537       IRQ work interrupts
IPI6:         0          0          0          0       CPU wake-up interrupts
Err:          0
lbox:~# echo 4 >/proc/irq/46/smp_affinity
ash: write error: Invalid argument
```

This means that all USB devices you might attach to your PI, such as other Ethernet adapters, USB memory sticks, SSDs etc., will all share the same interrupt which is always handled by CPU0.

### 2. Enabling all CPUs for receive and send Packet Steering

Things look better for Packet Steering, where it is possible to set the CPU affinity for the receive queue to all cores. However, doing the same
for the send queue is not supported:

```text
lbox:~# echo f >/sys/class/net/eth1/queues/rx-0/rps_cpus
lbox:~# echo f >/sys/class/net/eth1/queues/tx-0/xps_cpus
ash: write error: No such file or directory
```

### 3. CPU Clock fixed at 1500 and 2000 MHz

I wanted to find out whether the CPU speed influences the network performance and ran the tests twice: First with a fixed CPU frequency of 1500 Mhz and then with 2000 Mhz.

### 4. Maximum PCIe payload size

As described in the Raspberry PI4 network performance article, I have set the PCIe payload size to the maximum supported for this test.

## Test Execution

The Windows 10 PC and the Raspberry PI are sending with ten concurrent TCP streams for 65 seconds, with the throughput of the
first 5 seconds not being considered for the overall test result. (For details on the iperf command line parameters used for these tests, please
check out this [article](raspberry-pi-4bnetwork-performance))

## ASIX ax88179 USB 3.0 Gigabit Network Adapter

This is a photo of the UGREEN adapter I used:

[![photo-ax88179-ugreen](/assets/images/articles/pi4-usb-network-performance/ax88179-ugreen.png)](/assets/images/articles/pi4-usb-network-performance/ax88179-ugreen.png)

The kernel recognizes the adapter with the following log message:

```text
  ax88179_178a 2-2:1.0 eth1: register 'ax88179_178a' at usb-0000:01:00.0-2, ASIX AX88179 USB 3.0 Gigabit Ethernet, 00:0e:c6:ca:39:ad
  usbcore: registered new interface driver ax88179_178a
```

Running `lsusb` shows that the device is connected via USB3.0:

```text
lbox:~# lsusb -t
/:  Bus 02.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/4p, 5000M
    |__ Port 2: Dev 2, If 0, Class=, Driver=ax88179_178a, 5000M
/:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/1p, 480M
...
```

### Test Results

The following table shows the results for half and full-duplex as well as for 1500 and 2000 CPU clock frequencies:

| CPU | Direction | Half-Duplex | Full-Duplex |
| --- |---| ---- | ---- |
| 1500 Mhz |
| | PI -> PC | 736 Mbit/s | 163 Mbit/s |
| | PC -> PI | 949 Mbit/s | 902 Mbit/s |
| 2000 Mhz |
| | PI -> PC | 834 Mbit/s | 269* Mbit/s |
| | PC -> PI | 949 Mbit/s | 880* Mbit/s |

Noticeably, in all scenarios, the throughput for the PC sending data to Raspberry PI is much higher than the other way round. It's also
worth mentioning that the IRQ load for CPU 0 is close to 100% during test execution. This screenshot of `atop` was taken while the PI was sending but
not receiving data streams (half-duplex): 

[![photo-halfduplex-ax88179-sending-irq.png](/assets/images/articles/pi4-usb-network-performance/halfduplex-ax88179-sending-irq.png)](/assets/images/articles/pi4-usb-network-performance/halfduplex-ax88179-sending-irq.png)

In order, to get a better understanding of the send-performance of the adapter, I also ran the test with the following parameters which
throttles the PC send-throughput to approximately 400 Mbit/s:   
`iperf3.exe -c 10.0.1.1 -P 10 -t 65 -O 5 -b 40mbit`

| CPU | Direction | Half | Full | Full (PC throttled) |
| --- |---| ---- | ---- | --- |
| 1500 Mhz |
| | PI -> PC | 736 Mbit/s | 163 Mbit/s | 412 Mbit/s |
| | PC -> PI | 949 Mbit/s | 902 Mbit/s | 496 Mbit/s |
| 2000 Mhz |
| | PI -> PC | 834 Mbit/s | 269* Mbit/s | 552* Mbit/s |
| | PC -> PI | 949 Mbit/s | 880* Mbit/s | 408* Mbit/s |

(Numbers marked with * had a fluctuation of ± 50 Mbit/s when running the test several times)

My interpretation of these results is that the ax88179 driver handles IRQs in a suboptimal way. This chip/driver cannot send out
packets at maximum line speed, not even in half-duplex. With an overclocked CPU, the send-throughput
does not surpass `834 Mbit/s`. The situation worsens in the full-duplex scenario when the Raspberry needs to send back acknowledge packets
and is likely to cause "chaos" in the entire TCP/IP stack, leading to fluctuations in the test measurements. It is worth mentioning
that the adapter is actually able to send out data at 1Gbit/s speed when connected to a Windows machine via USB. So this is probably a Linux specific driver
problem here.

## Realtek rtl8153a-4 USB 3.0 Gigabit Network Adapter

The CableCreation adapter based on the RTL8153 chip:

[![photo-rtl5183-cablecreation](/assets/images/articles/pi4-usb-network-performance/rtl8153-cablecreation.png)](/assets/images/articles/pi4-usb-network-performance/rtl8153-cablecreation.png)

(Note that CableCreation seems to no longer produce this Realtek based adapter)

The kernel recognizes the adapter with the following log message:

```text
  r8152 2-1:1.0: load rtl8153a-4 v2 02/07/20 successfully
  r8152 2-1:1.0 eth1: v1.12.11
```

Running `lsusb` shows that the device is connected via USB3.0:

```text
lbox:~# lsusb -t
/:  Bus 02.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/4p, 5000M
    |__ Port 1: Dev 3, If 0, Class=, Driver=r8152, 5000M
/:  Bus 01.Port 1: Dev 1, Class=root_hub, Driver=xhci_hcd/1p, 480M
...
```

Test results:

| CPU | Direction | Half | Full | Full (PC throttled) |
| --- |---| ---- | ---- | --- |
| 1500 |
| | PI -> PC | 949 Mbit/s | 538 Mbit/s | 774 Mbit/s |
| | PC -> PI | 933 Mbit/s | 847 Mbit/s | 403 Mbit/s |
| 2000 |
| | PI -> PC | 949 Mbit/s | 743 Mbit/s | 819 Mbit/s |
| | PC -> PI | 949 Mbit/s | 908 Mbit/s | 404 Mbit/s |

It is obvious that the rtl8153a based adapter performs much better than the ax88179 based adapter. When the CPU is overclocked, the
adapter is able to reach 1Gbit/s in half-duplex in both directions. Even in full-duplex the throughput is still much better than with the
ASIX adapter. It is also remarkable that the interrupt rate in the half-duplex PI send-scenario stays very low:

[![photo-halfduplex-rtl8153-sending-irq.png](/assets/images/articles/pi4-usb-network-performance/halfduplex-rtl8153-sending-irq.png)](/assets/images/articles/pi4-usb-network-performance/halfduplex-rtl8153-sending-irq.png)

## Summary

There is no doubt that with the current drivers,
the Realtek rtl8153a chip is much better suited to be used with the Raspberry PI4b than the ASIX ax88179 chip.
