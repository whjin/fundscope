---
name: "fund-scope-deploy"
description: "FundScope 基金持仓分析平台部署指南。适用于将 Node.js + Express 应用部署到阿里云（Alibaba Cloud Linux 3），通过子域名（fundscope.wuhuajin.com）独立访问，Nginx 反向代理 + HTTPS 自动续期。"
---

# FundScope 部署指南（阿里云 Alibaba Cloud Linux 3）

## 快速开始

### 方式一：一键部署（推荐）

```bash
# 上传并执行一键部署脚本
bash scripts/deploy.sh
```

一键脚本自动完成环境安装、代码部署、服务启动、Nginx 配置、防火墙设置。

### 方式二：快速诊断

```bash
# 一键检查服务健康状态
bash scripts/diagnose.sh
```

诊断内容：系统环境、PM2 状态、端口监听、服务可用性、Nginx 配置、资源使用、日志检查。

### 方式三：代码更新

```bash
# 拉取最新代码并重启服务
bash scripts/update.sh
```

自动检测依赖变更，智能判断是否需要重新安装依赖。

---

## 一、部署架构概览

```
浏览器访问 https://fundscope.wuhuajin.com/
    │
    ▼
DNS 解析：fundscope.wuhuajin.com → 47.107.183.204（阿里云 ECS）
    │
    ▼
Nginx (80/443) — 反向代理
    │  location /
    │  proxy_pass http://127.0.0.1:3000  ← 原样转发，无前缀剥离
    ▼
Node.js Express (3000) — PM2 管理
    │
    ├── /api/funds/config  →  基金配置
    ├── /api/fund/info     →  基金基本信息
    ├── /api/fund/holdings →  持仓明细
    ├── /api/stock/quote   →  股票行情
    ├── /js/*              →  静态文件
    ├── /css/*             →  静态文件
    └── /                  →  首页 index.html
```

### 核心设计

- **子域名独立访问**：`fundscope.wuhuajin.com` 专用于本项目，与主站 `wuhuajin.com`（GitHub Pages）互不干扰
- **根路径代理**：Nginx `location /` + `proxy_pass http://127.0.0.1:3000`（不带尾部斜杠），原样转发路径，无需前缀剥离
- **Node.js 服务保持 localhost:3000**：本地开发测试不受影响
- **PM2 进程管理**：自动重启、开机自启
- **HTTPS**：Let's Encrypt webroot 方式，支持自动续期

### 与旧方案（子路径）的差异

| 对比项 | 旧方案（子路径） | 新方案（子域名） |
|--------|----------------|----------------|
| 访问地址 | `wuhuajin.com/fundscope/` | `fundscope.wuhuajin.com/` |
| DNS 配置 | wuhuajin.com → 阿里云 | wuhuajin.com → GitHub Pages（保留），fundscope.wuhuajin.com → 阿里云 |
| Nginx location | `/fundscope/` + proxy_pass 末尾带 `/`（剥离前缀） | `/` + proxy_pass 不带 `/`（原样转发） |
| server.js | 需要 BASE_PATH 环境变量 | 无需 BASE_PATH |
| 前端 app.js | IS_STATIC 识别 wuhuajin.com | IS_STATIC 识别 `*.wuhuajin.com`（含子域名） |
| 主站影响 | 需迁移主站到阿里云 | 主站完全不受影响 |

---

## 二、环境信息

| 项目 | 说明 |
|---|---|
| 操作系统 | Alibaba Cloud Linux 3.2104 LTS 64位 |
| 主域名 | wuhuajin.com（指向 GitHub Pages，运行 whjin.github.io） |
| 子域名 | fundscope.wuhuajin.com（指向阿里云 ECS） |
| 阿里云公网 IP | 47.107.183.204 |
| GitHub 仓库 | fundscope |
| 项目访问地址 | https://fundscope.wuhuajin.com/ |
| Node.js 端口 | 3000 |
| 进程管理 | PM2 |
| 反向代理 | Nginx |
| SSL 证书 | Let's Encrypt（webroot 方式，自动续期） |

---

## 三、前置条件检查

### 3.1 确认服务器环境

```bash
# 操作系统版本
cat /etc/os-release

# Node.js 版本（需 >= 14）
node -v

# Nginx 状态
nginx -v
sudo systemctl status nginx

# PM2 状态
pm2 -v
pm2 list
```

### 3.2 确认服务器公网 IP

```bash
curl ifconfig.me
# 期望输出: 47.107.183.204
```

### 3.3 确认主域名 DNS 现状（不要改动）

```bash
dig wuhuajin.com A +short
# 期望输出: 185.199.109.153 等 GitHub Pages IP（保持不变）
```

