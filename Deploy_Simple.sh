#!/usr/bin/env bash
#
# FundScope 简易部署脚本（服务器已初始化后使用）
# 使用方式: sudo bash Deploy_Simple.sh
#
set -euo pipefail

APP_NAME="fund-server"
DEPLOY_DIR="/root/fundscope"
BRANCH="main"

# ========== 颜色定义 ==========
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

cd "${DEPLOY_DIR}"

# ========== 处理未提交变更 ==========
if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "检测到未提交的本地变更，自动暂存..."
    git stash
fi

# 切回主分支（防止 detached HEAD）
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${CURRENT_BRANCH}" != "${BRANCH}" ]]; then
    warn "当前分支: ${CURRENT_BRANCH}，切换到 ${BRANCH}..."
    git checkout "${BRANCH}"
fi

# ========== 拉取代码 ==========
info "拉取远程更新..."
git pull origin "${BRANCH}"
info "当前版本: $(git log --oneline -1)"

# ========== 安装依赖 ==========
if git diff HEAD~1 --name-only | grep -q '^package\.json$'; then
    info "package.json 有变更，安装依赖..."
    npm install --production
else
    info "package.json 无变更，跳过依赖安装"
fi

# ========== 重启服务 ==========
info "重启 ${APP_NAME}..."
pm2 restart "${APP_NAME}" --update-env
pm2 save

# ========== 健康检查 ==========
sleep 2
if curl -sf http://127.0.0.1:3000/api/funds/config | grep -q '"success":true'; then
    info "服务健康检查通过 ✅"
else
    error "服务未就绪，查看日志: pm2 logs ${APP_NAME} --lines 30"
    exit 1
fi

info "部署完成 ✅"
