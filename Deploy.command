#!/usr/bin/env bash

set -euo pipefail

# 切换到脚本所在目录（双击.command运行核心）
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "${SCRIPT_DIR}"

# ========== 颜色定义 ==========
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

COMMIT_FILE="Commit.md"
DEFAULT_MESSAGE="提交更新"
TIME_THRESHOLD=600  # 10分钟超时

# ========== 兼容Mac/ Linux date时间戳函数 ==========
to_timestamp() {
    local ts="$1"
    date -d "$ts" +%s 2>/dev/null && return
    date -j -f "%Y-%m-%d %H:%M:%S" "$ts" +%s 2>/dev/null && return
    echo ""
}

# ========== 读取Commit.md提交备注 ==========
[ ! -f "${COMMIT_FILE}" ] && touch "${COMMIT_FILE}"

# 过滤空行取第一行有效内容
latest_commit_line=$(sed '/^[[:space:]]*$/d' "${COMMIT_FILE}" | head -n 1)

# 拆分时间和备注
commit_timestamp_str=$(echo "$latest_commit_line" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}')
if [[ -n "${commit_timestamp_str}" ]]; then
    latest_commit=$(echo "$latest_commit_line" | sed "s/^${commit_timestamp_str}//" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
else
    latest_commit="${latest_commit_line}"
fi

# 超时判断
if [[ -n "${commit_timestamp_str}" ]]; then
    commit_ts=$(to_timestamp "${commit_timestamp_str}")
    if [[ -n "${commit_ts}" ]]; then
        current_ts=$(date +%s)
        time_diff=$(( current_ts - commit_ts ))
        time_diff=${time_diff#-}
        if [[ ${time_diff} -gt ${TIME_THRESHOLD} ]]; then
            warn "Commit.md 记录已超过 ${TIME_THRESHOLD}s，使用默认提交信息"
            latest_commit=""
        fi
    fi
fi

# 兜底默认提交文案
[[ -z "${latest_commit}" ]] && latest_commit="${DEFAULT_MESSAGE}"
info "提交信息：${latest_commit}"

# ========== Git 提交推送逻辑 ==========
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    error "当前目录不是Git仓库！"
    exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "当前分支：${BRANCH}"

# 拉取远程
info "拉取远程更新..."
git pull origin "${BRANCH}" 2>/dev/null || warn "pull失败，跳过拉取直接提交"

git add -A
HAS_CHANGES=false

if ! git diff --cached --quiet; then
    HAS_CHANGES=true
    CHANGED=$(git diff --cached --stat | tail -n 1)
    info "变更概况：${CHANGED}"

    git commit -m "${latest_commit}"
    info "推送到远程仓库..."
    git push origin "${BRANCH}"
    info "提交并推送成功！"
    echo ""
    git log --oneline -3
    echo ""
else
    info "无需要提交的文件变更"
fi

# ==============================================
# 【核心修复块】1. 按任意按键继续，不再只限制回车
# 【核心修复块】2. 兼容Apple Terminal自动关闭
# ==============================================
if [ -t 0 ]; then
    echo -e "\n${YELLOW}按任意键关闭窗口...${NC}"
    # 读取单个字符，任意按键直接跳过，超时3秒自动关闭
    read -n 1 -s -t 3 any_key
fi

# 判断终端类型执行关闭
if [[ "${TERM_PROGRAM}" == "Apple_Terminal" ]]; then
    # AppleScript 静默关闭当前标签页，屏蔽报错
    osascript -e 'tell application "Terminal" to close front window' 2>/dev/null
elif [[ "${TERM_PROGRAM}" == "iTerm2" ]]; then
    osascript -e 'tell application "iTerm2" to close current window of front terminal' 2>/dev/null
fi

exit 0
