#!/usr/bin/env bash

set -euo pipefail

# 切换到脚本所在目录（双击 .command 运行的核心：保证 CWD 为仓库根目录）
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "${SCRIPT_DIR}"

# 启动清屏：覆盖 Terminal 自动打印的命令路径 + shell 提示符（仅在交互终端生效）
if [ -t 1 ]; then
    clear
fi

# ========== 颜色定义 ==========
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ========== 配置 ==========
COMMIT_FILE="Commit.md"
DEFAULT_MESSAGE="提交更新"
TIME_THRESHOLD=600  # 10分钟超时（秒）

# ========== 兼容 Mac(BSD) / Linux(GNU) 的 date 时间戳转换 ==========
to_timestamp() {
    local ts="$1"
    # GNU date (Linux, Git Bash)
    date -d "$ts" +%s 2>/dev/null && return
    # BSD date (macOS native Terminal)
    date -j -f "%Y-%m-%d %H:%M:%S" "$ts" +%s 2>/dev/null && return
    echo ""
}

# ========== 1. 读取 Commit.md 提交备注 ==========
if [ ! -f "${COMMIT_FILE}" ]; then
    touch "${COMMIT_FILE}"
fi

# 过滤空行取第一行有效内容
latest_commit_line=$(sed '/^[[:space:]]*$/d' "${COMMIT_FILE}" | head -n 1)

# 严格提取 "YYYY-MM-DD HH:MM:SS" 时间戳前缀
commit_timestamp_str=$(echo "$latest_commit_line" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' || true)

if [[ -n "${commit_timestamp_str}" ]]; then
    # 有时间戳，剥离时间戳提取提交消息（去首尾空白）
    latest_commit=$(echo "$latest_commit_line" | sed "s/^${commit_timestamp_str}//" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
else
    # 无时间戳，整行视为提交消息
    latest_commit="${latest_commit_line}"
fi

# ========== 2. 时间戳比对：超过 TIME_THRESHOLD 则清空消息 ==========
if [[ -n "${commit_timestamp_str}" ]]; then
    commit_ts=$(to_timestamp "${commit_timestamp_str}")
    if [[ -n "${commit_ts}" ]]; then
        current_ts=$(date +%s)
        time_diff=$(( current_ts - commit_ts ))
        time_diff=${time_diff#-}  # 取绝对值

        if [[ ${time_diff} -gt ${TIME_THRESHOLD} ]]; then
            warn "Commit.md 记录已超过 ${TIME_THRESHOLD}s，使用默认提交信息"
            latest_commit=""
        fi
    fi
fi

# 兜底默认提交文案
if [[ -z "${latest_commit}" ]]; then
    latest_commit="${DEFAULT_MESSAGE}"
fi
info "提交信息：${latest_commit}"

# ========== 3. Git 校验与提交推送 ==========
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    error "当前目录不是 Git 仓库！脚本目录：${SCRIPT_DIR}"
    exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "当前分支：${BRANCH}"

# 拉取远程更新（静默，屏蔽 Already up to date / 进度条等输出）
info "拉取远程更新..."
git pull --quiet origin "${BRANCH}" 2>/dev/null || warn "pull 失败，跳过拉取直接提交"

git add -A

# 检查是否有暂存的变更（避免空 commit 报错）
if ! git diff --cached --quiet; then
    CHANGED=$(git diff --cached --stat | tail -n 1)
    info "变更概况：${CHANGED}"

    git commit --quiet -m "${latest_commit}"
    info "推送到远程仓库..."
    git push --quiet origin "${BRANCH}"
    info "提交并推送成功！"
else
    info "无需要提交的文件变更"
fi

# ========== 4. 按任意键关闭（兼容 Mac Terminal 自动关闭） ==========
if [ -t 0 ]; then
    echo -e "\n${YELLOW}按任意键关闭窗口...（3 秒后自动关闭）${NC}"
    read -n 1 -s -t 3 any_key || true
fi

# ========== 5. 只关闭当前脚本所在的终端窗口 ==========
# 通过当前会话的 tty（如 /dev/ttys004）精确匹配窗口并关闭。
# 不要再用 "close front window"——在多窗口下它会关闭"当前最前"的窗口，
# 一旦焦点在用户原来的终端上，就会把原来的终端一起误关掉。
MY_TTY=$(tty 2>/dev/null || true)

if [[ -n "${MY_TTY}" && -e "${MY_TTY}" ]]; then
    if [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
        # Apple 终端：遍历所有窗口/标签，只关闭 tty 匹配到的那一个窗口
        osascript - "${MY_TTY}" 2>/dev/null <<'APPLESCRIPT' || true
on run argv
    set targetTty to item 1 of argv
    tell application "Terminal"
        set foundWin to false
        repeat with w in windows
            repeat with t in tabs of w
                try
                    if (tty of t) is targetTty then
                        close w
                        set foundWin to true
                        exit repeat
                    end if
                end try
            end repeat
            if foundWin then exit repeat
        end repeat
    end tell
end run
APPLESCRIPT
    elif [[ "${TERM_PROGRAM:-}" == "iTerm2" ]]; then
        # iTerm2：遍历所有窗口/标签/会话，只关闭 tty 匹配到的那一个窗口
        osascript - "${MY_TTY}" 2>/dev/null <<'APPLESCRIPT' || true
on run argv
    set targetTty to item 1 of argv
    tell application "iTerm2"
        set foundWin to false
        repeat with w in windows
            repeat with t in tabs of w
                repeat with s in sessions of t
                    try
                        if (tty of s) is targetTty then
                            close w
                            set foundWin to true
                            exit repeat
                        end if
                    end try
                end repeat
                if foundWin then exit repeat
            end repeat
            if foundWin then exit repeat
        end repeat
    end tell
end run
APPLESCRIPT
    fi
fi

exit 0
