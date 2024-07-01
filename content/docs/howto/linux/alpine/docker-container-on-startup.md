`/usr/local/bin/check_and_run_containers.sh`

```sh
#!/bin/sh

# Function to wait for the Docker daemon to be ready
wait_for_docker() {
    echo "Waiting for Docker daemon to be ready..."
    while ! docker info >/dev/null 2>&1; do
        echo -n "."
        sleep 1
    done
    echo "Docker daemon is ready."
}

# Check if a container is running
is_container_running() {
    container_name=$1
    docker ps --format '{{.Names}}' | grep -q "^${container_name}$"
}

is_network_existing() {
    network_name=$1
    docker network ls --format '{{.Name}}' | grep -q "^${network_name}$"
}

# Remove old stopped container if it exists
remove_old_container() {
    container_name=$1
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        echo "Removing old container ${container_name}..."
        docker rm ${container_name}
    fi
}

# Create the pihole_lan network if it doesn't exist
create_pihole_lan_network() {
    echo "Creating pihole_lan network..."
    docker network create \
        --driver bridge \
        --subnet 10.1.0.0/24 \
        --gateway 10.1.0.1 \
        pihole_lan
}

# Run the dnsmasq container if it's not running
start_dnsmasq() {
    echo "Starting dnsmasq (lan) container..."
    remove_old_container "dnsmasq_lan"
    docker run -d --name dnsmasq_lan --network host -v "/home/tom/docker/dnsmasq.lan/dnsmasq.conf:/etc/dnsmasq.conf" --cap-add=NET_ADMIN --restart unless-stopped dnsmasq_lan
}

# Run the pihole container if it's not running
start_pihole() {
    echo "Starting pihole (lan) container..."
    remove_old_container "pihole_lan"
    docker run -d --name pihole_lan --network pihole_lan --ip 10.1.0.2 -e TZ='Australia/Sydney' -e WEBPASSWORD='secret' -v "/home/tom/docker/pihole.lan/etc-pihole:/etc/pihole" -v "/home/tom/docker/pihole.lan/etc-dnsmasq.d:/etc/dnsmasq.d" --restart unless-stopped pihole/pihole:latest
}

# Wait for the Docker daemon to be ready
wait_for_docker

# Check if the pihole_lan network exists
if is_network_existing "pihole_lan"; then
    echo "pihole_lan network already exists."
else
    create_pihole_lan_network
fi

# Check if dnsmasq container is running
if is_container_running "dnsmasq_lan"; then
    echo "dnsmasq container is already running."
else
    start_dnsmasq
fi

# Check if pihole container is running
if is_container_running "pihole_lan"; then
    echo "pihole container is already running."
else
    start_pihole
fi
```

```shell
sudo chmod +x /usr/local/bin/check_and_run_containers.sh
sudo vi /etc/init.d/docker_containers
```

```sh
#!/sbin/openrc-run

name="Docker Containers"
description="Ensure dnsmasq and pihole containers are running"

depend() {
    need docker
}

start() {
    ebegin "Checking and starting required Docker containers"
    /usr/local/bin/check_and_run_containers.sh
    eend $?
}
```

```sh
sudo chmod +x /etc/init.d/docker_containers
sudo rc-update add docker_containers default
sudo rc-service docker_containers start
```