---

## 四、代码准备

### 4.1 拉取最新代码

```bash
cd /root/fundscope   # 你的项目目录
git pull origin main
```

### 4.2 代码变更说明（已完成）

以下文件已修改以支持子域名部署：

**`js/app.js`** — IS_STATIC 检测逻辑：
```javascript
const IS_STATIC = (() => {
    const host = window.location.hostname;
    if (host.endsWith('.github.io')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    // wuhuajin.com 主域及所有子域（如 fundscope.wuhuajin.com）均走后端模式
    if (host === 'wuhuajin.com' || host.endsWith('.wuhuajin.com')) return false;
    return window.location.protocol === 'https:' && !window.location.port;
})();
```

**`index.html`** — 缓存版本号 bump：
```html
<script src="js/app.js?v=30"></script>
```

**`server.js`** — 无需修改代码：
- `BASE_PATH` 仅用于日志，所有路由本就挂在根路径 `/`
- 迁移后只需在 PM2 启动时不传 `BASE_PATH` 环境变量

---

## 五、DNS 配置（步骤 1）

### 5.1 添加子域名 A 记录

登录阿里云域名控制台（https://dc.console.aliyun.com/）：

1. 找到域名 `wuhuajin.com` → **解析**
2. **添加记录**：

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | `fundscope` | `47.107.183.204` | 600 |

3. **不要修改**现有的 `wuhuajin.com` 和 `www` 记录（它们仍指向 GitHub Pages）

### 5.2 验证 DNS 生效

```bash
# 等待 1-10 分钟后验证
dig @8.8.8.8 +short fundscope.wuhuajin.com
# 期望输出: 47.107.183.204
```

---

## 六、PM2 配置（步骤 2）

### 6.1 重启服务（去掉 BASE_PATH）

```bash
cd /root/fundscope

# 停掉旧服务（清除 BASE_PATH 环境变量）
pm2 delete fund-server 2>/dev/null

# 不带 BASE_PATH 重新启动
pm2 start server.js --name fund-server

# 保存配置
pm2 save
```

### 6.2 设置开机自启（首次配置时执行）

```bash
pm2 startup systemd
# 按提示复制执行输出的命令
pm2 save
```

### 6.3 验证服务

```bash
# 查看进程状态
pm2 list
# 期望: fund-server 状态为 online

# 查看启动日志（不应再有 BASE_PATH 行）
pm2 logs fund-server --lines 10 --nostream

# 直接访问 Node.js 服务
curl http://127.0.0.1:3000/api/funds/config
# 期望: {"success":true,"funds":[...]}

curl http://127.0.0.1:3000/health
# 期望: OK
```

---

## 七、Nginx 配置（步骤 3-5）

### 7.1 准备 webroot 目录

```bash
sudo mkdir -p /var/www/html
sudo chown -R nginx:nginx /var/www/html
```

### 7.2 备份旧配置

```bash
sudo cp /etc/nginx/conf.d/fundscope.conf /etc/nginx/conf.d/fundscope.conf.bak.$(date +%Y%m%d)
```

### 7.3 先部署 HTTP-80 块（用于签发证书）

```bash
sudo vim /etc/nginx/conf.d/fundscope.conf
```

写入以下内容（仅 HTTP 块）：

