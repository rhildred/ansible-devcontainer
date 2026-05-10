```bash
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose up -d
```

```bash
export HOST_UID=$(id -u)
export HOST_GID=$(id -g)
docker compose up
```