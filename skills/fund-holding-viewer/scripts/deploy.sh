#!/bin/bash
# ==============================================
# 基金持仓展示系统 - 阿里云一键部署脚本
# 操作系统：Alibaba Cloud Linux 3 / CentOS 8+
# 使用方法：bash deploy.sh
# ==============================================

set -e

# 配置变量
PROJECT_NAME="fund-server"
PROJECT_DIR="/www/fundscope"
GIT_REPO="https://gitclone.com/github.com/whjin/fundscope.git"
PORT=3000
DOMAIN="fundscope.wuhuajin.com"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo "=========================================="
echo "  基金持仓展示系统 - 一键部署"
echo "=========================================="
echo ""

# 1. 更新系统
info "[1/8] 更新系统软件包..."
dnf update -y
info "系统更新完成"

# 2. 安装基础软件
echo ""
info "[2/8] 安装 Node.js、Git、Nginx..."

# 检查是否已安装
if ! command -v node &> /dev/null; then
    dnf install -y nodejs npm
else
    warn "Node.js 已安装: $(node -v)"
fi

if ! command -v git &> /dev/null; then
    dnf install -y git
else
    warn "Git 已安装: $(git --version)"
fi

if ! command -v nginx &> /dev/null; then
    dnf install -y nginx
else
    warn "Nginx 已安装"
fi

info "基础软件安装完成"

# 3. 安装 PM2 进程管理器
echo ""
info "[3/8] 安装 PM2 进程管理器..."

if ! command -v pm2 &> /dev/null; then
    npm install pm2 -g
    info "PM2 安装完成: $(pm2 -v)"
else
    warn "PM2 已安装: $(pm2 -v)"
fi

# 4. 拉取项目代码
echo ""
info "[4/8] 拉取项目代码..."

mkdir -p /www

if [ -d "$PROJECT_DIR" ]; then
    warn "项目目录已存在，更新代码..."
    cd $PROJECT_DIR
    git pull
else
    cd /www
    git clone $GIT_REPO
    cd $PROJECT_DIR
fi

info "代码拉取完成"

# 5. 安装项目依赖
echo ""
info "[5/8] 安装项目依赖..."

npm install --production
info "依赖安装完成"

# 6. 启动服务并配置开机自启
echo ""
info "[6/8] 启动 Node.js 服务..."

# 删除旧服务（如果存在）
pm2 delete $PROJECT_NAME 2>/dev/null || true

# 启动新服务
pm2 start server.js --name $PROJECT_NAME

# 保存 PM2 配置
pm2 save

# 设置开机自启
if ! systemctl is-active --quiet pm2-root 2>/dev/null; then
    pm2 startup systemd -u root --hp /root
    systemctl enable pm2-root
    info "PM2 开机自启已配置"
else
    warn "PM2 开机自启已配置"
fi

info "服务启动完成"

# 7. 配置 Nginx 反向代理
echo ""
info "[7/8] 配置 Nginx 反向代理..."

cat > /etc/nginx/conf.d/fundscope.conf << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# 测试 Nginx 配置
if nginx -t; then
    systemctl restart nginx
    systemctl enable nginx
    info "Nginx 配置完成"
else
    error "Nginx 配置错误，请检查"
    exit 1
fi

# 8. 配置防火墙
echo ""
info "[8/8] 配置防火墙..."

# 检查 firewalld 是否运行
if systemctl is-active --quiet firewalld 2>/dev/null; then
    firewall-cmd --permanent --add-service=http 2>/dev/null || true
    firewall-cmd --permanent --add-service=https 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    info "防火墙配置完成"
else
    warn "firewalld 未运行，跳过防火墙配置"
    warn "请确保阿里云安全组已开放 80/443 端口"
fi

# 验证部署
echo ""
echo "=========================================="
info "部署完成！正在验证..."
echo "=========================================="

# 等待服务启动
sleep 2

# 验证 PM2 状态
echo ""
info "PM2 服务状态："
pm2 status | grep $PROJECT_NAME

# 验证本地服务
echo ""
info "本地服务测试 (localhost:$PORT)："
LOCAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT || echo "000")
if [ "$LOCAL_STATUS" = "200" ]; then
    info "本地服务正常 (HTTP $LOCAL_STATUS)"
else
    warn "本地服务异常 (HTTP $LOCAL_STATUS)"
fi

# 验证 Nginx
echo ""
info "Nginx 反向代理测试："
NGINX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1 -H "Host: $DOMAIN" || echo "000")
if [ "$NGINX_STATUS" = "200" ]; then
    info "Nginx 代理正常 (HTTP $NGINX_STATUS)"
else
    warn "Nginx 代理异常 (HTTP $NGINX_STATUS)"
fi

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "📋 服务信息："
echo "  - 项目名称：$PROJECT_NAME"
echo "  - 项目路径：$PROJECT_DIR"
echo "  - 服务端口：$PORT"
echo "  - 访问域名：http://$DOMAIN"
echo "  - IP 访问：http://$(curl -s ifconfig.me 2>/dev/null || echo '服务器IP')"
echo ""
echo "🔧 常用命令："
echo "  - 查看状态：pm2 status"
echo "  - 查看日志：pm2 logs $PROJECT_NAME"
echo "  - 重启服务：pm2 restart $PROJECT_NAME"
echo "  - 停止服务：pm2 stop $PROJECT_NAME"
echo "  - 更新代码：cd $PROJECT_DIR && git pull && pm2 restart $PROJECT_NAME"
echo ""
echo "⚠️  注意事项："
echo "  1. 请确保阿里云安全组已开放 80 端口"
echo "  2. 域名访问需要完成 ICP 备案"
echo "  3. 如需 HTTPS，请运行 certbot 配置证书"
echo "=========================================="
