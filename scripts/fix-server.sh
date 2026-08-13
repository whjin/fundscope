#!/bin/bash
# FundScope 服务器一键修复脚本
# 修复：git 镜像损坏导致代码无法拉取、app.js 缺少域名判断导致 CORS 错误
set -e

PROJECT_DIR="/root/fundscope"
FIXED=0

echo "=== FundScope 一键修复 ==="
echo ""

cd "$PROJECT_DIR" || { echo "[ERROR] 项目目录不存在: $PROJECT_DIR"; exit 1; }

# 方案1: 尝试修复 git remote 为官方源并拉取
echo "[1/4] 尝试修复 git remote 并拉取最新代码..."
git remote set-url origin https://github.com/whjin/fundscope.git 2>/dev/null
if git pull origin main 2>/dev/null; then
    echo "  ✅ git pull 成功"
    FIXED=1
else
    echo "  ⚠️  git pull 失败，改用直接修补文件"
fi

# 方案2: 如果 git 没拉下来，直接用 sed 修补关键文件
if [ "$FIXED" -eq 0 ]; then
    echo "[2/4] 直接修补 app.js (添加 wuhuajin.com 域名判断)..."

    # 检查是否已包含修复
    if grep -q "host.endsWith('.wuhuajin.com')" js/app.js 2>/dev/null; then
        echo "  ✅ app.js 已包含域名判断，跳过"
    else
        # 在 "localhost/127.0.0.1" 判断之后插入 wuhuajin.com 判断
        sed -i "/if (host === 'localhost' || host === '127.0.0.1') return false;/a\\
    // wuhuajin.com 主域及所有子域（如 fundscope.wuhuajin.com）均走后端模式\\
    if (host === 'wuhuajin.com' || host.endsWith('.wuhuajin.com')) return false;" js/app.js
        echo "  ✅ app.js 已修补"
    fi
fi

# 方案3: 强制更新缓存版本号
echo "[3/4] 更新 index.html 缓存版本号..."
sed -i 's/app.js?v=30/app.js?v=32/' index.html
# 如果已经是 31 或 32，再 bump一次确保生效
sed -i 's/app.js?v=31/app.js?v=32/' index.html
sed -i 's/app.js?v=32/app.js?v=33/' index.html
# 最终确定为 32
sed -i 's/app.js?v=33/app.js?v=32/' index.html
echo "  ✅ 缓存版本号已更新为 v32"

# 重启服务
echo "[4/4] 重启 PM2 服务..."
pm2 restart fund-server 2>/dev/null || pm2 start server.js --name fund-server
pm2 save

echo ""
echo "=== 验证 ==="
echo ""

# 验证 1: app.js 修复
echo "app.js 域名判断:"
grep -n "wuhuajin" js/app.js || echo "  ❌ 未找到"
echo ""

# 验证 2: PM2 状态
echo "PM2 状态:"
pm2 list | grep fund-server || echo "  ❌ 服务未运行"
echo ""

# 验证 3: 本地 API
echo "本地 API 测试:"
LOCAL_RESULT=$(curl -s http://127.0.0.1:3000/api/funds/config 2>/dev/null | head -c 200)
if echo "$LOCAL_RESULT" | grep -q "success"; then
    echo "  ✅ 本地 API 正常"
else
    echo "  ❌ 本地 API 异常: $LOCAL_RESULT"
fi
echo ""

# 验证 4: HTTPS API
echo "HTTPS API 测试:"
HTTPS_RESULT=$(curl -s https://fundscope.wuhuajin.com/api/funds/config 2>/dev/null | head -c 200)
if echo "$HTTPS_RESULT" | grep -q "success"; then
    echo "  ✅ HTTPS API 正常"
else
    echo "  ❌ HTTPS API 异常: $HTTPS_RESULT"
fi
echo ""

echo "=== 修复完成 ==="
echo "请在浏览器中打开 https://fundscope.wuhuajin.com/ 并按 Ctrl+Shift+R 强制刷新"
