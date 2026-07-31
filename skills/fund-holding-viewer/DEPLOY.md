---
name: "fund-scope-deploy"
description: "FundScope 基金持仓分析平台部署指南。适用于将 Node.js + Express 应用部署到阿里云（Alibaba Cloud Linux 3），通过 Nginx 反向代理实现子路径访问（wuhuajin.com/fundscope），并配置 HTTPS。"
---

# FundScope 部署指南（阿里云 Alibaba Cloud Linux 3）

## 一、部署架构概览

```
浏览器访问 wuhuajin.com/fundscope/
    │
    ▼
Nginx (80/443) — 反向代理
    │  location /fundscope/
    │  proxy_pass http://127.0.0.1:3000/  ← 剥离 /fundscope 前缀
    ▼
Node.js Express (3000) — PM2 管理
    │
    ├── /fundscope/api/*  →  /api/*   （API 路由）
    ├── /fundscope/js/*   →  /js/*    （静态文件）
    ├── /fundscope/css/*  →  /css/*   （静态文件）
    └── /fundscope/       →  /        （首页 index.html）
```

### 核心设计
- **Node.js 服务保持 localhost:3000 不变**，本地开发测试不受影响
- **Nginx 负责路径剥离**：外部 `/fundscope/*` → 内部 `/*`
- **PM2 进程管理**：自动重启、开机自启
- **HTTPS**：Let's Encrypt 免费证书自动续期

---

## 二、环境信息

| 项目 | 说明 |
|---|---|
| 操作系统 | Alibaba Cloud Linux 3.2104 LTS 64位 |
| 域名 | wuhuajin.com |
| GitHub 仓库 | fundscope |
| 项目访问地址 | wuhuajin.com/fundscope |
| Node.js 端口 | 3000 |
| 进程管理 | PM2 |
| 反向代理 | Nginx |

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

### 3.2 获取服务器公网 IP

```bash
# 方式1：阿里云控制台 → ECS → 实例详情 → 公网 IP
# 方式2：命令行查询
curl ifconfig.me
```

### 3.3 确认 DNS 解析

在域名服务商（阿里云万网）配置 DNS 解析记录：

| 记录类型 | 主机记录 | 记录值 |
|---|---|---|
| A | @ | 服务器公网 IP |
| A | www | 服务器公网 IP |

验证解析生效：
```bash
ping wuhuajin.com
ping www.wuhuajin.com
```

---

## 四、代码准备

### 4.1 拉取代码

```bash
cd /home/admin
git clone https://github.com/你的用户名/fundscope.git
cd fundscope
```

### 4.2 安装依赖

```bash
npm install
```

### 4.3 代码变更说明（已完成）

以下文件已修改以支持子路径部署：

**`js/app.js`** — 两处修改：

1. `IS_STATIC` 检测逻辑 — 生产域名 `wuhuajin.com` 强制后端模式
```javascript
const IS_STATIC = (() => {
    const host = window.location.hostname;
    if (host.endsWith('.github.io')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host === 'wuhuajin.com' || host === 'www.wuhuajin.com') return false;
    return window.location.protocol === 'https:' && !window.location.port;
})();
```

2. API 路径改为相对路径（4处）
```javascript
// 旧：request('/api/fund/info?code=...')
// 新：request('api/fund/info?code=...')
// 相对路径配合 Nginx 路径剥离自动带上 /fundscope 前缀
```

**`server.js`** — 新增 `BASE_PATH` 环境变量：
```javascript
const BASE_PATH = process.env.BASE_PATH || '';

// 静态服务挂载到 BASE_PATH
app.use(BASE_PATH || '/', express.static(...));

// 兜底路由检查 BASE_PATH
app.get('*', (req, res) => {
    if (BASE_PATH && !req.path.startsWith(BASE_PATH) && req.path !== '/') {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});
```

---

## 五、PM2 配置

### 5.1 启动服务（带 BASE_PATH）

```bash
# 停掉旧服务（如果存在）
pm2 delete web-server 2>/dev/null

# 使用环境变量启动
BASE_PATH=/fundscope pm2 start server.js --name web-server

# 查看服务状态
pm2 list
pm2 logs web-server --lines 20
```

### 5.2 保存 PM2 配置

```bash
# 保存当前进程列表
pm2 save

# 设置开机自启（首次配置时执行）
pm2 startup systemd
# 按提示复制执行输出的命令

# 再次保存（确保开机自启配置持久化）
pm2 save
```

### 5.3 PM2 常用命令

```bash
pm2 list                    # 查看所有进程
pm2 logs web-server         # 查看实时日志
pm2 logs web-server --lines 50  # 查看最近50行
pm2 restart web-server      # 重启服务
pm2 stop web-server         # 停止服务
pm2 delete web-server       # 删除服务
pm2 flush                   # 清空日志
```

