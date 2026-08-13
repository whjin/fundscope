#!/usr/bin/env bash
#
# FundScope 服务器一键部署脚本
# 适用环境: Alibaba Cloud Linux 3 / CentOS 8+ (x86_64)
# 使用方式: sudo bash Server_Deploy.sh
#
set -euo pipefail

# ========== 配置项（按需修改）==========
APP_NAME="fund-server"
APP_PORT=3000
DEPLOY_DIR="/root/fundscope"
REPO_URL="https://github.com/whjin/fundscope.git"
BRANCH="main"
DOMAIN="fundscope.wuhuajin.com"
NGINX_CONF="/etc/nginx/conf.d/fundscope.conf"
WEBROOT_DIR="/var/www/html"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_EMAIL=""  # 首次签发证书需填写邮箱，如：your-email@example.com
# ========================================

# ========== 颜色定义 ==========
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; \
          echo -e "${BLUE}  $1${NC}"; \
          echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ========== 前置检查 ==========
step "1/6  前置环境检查"

if [[ $EUID -ne 0 ]]; then
    error "请使用 root 用户或 sudo 执行此脚本"
    exit 1
fi

for cmd in node git nginx; do
    if ! command -v ${cmd} &>/dev/null; then
        error "未安装 ${cmd}，请先安装"
        exit 1
    fi
done

if ! command -v pm2 &>/dev/null; then
    info "安装 PM2..."
    npm install -g pm2
fi

if ! command -v certbot &>/dev/null; then
    info "安装 certbot..."
    dnf install -y certbot python3-certbot-nginx 2>/dev/null || \
    apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true
fi

info "Node $(node -v) | PM2 $(pm2 -v) | Nginx $(nginx -v 2>&1 | cut -d/ -f2)"

# ========== 代码更新 ==========
step "2/6  拉取最新代码"

if [[ ! -d "${DEPLOY_DIR}/.git" ]]; then
    info "首次部署，克隆仓库..."
    git clone -b "${BRANCH}" "${REPO_URL}" "${DEPLOY_DIR}"
else
    info "仓库已存在，检查工作区状态..."
    cd "${DEPLOY_DIR}"

    # 如果有未提交的本地变更，先暂存
    if ! git diff --quiet || ! git diff --cached --quiet; then
        warn "检测到未提交的本地变更，自动暂存..."
        git stash
    fi

    # 如果处于 detached HEAD，切回主分支
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "${CURRENT_BRANCH}" != "${BRANCH}" ]]; then
        warn "当前处于 ${CURRENT_BRANCH}，切换到 ${BRANCH}..."
        git checkout "${BRANCH}"
    fi

    info "拉取远程更新..."
    git pull origin "${BRANCH}"
fi

cd "${DEPLOY_DIR}"
info "当前版本: $(git log --oneline -1)"

# ========== 安装依赖 ==========
step "3/6  安装依赖"

cd "${DEPLOY_DIR}"
npm install --production
info "依赖安装完成"

# ========== PM2 服务管理 ==========
step "4/6  启动/重启服务"

cd "${DEPLOY_DIR}"

if pm2 list | grep -q "${APP_NAME}"; then
    info "重启 ${APP_NAME}..."
    pm2 restart "${APP_NAME}" --update-env
else
    info "首次启动 ${APP_NAME}..."
    pm2 start server.js --name "${APP_NAME}"
fi

pm2 save

# 设置开机自启（首次）
if ! systemctl list-unit-files | grep -q "pm2-.*\.service"; then
    info "设置 PM2 开机自启..."
    pm2 startup systemd -u root --hp /root
fi

# 本地健康检查
sleep 2
if curl -sf "http://127.0.0.1:${APP_PORT}/api/funds/config" | grep -q '"success":true'; then
    info "本地服务健康检查通过 ✅"
else
    warn "本地服务未就绪，查看日志: pm2 logs ${APP_NAME} --lines 30"
fi

# ========== Nginx 配置 ==========
step "5/6  Nginx 配置"

NEED_CERT=false

