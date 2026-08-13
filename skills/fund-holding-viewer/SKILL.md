---
name: "fund-holding-viewer"
description: "基金持仓分析H5应用部署方案。覆盖阿里云ECS部署，支持子域名HTTPS（fundscope.wuhuajin.com）和子路径HTTPS（wuhuajin.com/fundscope）两种模式，含SSL证书签发、Nginx配置、PM2管理、故障排查全流程。"
---

# FundScope 部署 SKILL

## 一、架构概览

```
用户浏览器
    │
    ▼
  Nginx (80→443 重定向, 443 SSL 终止)
    │
    ├─ 子域名模式: fundscope.wuhuajin.com/ → proxy_pass 127.0.0.1:3000
    └─ 子路径模式: wuhuajin.com/fundscope/ → proxy_pass 127.0.0.1:3000/ (剥离前缀)
    │
    ▼
  Node.js Express (端口 3000, PM2 守护)
    ├── /api/funds/config   基金配置
    ├── /api/fund/info      基金信息
    ├── /api/fund/holdings  持仓明细
    ├── /api/stock/quote    股票行情
    └── /*                  静态资源 + index.html
```

## 二、方案选择

| 对比项 | ⭐ 方案 A：子域名 HTTPS | 方案 B：子路径 HTTPS |
|--------|------------------------|---------------------|
| 访问地址 | https://fundscope.wuhuajin.com | https://wuhuajin.com/fundscope |
| 对博客影响 | **无**（wuhuajin.com 继续 GitHub Pages） | 需将 wuhuajin.com DNS 切到阿里云，主站需反代回 GitHub Pages |
| 代码改动 | 无 | 需改 server.js、app.js、index.html 适配前缀 |
| 部署复杂度 | 简单 | 复杂 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

**结论：优先使用方案 A（子域名 HTTPS），除非明确要求子路径。**

---

## 三、方案 A：子域名 HTTPS 部署（推荐）

### 前置条件
- 阿里云 ECS（Alibaba Cloud Linux 3 / CentOS 8+），公网 IP 如 `47.107.183.204`
- 域名 `wuhuajin.com` 已备案
- 服务器已安装：Node.js ≥14、Git、Nginx、PM2

### Step 1：DNS 解析
阿里云域名控制台 → `wuhuajin.com` → 解析 → 添加记录：

| 类型 | 主机记录 | 记录值 | TTL |
|------|---------|--------|-----|
| A | `fundscope` | `47.107.183.204` | 600 |

验证生效：
```bash
dig @8.8.8.8 +short fundscope.wuhuajin.com
# 期望输出: 47.107.183.204
```

### Step 2：代码准备 + 启动服务
```bash
cd /root
[ -d fundscope ] || git clone https://github.com/whjin/fundscope.git
cd fundscope
git pull origin main
npm install --production

# 启动 / 重启服务
pm2 delete fund-server 2>/dev/null; pm2 start server.js --name fund-server
pm2 save
pm2 startup systemd   # 首次设置，复制输出命令执行

# 验证本地
curl -s http://127.0.0.1:3000/api/funds/config | head -c 100
```

### Step 3：阿里云安全组 + 防火墙
ECS 控制台 → 安全组 → 入方向开放：
- TCP 80  (0.0.0.0/0)
- TCP 443 (0.0.0.0/0)
- **不要开放 3000**

```bash
# 服务器本地防火墙（如启用）
firewall-cmd --permanent --add-service=http --add-service=https 2>/dev/null
firewall-cmd --reload 2>/dev/null
```

### Step 4：Nginx HTTP 配置（先用于证书签发）
```bash
mkdir -p /var/www/html && chown -R nginx:nginx /var/www/html

cat > /etc/nginx/conf.d/fundscope.conf << 'EOF'
server {
    listen 80;
    server_name fundscope.wuhuajin.com;
    access_log /var/log/nginx/fundscope.access.log;
    error_log  /var/log/nginx/fundscope.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}
EOF

nginx -t && systemctl reload nginx
```