---

## 六、Nginx 配置

### 6.1 查看现有配置

```bash
# Nginx 主配置
cat /etc/nginx/nginx.conf

# 检查已加载的配置文件
sudo nginx -T | grep -E 'server_name|server {'

# 列出 conf.d 目录
ls -la /etc/nginx/conf.d/
```

### 6.2 创建站点配置

```bash
sudo vim /etc/nginx/conf.d/fundscope.conf
```

写入以下内容：

```nginx
# ============================================================
# FundScope - 基金持仓分析平台
# 访问地址: http://wuhuajin.com/fundscope
# 架构: Nginx → Node.js(3000) → 上游 API
# ============================================================

server {
    listen 80;
    server_name wuhuajin.com www.wuhuajin.com;

    # 日志
    access_log /var/log/nginx/fundscope.access.log;
    error_log  /var/log/nginx/fundscope.error.log;

    # 重定向 /fundscope → /fundscope/（确保相对路径正确解析）
    location = /fundscope {
        return 301 /fundscope/;
    }

    # 核心：/fundscope/ 路径反向代理到 Node.js
    # 注意 proxy_pass 末尾的 /：表示剥离 /fundscope 前缀
    # 外部请求 /fundscope/api/fund/info → 内部 /api/fund/info
    location /fundscope/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;

        # 传递真实客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（适配基金数据请求）
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # 缓冲区设置
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 16k;

        # WebSocket 支持（预留）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 根路径健康检查
    location = /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
```

### 6.3 检查并重载配置

```bash
# 检查配置语法
sudo nginx -t

# 重载配置（不中断现有连接）
sudo systemctl reload nginx

# 如果是首次安装，直接启动
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 6.4 多配置冲突排查

如果已有其他 server 块占用 `wuhuajin.com`：

```bash
# 查看所有加载的配置
sudo nginx -T

# 检查是否有重复的 server_name
sudo nginx -T 2>&1 | grep -n "server_name.*wuhuajin"

# 禁用冲突配置（示例）
# sudo mv /etc/nginx/conf.d/old-config.conf /etc/nginx/conf.d/old-config.conf.disabled
# sudo nginx -t && sudo systemctl reload nginx
```

---

## 七、防火墙与安全组

### 7.1 阿里云安全组

阿里云控制台 → ECS → 安全组 → 添加入方向规则：

| 协议 | 端口范围 | 授权对象 | 优先级 |
|---|---|---|---|
| TCP | 80/80 | 0.0.0.0/0 | 1 |
| TCP | 443/443 | 0.0.0.0/0 | 1 |

### 7.2 服务器本地防火墙

```bash
# 查看 firewalld 状态
sudo firewall-cmd --list-all

# 如果 firewalld 正在运行，开放 HTTP
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload

# 或者直接关闭防火墙（阿里云安全组已防护时）
sudo systemctl stop firewalld
sudo systemctl disable firewalld
```

---

## 八、HTTPS 配置（推荐）

### 8.1 安装 Certbot

```bash
# Alibaba Cloud Linux 3 兼容 CentOS 8
sudo dnf install -y certbot python3-certbot-nginx
```

### 8.2 申请证书

```bash
# 申请 Let's Encrypt 免费证书（Nginx 自动配置）
sudo certbot --nginx -d wuhuajin.com -d www.wuhuajin.com

# 按提示：
# 1. 输入邮箱（用于到期通知）
# 2. 同意服务条款
# 3. 选择是否强制 HTTPS 重定向（推荐：Redirect）
```

### 8.3 自动续期

```bash
# 验证自动续期
sudo certbot renew --dry-run

# 查看续期计时器
sudo systemctl list-timers | grep certbot
```

Certbot 会自动修改 Nginx 配置：
- 添加 443 端口 SSL server 块
- 配置证书路径 `/etc/letsencrypt/live/wuhuajin.com/fullchain.pem`
- HTTP(80) 自动 301 重定向到 HTTPS(443)

---

## 九、验证部署

### 9.1 本地服务验证

```bash
# 1. Node.js 服务检查
pm2 list                    # 状态应为 online
pm2 logs web-server         # 无错误日志

# 2. Node.js 直接访问
curl http://127.0.0.1:3000/api/funds/config
# 返回: {"success":true,"funds":[...]}

# 3. 通过 Nginx 验证
curl http://127.0.0.1/fundscope/api/funds/config
# 返回: {"success":true,"funds":[...]}

# 4. 首页访问
curl -I http://127.0.0.1/fundscope/
# 返回: HTTP/1.1 200 OK
```

### 9.2 外部访问验证

```bash
# HTTP 访问
curl -I http://wuhuajin.com/fundscope/

# HTTPS 访问
curl -I https://wuhuajin.com/fundscope/

