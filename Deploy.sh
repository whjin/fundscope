#!/usr/bin/env bash

# ==============================================
# FundScope 一键提交部署脚本
# 兼容：macOS Terminal (zsh/bash) / Git Bash / Linux
# 用法：
#   1. 在 Commit.md 第一行写入提交信息（格式：YYYY-MM-DD HH:MM:SS 提交内容）
#   2. 运行 bash Deploy.sh
# ==============================================

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

COMMIT_FILE="Commit.md"
DEFAULT_MESSAGE="提交更新"
TIME_THRESHOLD=600  # 10分钟内的 Commit.md 记录视为有效

# ==============================================
# 1. 平台检测：兼容 macOS(BSD) 和 Linux/Git Bash(GNU) 的 date 命令
# ==============================================
to_timestamp() {
    local ts="$1"
    # 尝试 GNU date (Linux / Git Bash)
    date -d "$ts" +%s 2>/dev/null && return
    # 尝试 BSD date (macOS)
    date -j -f "%Y-%m-%d %H:%M:%S" "$ts" +%s 2>/dev/null && return
    echo ""
}

# ==============================================
# 2. 读取 Commit.md 提取提交信息
# ==============================================
if [ ! -f "$COMMIT_FILE" ]; then
    touch "$COMMIT_FILE"
fi

# 取第一行非空内容
latest_commit_line=$(sed '/^[[:space:]]*$/d' "$COMMIT_FILE" | head -n 1)

# 提取时间戳（YYYY-MM-DD HH:MM:SS）
commit_timestamp_str=$(echo "$latest_commit_line" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}')

# 提取提交消息（去掉时间戳前缀）
if [ -n "$commit_timestamp_str" ]; then
    latest_commit=$(echo "$latest_commit_line" | sed "s/^$commit_timestamp_str//" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
else
    latest_commit="$latest_commit_line"
fi

# 时间戳超时检查：超过阈值则用默认消息
if [ -n "$commit_timestamp_str" ]; then
    commit_ts=$(to_timestamp "$commit_timestamp_str")
    if [ -n "$commit_ts" ]; then
        current_ts=$(date +%s)
        time_diff=$(( current_ts - commit_ts ))
        time_diff=${time_diff#-}  # 取绝对值
        if [ "$time_diff" -gt "$TIME_THRESHOLD" ]; then
            warn "Commit.md 记录已超过 ${TIME_THRESHOLD}s，使用默认提交信息"
            latest_commit=""
        fi
    fi
fi

# 如果 Commit.md 为空或超时，使用默认消息
if [ -z "$latest_commit" ]; then
    latest_commit="$DEFAULT_MESSAGE"
fi

info "提交信息：$latest_commit"

# ==============================================
# 3. Git 操作
# ==============================================
# 检查是否在 git 仓库中
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    error "当前目录不是 Git 仓库"
    exit 1
fi

# 获取当前分支
BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "当前分支：$BRANCH"

# 拉取远程更新（允许失败，可能是首次推送无远程分支）
info "拉取远程更新..."
git pull origin "$BRANCH" 2>/dev/null || warn "git pull 失败（可能是首次推送或无远程分支），继续提交..."

# 暂存所有变更
info "暂存文件..."
git add -A

# 检查是否有变更需要提交
if git diff --cached --quiet; then
    info "没有需要提交的变更"
    exit 0
fi

# 显示变更概况
CHANGED=$(git diff --cached --stat | tail -n 1)
info "变更概况：$CHANGED"

# 提交
info "提交代码..."
git commit -m "$latest_commit"

# 推送
info "推送到远程仓库..."
git push origin "$BRANCH"

# ==============================================
# 4. 完成
# ==============================================
info "提交并推送成功！"
echo ""
git log --oneline -3
echo ""

# 交互式终端等待按键（非交互环境跳过）
if [ -t 0 ]; then
    echo ""
    read -rp "按回车键退出..."
fi

exit 0
