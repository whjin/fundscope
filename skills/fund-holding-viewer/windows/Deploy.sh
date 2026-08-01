#!/bin/bash
# ==============================================
# 基金持仓展示系统 - 阿里云一键部署脚本
# 操作系统：Alibaba Cloud Linux 3
# ==============================================

set -e

echo "=========================================="
echo "  基金持仓展示系统 - 开始部署"
echo "=========================================="

# 1. 更新系统
echo ""
echo "[1/8] 更新系统软件包..."
dnf update -y

# 2. 安装基础软件
echo ""
echo "[2/8] 安装 Node.js、Git、Nginx..."
dnf install -y nodejs npm git nginx

# 验证安装
node -v
npm -v
git --version
nginx -v

# 3. 安装 PM2 进程管理器
echo ""
echo "[3/8] 安装 PM2 进程管理器..."
npm install pm2 -g
pm2 -v

# 4. 拉取项目代码
echo ""
echo "[4/8] 拉取项目代码..."
cd /www
if [ -d "fundscope" ]; then
    echo "项目已存在，更新代码..."
    cd fundscope
    git pull
else
    mkdir -p /www
    cd /www
    git clone https://gitclone.com/github.com/whjin/fundscope.git
    cd fundscope
fi

# 5. 安装项目依赖
echo ""
echo "[5/8] 安装项目依赖..."
npm install --production

# 6. 启动服务并配置开机自启
echo ""
echo "[6/8] 启动 Node.js 服务..."
pm2 delete fund-server 2>/dev/null || true
pm2 start server.js --name fund-server
pm2 save
pm2 startup systemd -u root --hp /root

# 7. 配置 Nginx 反向代理
echo ""
echo "[7/8] 配置 Nginx 反向代理..."

cat > /etc/nginx/conf.d/fundscope.conf << 'EOF'
server {
    listen 80;
    server_name fundscope.wuhuajin.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# 测试 Nginx 配置
nginx -t

# 重启 Nginx
systemctl restart nginx
systemctl enable nginx

# 8. 配置防火墙
echo ""
echo "[8/8] 配置防火墙..."
firewall-cmd --permanent --add-service=http 2>/dev/null || true
firewall-cmd --permanent --add-service=https 2>/dev/null || true
firewall-cmd --reload 2>/dev/null || true

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "服务信息："
echo "  - 网站地址：http://fundscope.wuhuajin.com"
echo "  - 服务端口：3000"
echo "  - 项目路径：/www/fundscope"
echo ""
echo "常用命令："
echo "  - 查看服务状态：pm2 status"
echo "  - 查看日志：pm2 logs fund-server"
echo "  - 重启服务：pm2 restart fund-server"
echo "  - 停止服务：pm2 stop fund-server"
echo ""
echo "注意：请确保阿里云安全组已开放 80 端口"
echo "=========================================="