# API 接口测试
curl https://wuhuajin.com/fundscope/api/fund/info?code=000001
```

### 9.3 浏览器验证

1. 访问 `https://wuhuajin.com/fundscope/`
2. 输入基金代码如 `000001` 测试查询
3. 检查持仓数据、图表、股票行情是否正常
4. F12 → Network 检查 API 请求路径是否正确

---

## 十、故障排查

### 10.1 常见问题速查表

| 问题 | 排查步骤 |
|---|---|
| 页面 502 Bad Gateway | ① `pm2 list` 确认 Node 在线 ② `curl 127.0.0.1:3000` 确认服务存活 ③ 检查 `proxy_pass` 端口是否一致 |
| 页面 404 Not Found | ① 检查 Nginx `location /fundscope/` 配置 ② 确认 `proxy_pass` 末尾带 `/` ③ 检查 `server_name` 是否匹配 |
| API 请求 404 | ① 确认 Nginx 路径剥离正常 ② `curl 127.0.0.1:3000/api/funds/config` 验证 ③ 检查 app.js 中 API 路径为相对路径 |
| 静态资源 404 | ① 检查 `index.html` 引用的路径是否为相对路径 ② 确认 Nginx 正确转发静态文件请求 |
| HTTPS 证书错误 | ① `certbot renew --dry-run` 检查续期 ② 确认 DNS 解析正确 ③ 查看 `/etc/letsencrypt/live/` 证书文件 |
| 页面加载慢 | ① `pm2 logs web-server` 检查响应时间 ② 检查 Nginx 缓冲区配置 ③ 确认上游 API 响应速度 |

### 10.2 日志排查命令

```bash
# Nginx 访问日志（查看请求是否到达）
sudo tail -f /var/log/nginx/fundscope.access.log

# Nginx 错误日志（查看代理错误）
sudo tail -f /var/log/nginx/fundscope.error.log

# PM2 应用日志
pm2 logs web-server --lines 100

# 系统日志
sudo journalctl -u nginx -f
sudo journalctl -u pm2-web-server -f
```

### 10.3 一键诊断脚本

```bash
#!/bin/bash
echo "=== 1. PM2 状态 ==="
pm2 list

echo -e "\n=== 2. Node.js 直接测试 ==="
curl -s http://127.0.0.1:3000/api/funds/config | head -c 200

echo -e "\n\n=== 3. Nginx 代理测试 ==="
curl -s http://127.0.0.1/fundscope/api/funds/config | head -c 200

echo -e "\n\n=== 4. Nginx 配置检查 ==="
sudo nginx -t

echo -e "\n=== 5. 端口监听 ==="
ss -tlnp | grep -E '80|443|3000'

echo -e "\n=== 6. 安全组连通测试 ==="
echo "请在浏览器访问 https://wuhuajin.com/fundscope/ 验证"
```

---

## 十一、更新部署流程

当代码更新后，执行以下步骤：

```bash
# 1. 拉取最新代码
cd /home/admin/fundscope
git pull origin main

# 2. 安装/更新依赖
npm install

# 3. 重启服务
pm2 restart web-server

# 4. 验证
pm2 logs web-server --lines 20
curl -s http://127.0.0.1:3000/api/funds/config | head -c 100
```

---

## 十二、回滚方案

如果新版本出问题，快速回滚：

```bash
# 查看 git 历史
git log --oneline -10

# 回滚到指定版本
git checkout <commit-hash>

# 重启服务
pm2 restart web-server
```

---

## 十三、性能优化建议

### 13.1 Nginx 缓存（可选）

在 `location /fundscope/` 内添加静态资源缓存：

```nginx
# CSS/JS 缓存 7 天
location ~* /fundscope/(css|js)/.*\.(css|js)$ {
    proxy_pass http://127.0.0.1:3000;
    expires 7d;
    add_header Cache-Control "public, immutable";
}

# 图片缓存 30 天
location ~* /fundscope/.*\.(png|jpg|jpeg|gif|ico|svg)$ {
    proxy_pass http://127.0.0.1:3000;
    expires 30d;
    add_header Cache-Control "public";
}
```

### 13.2 PM2 集群模式（高并发时）

```bash
# 使用多核集群
pm2 start server.js --name web-server -i 2

# 但注意：集群模式下 BASE_PATH 环境变量需正确传递
```

### 13.3 Node.js 内存调优

```bash
# PM2 启动时增加内存限制
BASE_PATH=/fundscope pm2 start server.js --name web-server \
    --node-args="--max-old-space-size=512"
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
sudo cp /etc/nginx/conf.d/fundscope.conf ~/fundscope.conf.bak

# 备份 PM2 配置
pm2 save
cp ~/.pm2/dump.pm2 ~/pm2-backup/
```