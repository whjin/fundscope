#!/bin/bash
# ==============================================
# 基金持仓展示系统 - 代码更新脚本
# 使用方法：bash update.sh
# ==============================================

set -e

# 配置
PROJECT_NAME="fund-server"
PROJECT_DIR="/www/fundscope"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=========================================="
echo "  基金持仓系统 - 代码更新"
echo "=========================================="
echo ""

# 1. 检查项目目录
info "[1/4] 检查项目目录..."
if [ ! -d "$PROJECT_DIR" ]; then
    error "项目目录不存在: $PROJECT_DIR"
    exit 1
fi
cd $PROJECT_DIR
info "项目目录: $PROJECT_DIR"

# 2. 查看当前版本
echo ""
info "[2/4] 当前版本信息："
git log --oneline -3
echo ""

# 3. 拉取最新代码
info "[3/4] 拉取最新代码..."
git pull

# 检查是否有更新
if git diff --quiet HEAD@{1} HEAD 2>/dev/null; then
    warn "代码已是最新版本，无需更新"
    echo ""
    echo "=========================================="
    info "更新完成（无变更）"
    echo "=========================================="
    exit 0
fi

info "代码已更新"

# 4. 安装依赖并重启服务
echo ""
info "[4/4] 安装依赖并重启服务..."

# 检查 package.json 是否变更
if git diff HEAD@{1} HEAD --name-only | grep -q "package.json"; then
    info "package.json 有变更，重新安装依赖..."
    npm install --production
else
    info "package.json 无变更，跳过依赖安装"
fi

# 重启服务
info "重启服务..."
pm2 restart $PROJECT_NAME

# 等待服务启动
sleep 2

# 验证服务状态
echo ""
echo "=========================================="
info "更新完成！验证服务状态..."
echo "=========================================="
echo ""

# 检查 PM2 状态
pm2 status | grep $PROJECT_NAME

# 测试服务
echo ""
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
    info "服务运行正常 (HTTP $STATUS)"
else
    warn "服务状态异常 (HTTP $STATUS)，请检查日志"
    echo ""
    pm2 logs $PROJECT_NAME --lines 20 --nostream
fi

echo ""
echo "📝 常用命令："
echo "  - 查看日志: pm2 logs $PROJECT_NAME"
echo "  - 回滚版本: cd $PROJECT_DIR && git checkout <commit> && pm2 restart $PROJECT_NAME"
echo "  - 查看历史: git log --oneline -10"
echo "=========================================="
