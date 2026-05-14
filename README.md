# forgejo GPU appliance
## absolute control over your data

This is a playbook to run foregjo as a DIN rail appliance with CUDA drivers and web-devcontainers. The idea is to use it to prototype, build, and continuously deploy models that run on the edge, in react-native, a pwa or an ipc.

```bash
ansible-playbook local.yml
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose up -d
```

* Note: I will add the docker compose up -d to the playbook

When you first bring up a dev container, run the following tasks.

```bash
git config user.name "Your_name_here"
git config user.email "Your_email_here"
git config local http.extraHeader "Authorization: token your_forgejo_token_here"
```

## TODO

1. develop custom element for launching, updating, deleting and listing dev containers for a user, repo and branch. Integrate in forgejo
1. add CUDA drivers
8. install on gpu server
1. make hyperdx and borgbackup appliance
9. meet with Steve and Ernie for a demo

