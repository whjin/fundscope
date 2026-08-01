#!/bin/bash
# ==============================================
# 基金持仓展示系统 - 一键诊断脚本
# 使用方法：bash diagnose.sh
# ==============================================

# 配置
PROJECT_NAME="fund-server"
PROJECT_DIR="/www/fundscope"
PORT=3000
DOMAIN="fundscope.wuhuajin.com"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC} - $1"
}

fail() {
    echo -e "${RED}✗ FAIL${NC} - $1"
}

warn() {
    echo -e "${YELLOW}⚠ WARN${NC} - $1"
}

info() {
    echo -e "${BLUE}ℹ INFO${NC} - $1"
}

echo "=========================================="
echo "  基金持仓系统 - 健康诊断"
echo "=========================================="
echo ""

# 1. 系统信息
echo "【1/8】系统信息"
echo "----------------------------------------"
info "操作系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
info "内核版本: $(uname -r)"
info "服务器时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 2. 软件环境检查
echo "【2/8】软件环境检查"
echo "----------------------------------------"

if command -v node &> /dev/null; then
    pass "Node.js: $(node -v)"
else
    fail "Node.js 未安装"
fi

if command -v npm &> /dev/null; then
    pass "npm: $(npm -v)"
else
    fail "npm 未安装"
fi

if command -v git &> /dev/null; then
    pass "Git: $(git --version)"
else
    fail "Git 未安装"
fi

if command -v nginx &> /dev/null; then
    pass "Nginx: $(nginx -v 2>&1)"
else
    fail "Nginx 未安装"
fi

if command -v pm2 &> /dev/null; then
    pass "PM2: $(pm2 -v)"
else
    fail "PM2 未安装"
fi

echo ""

# 3. PM2 服务状态
echo "【3/8】PM2 服务状态"
echo "----------------------------------------"

if pm2 list | grep -q $PROJECT_NAME; then
    STATUS=$(pm2 list | grep $PROJECT_NAME | awk '{print $10}')
    PID=$(pm2 list | grep $PROJECT_NAME | awk '{print $8}')
    UPTIME=$(pm2 list | grep $PROJECT_NAME | awk '{print $9}')
    
    if [ "$STATUS" = "online" ]; then
        pass "服务状态: $STATUS"
        info "进程 PID: $PID"
        info "运行时间: $UPTIME"
    else
        fail "服务状态: $STATUS"
    fi
    
    # 重启次数
    RESTARTS=$(pm2 list | grep $PROJECT_NAME | awk '{print $11}')
    if [ "$RESTARTS" = "0" ]; then
        pass "重启次数: $RESTARTS"
    else
        warn "重启次数: $RESTARTS (可能有异常崩溃)"
    fi
else
    fail "服务 $PROJECT_NAME 不存在"
fi

echo ""

# 4. 端口监听检查
echo "【4/8】端口监听检查"
echo "----------------------------------------"

if ss -tlnp | grep -q ":$PORT "; then
    pass "端口 $PORT 正在监听"
    ss -tlnp | grep ":$PORT " | head -1
else
    fail "端口 $PORT 未监听"
fi

if ss -tlnp | grep -q ":80 "; then
    pass "端口 80 正在监听 (Nginx HTTP)"
else
    fail "端口 80 未监听"
fi

if ss -tlnp | grep -q ":443 "; then
    pass "端口 443 正在监听 (Nginx HTTPS)"
else
    warn "端口 443 未监听 (HTTPS 未配置)"
fi

echo ""

# 5. 本地服务测试
echo "【5/8】本地服务测试"
echo "----------------------------------------"

# 测试 Node.js 服务
NODE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:$PORT 2>/dev/null || echo "000")
if [ "$NODE_STATUS" = "200" ]; then
    pass "Node.js 服务 (localhost:$PORT) - HTTP $NODE_STATUS"
else
    fail "Node.js 服务 (localhost:$PORT) - HTTP $NODE_STATUS"
fi