### Step 5：签发 SSL 证书（Let's Encrypt，webroot 方式）
```bash
# 安装 certbot（首次）
dnf install -y certbot python3-certbot-nginx 2>/dev/null || \
apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true

# 签发证书
certbot certonly --webroot -w /var/www/html -d fundscope.wuhuajin.com --non-interactive --agree-tos -m your-email@example.com

# 验证
ls /etc/letsencrypt/live/fundscope.wuhuajin.com/
# 应包含: fullchain.pem  privkey.pem
```

### Step 6：Nginx 完整 HTTPS 配置
```bash
cat > /etc/nginx/conf.d/fundscope.conf << 'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# HTTP → HTTPS 重定向 + 证书续期
server {
    listen 80;
    server_name fundscope.wuhuajin.com;
    access_log /var/log/nginx/fundscope.access.log;
    error_log  /var/log/nginx/fundscope.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS 主配置
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

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_connect_timeout 30s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 16k;
    }
}
EOF

nginx -t && systemctl reload nginx
```

### Step 7：验证部署
```bash
# 1. HTTP 跳转
curl -I http://fundscope.wuhuajin.com/
# 期望: 301 → https://fundscope.wuhuajin.com/

# 2. HTTPS 首页
curl -I https://fundscope.wuhuajin.com/
# 期望: HTTP/2 200

# 3. HTTPS API
curl -s https://fundscope.wuhuajin.com/api/funds/config
# 期望: {"success":true,"funds":[...]}

# 4. 证书自动续期测试
certbot renew --dry-run
# 期望: Congratulations, all simulated renewals succeeded
```

浏览器打开 `https://fundscope.wuhuajin.com/` → F12 检查：
- 地址栏小锁 ✅
- API 请求不走 CORS 代理（确认 IS_STATIC=false）✅

---

## 四、方案 B：子路径 HTTPS 部署（wuhuajin.com/fundscope）

> ⚠️  **影响：需将 wuhuajin.com DNS 从 GitHub Pages 切到阿里云，主站需反代回 GitHub Pages。**

### 4.1 代码改动（必须）

**server.js** — 路由挂到 BASE_PATH：
```javascript
const BASE_PATH = process.env.BASE_PATH || '';
// ... 所有 app.use / app.get 前加上 BASE_PATH 前缀：
app.use(BASE_PATH + '/', express.static(...));
app.get(BASE_PATH + '/api/fund/info', ...);
app.get(BASE_PATH + '/api/fund/holdings', ...);
app.get(BASE_PATH + '/api/stock/quote', ...);
app.get(BASE_PATH + '/api/funds/config', ...);
app.get(BASE_PATH + '/*', (_req, res) => res.sendFile(...));
```

**js/app.js** — IS_STATIC + API 路径适配：
```javascript
const BASE_PATH = (() => {
    const p = window.location.pathname;
    const idx = p.indexOf('/index.html');
    return idx > 0 ? p.slice(0, idx) : (p.endsWith('/') ? p.slice(0, -1) : p);
})();
const IS_STATIC = (() => {
    const host = window.location.hostname;
    if (host.endsWith('.github.io')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host === 'wuhuajin.com' || host.endsWith('.wuhuajin.com')) return false;
    return window.location.protocol === 'https:' && !window.location.port;
})();
// request() 中 URL 加上 BASE_PATH:
return request(BASE_PATH + '/api/funds/config');
return request(BASE_PATH + `/api/fund/info?code=...`);
```

**index.html** — 静态资源加前缀：
```html
<link rel="stylesheet" href="css/style.css?v=14" />
<!-- 改为动态前缀或手动改为 /fundscope/css/style.css -->
```

### 4.2 PM2 启动
```bash
cd /root/fundscope
pm2 delete fund-server 2>/dev/null
BASE_PATH=/fundscope pm2 start server.js --name fund-server
pm2 save
```

### 4.3 DNS 切换
将 `wuhuajin.com` 的 A 记录从 GitHub Pages IP 改为阿里云 IP `47.107.183.204`。

### 4.4 签发证书（含主域）
```bash
certbot certonly --webroot -w /var/www/html -d wuhuajin.com -d www.wuhuajin.com -d fundscope.wuhuajin.com
```

