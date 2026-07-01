# SSH 與 tmux 維運指南

這份文件說明連到 production Droplet 時，SSH keepalive、tmux、Docker Compose
各自負責什麼，以及斷線後如何恢復工作。

## 核心觀念

SSH、tmux、Docker container 是三個不同層級：

```text
SSH keepalive: 盡量維持本機到 Droplet 的 SSH TCP 連線
tmux: 保留 Droplet 上的 shell session 與長時間命令
Docker Compose: 管理 LibreChat/Caddy containers，服務不依賴 SSH session
```

結果是：

```text
SSH 斷線
  普通前景命令：可能中斷
  tmux 裡的命令：繼續在 Droplet 上跑
  docker compose up -d 後的服務：繼續跑
```

不要讓 LibreChat 服務依賴 SSH 或 tmux。服務應該透過 Docker Compose 以
detached mode 啟動：

```bash
ssh deploy@139.59.110.150 'cd /srv/librechat/app && docker compose -f deploy-compose.prod.yml up -d'
```

## 本機 SSH keepalive

SSH keepalive 的目標是減少 idle connection 被網路設備切斷。它不保證永遠不斷線，
但可以降低斷線機率。

在你的 Mac 編輯或建立 `~/.ssh/config`：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/config
```

加入：

```sshconfig
Host librechat-prod
  HostName 139.59.110.150
  User deploy
  ServerAliveInterval 60
  ServerAliveCountMax 5
```

保護 config 權限：

```bash
chmod 600 ~/.ssh/config
```

之後用 alias 連線：

```bash
ssh librechat-prod
```

測試 Docker 權限：

```bash
ssh librechat-prod 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

## tmux 用途

tmux 的用途不是防止 SSH 斷線，而是讓 SSH 斷線後工作不丟。

適合放進 tmux 的工作：

- 長時間看 logs。
- 手動跑 PaddleOCR live smoke。
- 編輯 `/etc/librechat/.env.prod` 後重啟 API。
- 觀察 deploy 後的 health/restart 狀態。

不一定要放進 tmux 的工作：

- 已經用 `docker compose up -d` 啟動的服務。
- 很短的 `curl /health`。
- 很短的 `grep` / `docker ps`。

## 檢查 Droplet 是否有 tmux

在本機執行：

```bash
ssh librechat-prod 'command -v tmux && tmux -V'
```

如果沒有 tmux，在 Droplet 安裝：

```bash
ssh librechat-prod 'sudo apt-get update && sudo apt-get install -y tmux'
```

再次確認：

```bash
ssh librechat-prod 'tmux -V'
```

## 建立與接回 tmux session

建立維運 session：

```bash
ssh librechat-prod
tmux new -s librechat
```

離開但保留 session：

```text
Ctrl-b 然後按 d
```

列出現有 session：

```bash
ssh librechat-prod 'tmux ls'
```

接回 session：

```bash
ssh librechat-prod
tmux attach -t librechat
```

如果 session 已存在，也可以直接 attach；不存在才建立：

```bash
ssh librechat-prod 'tmux new -A -s librechat'
```

## 建議維運工作流

進入 tmux：

```bash
ssh librechat-prod 'tmux new -A -s librechat'
```

進入 app 目錄：

```bash
cd /srv/librechat/app
```

看目前 containers：

```bash
docker compose -f deploy-compose.prod.yml ps
```

看 API logs：

```bash
docker compose -f deploy-compose.prod.yml logs -f --tail=200 api
```

重啟 API：

```bash
docker compose -f deploy-compose.prod.yml up -d api
```

檢查 container-local health：

```bash
docker compose -f deploy-compose.prod.yml exec -T api curl -fsS http://127.0.0.1:3080/health && printf "\n"
```

在本機檢查 public health：

```bash
curl -fsS https://chat.longdin.org/health && printf "\n"
```

## SSH 斷線後如何恢復

重新連線：

```bash
ssh librechat-prod
```

查看 tmux sessions：

```bash
tmux ls
```

接回：

```bash
tmux attach -t librechat
```

如果沒有 tmux session，但服務是用 detached mode 啟動的，直接檢查 containers：

```bash
cd /srv/librechat/app
docker compose -f deploy-compose.prod.yml ps
docker compose -f deploy-compose.prod.yml logs --tail=120 api
```

## 不要這樣做

不要用前景方式讓服務綁在 SSH session 上：

```bash
docker compose -f deploy-compose.prod.yml up
```

如果 SSH 斷線，前景命令容易中斷，也不適合 production 維運。

請使用：

```bash
docker compose -f deploy-compose.prod.yml up -d
```

不要把 secrets 貼進 chat 或 commit 到 git：

```text
/etc/librechat/.env.prod
/data/openai-oauth/auth.json
SSH private keys
AWS secret keys
MongoDB/Supabase passwords
```

## 與 PaddleOCR smoke 的關係

PaddleOCR live smoke 可能跑比較久，建議在 tmux 裡執行。

部署後仍然先確認網站啟動：

```bash
curl -fsS https://chat.longdin.org/health && printf "\n"
```

再依照 DigitalOcean production runbook 產生 fresh S3 smoke PDF URL，並把 URL
傳給：

```bash
docker compose -f deploy-compose.prod.yml exec -T api sh /app/deploy/host/paddleocr-smoke.sh "<s3-smoke-pdf-url>"
```

這個 smoke 同時檢查 S3 URL 可讀性與 PaddleOCR `fileUrl` OCR path。

## 快速指令摘要

```bash
# 連線並進入/建立 tmux
ssh librechat-prod 'tmux new -A -s librechat'

# 在 tmux 裡看服務
cd /srv/librechat/app
docker compose -f deploy-compose.prod.yml ps

# 看 API logs
docker compose -f deploy-compose.prod.yml logs -f --tail=200 api

# 重啟 API
docker compose -f deploy-compose.prod.yml up -d api

# container-local health
docker compose -f deploy-compose.prod.yml exec -T api curl -fsS http://127.0.0.1:3080/health && printf "\n"

# 本機 public health
curl -fsS https://chat.longdin.org/health && printf "\n"
```