# 测试 API 接口
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:$PORT/api/funds/config 2>/dev/null || echo "000")
if [ "$API_STATUS" = "200" ]; then
    pass "API 接口 (/api/funds/config) - HTTP $API_STATUS"
else
    fail "API 接口 (/api/funds/config) - HTTP $API_STATUS"
fi

# 测试 Nginx 代理
NGINX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 -H "Host: $DOMAIN" http://127.0.0.1 2>/dev/null || echo "000")
if [ "$NGINX_STATUS" = "200" ]; then
    pass "Nginx 反向代理 - HTTP $NGINX_STATUS"
else
    fail "Nginx 反向代理 - HTTP $NGINX_STATUS"
fi

echo ""

# 6. Nginx 配置检查
echo "【6/8】Nginx 配置检查"
echo "----------------------------------------"

if nginx -t 2>&1 | grep -q "test is successful"; then
    pass "Nginx 配置语法正确"
else
    fail "Nginx 配置语法错误"
    nginx -t 2>&1
fi

# 检查配置文件
if [ -f "/etc/nginx/conf.d/fundscope.conf" ]; then
    pass "Nginx 配置文件存在"
else
    fail "Nginx 配置文件不存在"
fi

# 检查 Nginx 运行状态
if systemctl is-active --quiet nginx; then
    pass "Nginx 服务运行中"
else
    fail "Nginx 服务未运行"
fi

echo ""

# 7. 资源使用情况
echo "【7/8】资源使用情况"
echo "----------------------------------------"

# 内存使用
MEM_TOTAL=$(free -m | awk '/Mem:/ {print $2}')
MEM_USED=$(free -m | awk '/Mem:/ {print $3}')
MEM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))
info "内存使用: ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_PERCENT}%)"

# CPU 负载
LOAD_AVG=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
info "系统负载: $LOAD_AVG"

# 磁盘使用
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}')
DISK_USED=$(df -h / | awk 'NR==2 {print $3}')
DISK_TOTAL=$(df -h / | awk 'NR==2 {print $2}')
info "磁盘使用: ${DISK_USED} / ${DISK_TOTAL} (${DISK_USAGE})"

# PM2 进程内存
if pm2 list | grep -q $PROJECT_NAME; then
    PROC_MEM=$(pm2 list | grep $PROJECT_NAME | awk '{print $13}')
    PROC_CPU=$(pm2 list | grep $PROJECT_NAME | awk '{print $12}')
    info "进程内存: $PROC_MEM"
    info "进程 CPU: $PROC_CPU"
fi

echo ""

# 8. 日志检查
echo "【8/8】日志检查 (最近 10 条错误)"
echo "----------------------------------------"

# PM2 错误日志
if [ -f "/root/.pm2/logs/${PROJECT_NAME}-error.log" ]; then
    ERROR_COUNT=$(wc -l < "/root/.pm2/logs/${PROJECT_NAME}-error.log")
    if [ "$ERROR_COUNT" = "0" ]; then
        pass "PM2 错误日志为空"
    else
        warn "PM2 错误日志有 $ERROR_COUNT 行"
        echo ""
        tail -10 "/root/.pm2/logs/${PROJECT_NAME}-error.log"
    fi
else
    warn "PM2 错误日志文件不存在"
fi

echo ""

# 总结
echo "=========================================="
echo "  诊断完成"
echo "=========================================="
echo ""
echo "📝 快速操作命令："
echo "  - 查看实时日志: pm2 logs $PROJECT_NAME"
echo "  - 重启服务:     pm2 restart $PROJECT_NAME"
echo "  - 停止服务:     pm2 stop $PROJECT_NAME"
echo "  - 查看详情:     pm2 show $PROJECT_NAME"
echo "  - Nginx 日志:   tail -f /var/log/nginx/error.log"
echo ""
echo "🔧 常见问题排查："
echo "  - 502 错误: 检查 PM2 服务是否在线"
echo "  - 404 错误: 检查 Nginx 配置和 proxy_pass"
echo "  - 服务崩溃: 查看 PM2 错误日志"
echo "  - 性能问题: 检查内存和 CPU 使用情况"
echo "=========================================="