### 4.5 Nginx 配置（子路径 + 主站反代）
```nginx
# HTTP → HTTPS
server {
    listen 80;
    server_name wuhuajin.com www.wuhuajin.com;
    location /.well-known/acme-challenge/ { root /var/www/html; try_files $uri =404; }
    location / { return 301 https://$host$request_uri; }
}

# HTTPS 主站
server {
    listen 443 ssl http2;
    server_name wuhuajin.com www.wuhuajin.com;

    ssl_certificate     /etc/letsencrypt/live/wuhuajin.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wuhuajin.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # ===== 主站博客反代回 GitHub Pages =====
    location / {
        proxy_pass https://whjin.github.io;  # 替换为你的 GitHub Pages 地址
        proxy_set_header Host whjin.github.io;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_ssl_server_name on;
        proxy_connect_timeout 30s;
    }

    # ===== FundScope 子路径 =====
    location ^~ /fundscope/ {
        # 注意: proxy_pass 末尾带 / → 剥离 /fundscope/ 前缀后转发
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout    60s;
    }

    # 兼容无尾斜杠: /fundscope → 301 → /fundscope/
    location = /fundscope {
        return 301 /fundscope/;
    }
}
```

---

## 五、日常运维

| 操作 | 命令 |
|------|------|
| 查看服务状态 | `pm2 status` |
| 查看日志 | `pm2 logs fund-server --lines 100` |
| 重启服务 | `pm2 restart fund-server` |
| 更新代码 | `cd /root/fundscope && git pull && pm2 restart fund-server` |
| 更新代码（含依赖） | `cd /root/fundscope && git pull && npm install && pm2 restart fund-server` |
| Nginx 重载 | `nginx -t && systemctl reload nginx` |
| 证书续期 | `certbot renew`（Let's Encrypt 自动设置 timer） |

---

## 六、故障排查速查

| 现象 | 排查 |
|------|------|
| 502 Bad Gateway | `pm2 list` 看 Node 是否 online → `curl 127.0.0.1:3000/api/funds/config` |
| 404 Not Found | DNS 解析是否正确 → Nginx `server_name` 匹配 → 子路径注意 proxy_pass 尾部 `/` |
| 前端走 CORS 代理 | app.js IS_STATIC 是否误判 → 浏览器硬刷新（Ctrl+Shift+R） |
| API 404（子路径） | server.js 是否挂了 BASE_PATH 前缀 → PM2 是否传了 BASE_PATH |
| 静态资源 404（子路径） | index.html 资源路径是否加前缀 → Nginx `location ^~ /fundscope/` 是否命中 |
| HTTPS 证书错误 | `certbot certificates` 查看有效期 → `certbot renew --dry-run` 测试续期 |
| 证书续期失败 | webroot 目录 `/var/www/html` 存在且可写 → Nginx `/.well-known/acme-challenge/` 正确 |
| HTTP 不跳转 | Nginx 80 端口 server 块 `return 301` 是否存在 → `nginx -t` 检查 |

---

## 七、部署顺序速记卡

### 方案 A（子域名 HTTPS）
```
1. DNS: fundscope A → 阿里云IP（等待生效）
2. 服务器: git pull + npm install + pm2 start
3. 安全组: 开放 80/443
4. Nginx: 先写 HTTP-80 块 → reload
5. Certbot: webroot 签发 fundscope.wuhuajin.com 证书
6. Nginx: 写入完整 HTTPS 配置 → reload
7. 验证: curl + 浏览器访问 https://fundscope.wuhuajin.com/
8. 观察 1-2 天: certbot renew --dry-run
```

### 方案 B（子路径 HTTPS）
```
1. 代码: 修改 server.js + app.js + index.html 适配 BASE_PATH
2. PM2: BASE_PATH=/fundscope pm2 start
3. DNS: wuhuajin.com A → 阿里云IP（⚠️ 博客会短暂中断）
4. Nginx HTTP-80 块 → reload
5. Certbot: 签发 wuhuajin.com (+www) 证书
6. Nginx: 主站反代 GitHub Pages + /fundscope/ 子路径代理 → reload
7. 验证: https://wuhuajin.com/fundscope/ + https://wuhuajin.com/ (博客正常)
```
