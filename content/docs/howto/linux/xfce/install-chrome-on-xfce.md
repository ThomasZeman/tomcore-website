# Install Chrome on Xfce

This assumes you are running Ubuntu, have already installed Xfce and have a working Xfce session.

1. Install prerequisites

```shell
sudo apt-get install fonts-liberation
```

2. Download the latest version of the Chrome browser

```shell
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
```

3. Install Chrome

```shell
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

4. Delete package

```shell
rm google-chrome-stable_current_amd64.deb
```

5. Update Chrome (later)

Once installed, Chrome can be updated with the usual Ubuntu upgrade commands.

Update local package information

```shell
sudo apt update
```

If Chrome was installed correctly, you should notice a new source entry (`Hit:5` below) in the update output:

[![Remote Desktop](/images/howto/linux/xfce/install-chrome-update.png)](/images/howto/linux/xfce/install-chrome-update.png)

Upgrade packages

```shell
sudo apt upgrade
```