```nginx
server {
    listen 80;
    server_name fundscope.wuhuajin.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

检查并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 7.4 申请 SSL 证书（步骤 4）

使用 webroot 方式（支持自动续期，优于旧的 `--manual --preferred-challenges dns`）：

```bash
sudo certbot certonly --webroot -w /var/www/html -d fundscope.wuhuajin.com
```

验证证书签发：

```bash
sudo ls /etc/letsencrypt/live/fundscope.wuhuajin.com/
# 期望: cert.pem  chain.pem  fullchain.pem  privkey.pem  README
```

### 7.5 部署完整 Nginx 配置（步骤 5）

将 `docs/fundscope.conf` 的完整内容写入服务器配置文件：

```bash
sudo vim /etc/nginx/conf.d/fundscope.conf
```

完整配置内容（参考仓库内 `docs/fundscope.conf`）：

```nginx
# WebSocket Connection 头映射
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# ---------- HTTP 80 ----------
server {
    listen 80;
    server_name fundscope.wuhuajin.com;

    access_log /var/log/nginx/fundscope.access.log;
    error_log  /var/log/nginx/fundscope.error.log;

    # Let's Encrypt webroot 证书验证
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    # 其余请求跳转 HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# ---------- HTTPS 443 ----------
server {
    listen 443 ssl http2;
    server_name fundscope.wuhuajin.com;

    ssl_certificate     /etc/letsencrypt/live/fundscope.wuhuajin.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fundscope.wuhuajin.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    access_log /var/log/nginx/fundscope.access.log;
    error_log  /var/log/nginx/fundscope.error.log;

    # 根路径反向代理（proxy_pass 不带尾部斜杠，原样转发）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 16k;

        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

检查并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 八、防火墙与安全组

### 8.1 阿里云安全组

阿里云控制台 → ECS → 安全组 → 确认入方向规则：

| 协议 | 端口范围 | 授权对象 | 优先级 |
|---|---|---|---|
| TCP | 80/80 | 0.0.0.0/0 | 1 |
| TCP | 443/443 | 0.0.0.0/0 | 1 |

**不要开放 3000 端口**，Node.js 仅通过 Nginx 反向代理对外服务。

### 8.2 服务器本地防火墙

```bash
# 查看 firewalld 状态
sudo firewall-cmd --list-all

# 如果 firewalld 正在运行，开放 HTTP/HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 九、验证部署

### 9.1 本地服务验证

```bash
# 1. PM2 状态
pm2 list
# 期望: fund-server 状态为 online

# 2. Node.js 直接访问
curl http://127.0.0.1:3000/api/funds/config
# 期望: {"success":true,"funds":[...]}

# 3. 通过 Nginx HTTPS 访问
curl -sk https://127.0.0.1/api/funds/config -H "Host: fundscope.wuhuajin.com"
# 期望: {"success":true,"funds":[...]}
```

### 9.2 外部访问验证

```bash
# HTTPS 首页
curl -I https://fundscope.wuhuajin.com/
# 期望: HTTP/2 200

# HTTPS API
curl -s https://fundscope.wuhuajin.com/api/funds/config
# 期望: {"success":true,"funds":[...]}

# HTTPS 静态资源
curl -I https://fundscope.wuhuajin.com/js/app.js
# 期望: HTTP/2 200, Content-Type: application/javascript

# HTTP 自动跳转
curl -I http://fundscope.wuhuajin.com/
# 期望: 301 → https://fundscope.wuhuajin.com/
```

### 9.3 浏览器验证

1. 访问 `https://fundscope.wuhuajin.com/`
2. F12 → Network 检查：
   - `api/funds/config` 请求 URL 为 `https://fundscope.wuhuajin.com/api/funds/config`，状态 200
   - **不走** `api.allorigins.win` 等 CORS 代理（确认 IS_STATIC 修复生效）
3. 输入基金代码如 `000001` 测试查询
4. 检查持仓数据、图表、股票行情是否正常

### 9.4 主站影响验证

```bash
# 确认主站仍正常（GitHub Pages）
curl -I https://wuhuajin.com/
# 期望: 200，由 GitHub Pages 返回
```

---

## 十、清理旧配置（观察 1-2 天后执行）

确认新子域名稳定运行后，清理旧的子路径配置：

### 10.1 移除旧 Nginx server 块

如果 `/etc/nginx/conf.d/` 中还有旧的 `wuhuajin.com` / `www.wuhuajin.com` server 块：

```bash
# 查看所有配置
sudo nginx -T 2>&1 | grep -E "server_name|listen"

# 编辑旧配置文件，删除 wuhuajin.com/www 的 server 块
sudo vim /etc/nginx/conf.d/旧配置文件.conf

# 重载
sudo nginx -t && sudo systemctl reload nginx
```

### 10.2 删除旧证书

```bash
# 查看所有证书
sudo certbot certificates

# 删除旧证书（wuhuajin.com DNS 已指向 GitHub，无法续期）
sudo certbot delete --cert-name wuhuajin.com
```

### 10.3 验证自动续期

```bash
sudo certbot renew --dry-run
# 期望: Congratulations, all simulated renewals succeeded
```

---

## 十一、更新部署流程

代码更新后，执行以下步骤：

```bash
# 1. 拉取最新代码
cd /root/fundscope
git pull origin main

# 2. 安装/更新依赖（如有变更）
npm install

# 3. 重启服务
pm2 restart fund-server

# 4. 验证
pm2 logs fund-server --lines 20
curl -s https://fundscope.wuhuajin.com/api/funds/config | head -c 100
```

---

## 十二、回滚方案

### 12.1 回滚到子路径方案（如需）

```bash
# 1. 恢复旧 Nginx 配置
sudo cp /etc/nginx/conf.d/fundscope.conf.bak.YYYYMMDD /etc/nginx/conf.d/fundscope.conf
sudo nginx -t && sudo systemctl reload nginx

# 2. PM2 重新带上 BASE_PATH 启动
pm2 delete fund-server
BASE_PATH=/fundscope pm2 start server.js --name fund-server
pm2 save

# 3. DNS 改回 wuhuajin.com → 阿里云（注意：这会影响主站）
```

### 12.2 回滚代码

```bash
cd /root/fundscope
git log --oneline -10
git checkout <commit-hash>
pm2 restart fund-server
```

---

## 十三、故障排查

### 13.1 常见问题速查表

| 问题 | 排查步骤 |
|---|---|
| 页面 502 Bad Gateway | ① `pm2 list` 确认 Node 在线 ② `curl 127.0.0.1:3000` 确认服务存活 ③ 检查 `proxy_pass` 端口是否一致 |
| 页面 404 Not Found | ① `dig fundscope.wuhuajin.com` 确认 DNS 指向阿里云 ② 检查 Nginx `server_name` 是否匹配 ③ 确认 `proxy_pass` 不带尾部斜杠 |
| API 请求 404 | ① `curl 127.0.0.1:3000/api/funds/config` 验证 Node.js ② 检查 Nginx `location /` 配置 ③ 确认 PM2 不带 BASE_PATH |
| 静态资源 404 | ① 检查 `index.html` 引用的路径是否为相对路径 ② 确认 Nginx 原样转发（proxy_pass 不带 `/`） |
| 前端走 CORS 代理 | ① F12 Network 检查请求是否走 `api.allorigins.win` ② 确认 app.js IS_STATIC 识别 `fundscope.wuhuajin.com` ③ 清除浏览器缓存或 bump 版本号 |
| HTTPS 证书错误 | ① `sudo certbot renew --dry-run` 检查续期 ② 确认 DNS 解析正确 ③ 查看 `/etc/letsencrypt/live/fundscope.wuhuajin.com/` 证书文件 |
| 证书续期失败 | ① 确认 webroot 目录 `/var/www/html` 存在且可写 ② 确认 Nginx `/.well-known/acme-challenge/` location 配置正确 |

### 13.2 日志排查命令

```bash
# Nginx 访问日志
sudo tail -f /var/log/nginx/fundscope.access.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/fundscope.error.log

# PM2 应用日志
pm2 logs fund-server --lines 100

# 系统日志
sudo journalctl -u nginx -f
```

### 13.3 一键诊断脚本

```bash
#!/bin/bash
echo "=== 1. DNS 解析 ==="
dig +short fundscope.wuhuajin.com

echo -e "\n=== 2. PM2 状态 ==="
pm2 list

echo -e "\n=== 3. Node.js 直接测试 ==="
curl -s http://127.0.0.1:3000/api/funds/config | head -c 200

echo -e "\n\n=== 4. Nginx HTTPS 测试 ==="
curl -s https://fundscope.wuhuajin.com/api/funds/config | head -c 200

echo -e "\n\n=== 5. Nginx 配置检查 ==="
sudo nginx -t

echo -e "\n=== 6. 端口监听 ==="
ss -tlnp | grep -E '80|443|3000'

echo -e "\n=== 7. 证书状态 ==="
sudo certbot certificates 2>/dev/null | grep -A 2 "fundscope.wuhuajin.com"
```

---

## 十四、安全注意事项

1. **不暴露 3000 端口**：阿里云安全组只开放 80/443
2. **Nginx 作为唯一入口**：所有外部流量走 Nginx 反向代理
3. **HTTPS 强制**：HTTP 自动重定向到 HTTPS
4. **日志定期清理**：PM2 和 Nginx 日志占用磁盘空间
5. **定期更新**：`npm update` 修复安全漏洞
6. **备份配置**：Nginx 配置和 PM2 配置定期备份

```bash
# 备份 Nginx 配置
sudo cp /etc/nginx/conf.d/fundscope.conf ~/fundscope.conf.bak.$(date +%Y%m%d)

# 备份 PM2 配置
pm2 save
cp ~/.pm2/dump.pm2 ~/pm2-backup/
```

---

## 十五、部署顺序速查

```
1. DNS 加 A 记录 fundscope → 47.107.183.204（等生效）
2. 代码 git pull（app.js + index.html 已改）
3. PM2 重启（pm2 delete + pm2 start，不带 BASE_PATH）
4. Nginx 先部署 HTTP-80 块 → reload
5. certbot webroot 签发 fundscope.wuhuajin.com 证书
6. Nginx 部署完整配置（HTTP+HTTPS）→ reload
7. 浏览器验证 https://fundscope.wuhuajin.com/
8. 观察 1-2 天 → 清理旧配置 + 验证证书自动续期
```