if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
    NEED_CERT=true
    info "SSL 证书不存在，将先配置 HTTP 用于证书签发"

    # 确保 webroot 目录存在
    mkdir -p "${WEBROOT_DIR}"
    chown -R nginx:nginx "${WEBROOT_DIR}" 2>/dev/null || true

    # 写入 HTTP 临时配置
    cat > "${NGINX_CONF}" << 'NGINX_HTTP'
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
NGINX_HTTP

    nginx -t && systemctl reload nginx

    # 签发证书
    if [[ -z "${CERT_EMAIL}" ]]; then
        error "首次部署需要设置证书邮箱！"
        error "请编辑本脚本，填写 CERT_EMAIL 后重新运行"
        error "或手动执行: certbot certonly --webroot -w ${WEBROOT_DIR} -d ${DOMAIN} -m your-email@example.com --agree-tos --non-interactive"
        exit 1
    fi

    info "签发 SSL 证书 (${DOMAIN})..."
    certbot certonly --webroot -w "${WEBROOT_DIR}" -d "${DOMAIN}" \
        --non-interactive --agree-tos -m "${CERT_EMAIL}"

    if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
        error "证书签发失败，请检查 DNS 解析和域名所有权"
        exit 1
    fi
    info "SSL 证书签发成功 ✅"
fi

# 写入完整 HTTPS 配置
info "写入 Nginx HTTPS 配置..."
cat > "${NGINX_CONF}" << 'NGINX_HTTPS'
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
NGINX_HTTPS

if nginx -t; then
    systemctl reload nginx
    info "Nginx 配置重载成功 ✅"
else
    error "Nginx 配置检测失败，请检查: nginx -t"
    exit 1
fi

# ========== 验证部署 ==========
step "6/6  验证部署"

FAIL=0

# 1. 本地 API
info "检查本地 API..."
if curl -sf "http://127.0.0.1:${APP_PORT}/api/funds/config" | grep -q '"success":true'; then
    info "  本地 API ✅"
else
    warn "  本地 API ❌"
    FAIL=1
fi

# 2. HTTPS 首页
info "检查 HTTPS 首页..."
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>/dev/null || echo "000")
if [[ "${HTTP_CODE}" == "200" ]]; then
    info "  HTTPS 首页 ✅"
else
    warn "  HTTPS 首页 ❌ (HTTP ${HTTP_CODE})"
    FAIL=1
fi

# 3. HTTPS API
info "检查 HTTPS API..."
HTTPS_API=$(curl -sf "https://${DOMAIN}/api/funds/config" 2>/dev/null | grep -c '"success":true' || echo "0")
if [[ "${HTTPS_API}" == "1" ]]; then
    info "  HTTPS API ✅"
else
    warn "  HTTPS API ❌"
    FAIL=1
fi

# 4. HTTP → HTTPS 跳转
info "检查 HTTP 跳转..."
REDIRECT=$(curl -sf -o /dev/null -w "%{http_code}" "http://${DOMAIN}/" 2>/dev/null || echo "000")
if [[ "${REDIRECT}" == "301" ]]; then
    info "  HTTP→HTTPS 跳转 ✅"
else
    warn "  HTTP→HTTPS 跳转 ❌ (HTTP ${REDIRECT})"
    FAIL=1
fi

# ========== 结果汇总 ==========
echo ""
if [[ ${FAIL} -eq 0 ]]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  部署成功！所有检查项通过 ✅${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  访问地址:  https://${DOMAIN}/"
    echo -e "  服务状态:  pm2 status"
    echo -e "  查看日志:  pm2 logs ${APP_NAME} --lines 100"
    echo -e "  更新部署:  sudo bash ${DEPLOY_DIR}/Server_Deploy.sh"
else
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  部署完成，但有部分检查未通过 ⚠️${NC}"
    echo -e "${YELLOW}  排查建议:${NC}"
    echo -e "  - 查看服务日志: pm2 logs ${APP_NAME} --lines 100"
    echo -e "  - 检查 Nginx:   nginx -t && systemctl status nginx"
    echo -e "  - 检查证书:     certbot certificates"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
fi

echo ""
info "部署完成。"
