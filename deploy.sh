#!/bin/bash
# 观点复盘台 — 一键全栈部署到 252 服务器（前端 + 后端 + 依赖安装 + pm2 重启）
# 用法: ./deploy.sh
set -e

cd "$(dirname "$0")"

REMOTE_HOST="119.91.69.252"
REMOTE_USER="root"
REMOTE_PASS="Xjpdyx32."
REMOTE_DIR="/opt/mystock"
APP_NAME="mystock-api"
REMOTE_PORT="3002"
PUBLIC_BASE_PATH="/stock/"
PUBLIC_API_BASE="/stock"
SSHPASS="/opt/homebrew/bin/sshpass"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PreferredAuthentications=password -o PubkeyAuthentication=no"

# macOS 下 tar 不产生 ._ AppleDouble 文件
export COPYFILE_DISABLE=1

if [ ! -x "$SSHPASS" ]; then
    echo "❌ 未找到 sshpass：$SSHPASS"
    echo "   可先执行：brew install hudochenkov/sshpass/sshpass"
    exit 1
fi

echo "🏗️  构建前端..."
VITE_API_BASE="$PUBLIC_API_BASE" npm run build -- --base "$PUBLIC_BASE_PATH"

echo "📦 打包前端 dist/..."
tar czf /tmp/mystock-dist.tar.gz --exclude='._*' -C dist .

echo "📦 打包后端代码 + package 文件（不含 .env / node_modules / uploads / data）..."
tar czf /tmp/mystock-server.tar.gz --exclude='._*' \
    server package.json package-lock.json

echo "📤 上传到 252 服务器..."
$SSHPASS -p "$REMOTE_PASS" scp $SSH_OPTS \
    /tmp/mystock-dist.tar.gz /tmp/mystock-server.tar.gz \
    "$REMOTE_USER@$REMOTE_HOST:/tmp/"

echo "🔧 部署到 $REMOTE_DIR ..."
$SSHPASS -p "$REMOTE_PASS" ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "
    set -e

    mkdir -p $REMOTE_DIR/dist $REMOTE_DIR/server $REMOTE_DIR/uploads/videos $REMOTE_DIR/uploads/audio

    # —— 前端静态资源 ——
    rm -rf $REMOTE_DIR/dist/*
    tar xzf /tmp/mystock-dist.tar.gz -C $REMOTE_DIR/dist
    chown -R nginx:nginx $REMOTE_DIR/dist 2>/dev/null || true

    # —— 后端代码 + 依赖（备份旧版 server，绝不覆盖 .env / uploads / data）——
    if [ -d $REMOTE_DIR/server ]; then
        cp -a $REMOTE_DIR/server $REMOTE_DIR/server.bak.\$(date +%s) 2>/dev/null || true
    fi
    tar xzf /tmp/mystock-server.tar.gz -C $REMOTE_DIR
    cd $REMOTE_DIR
    npm install --omit=dev

    # —— 重启 pm2；如果进程不存在则创建 ——
    if pm2 describe $APP_NAME > /dev/null 2>&1; then
        PORT=$REMOTE_PORT pm2 restart $APP_NAME --update-env
    else
        PORT=$REMOTE_PORT pm2 start server/index.js --name $APP_NAME
    fi
    sleep 4

    # —— 健康检查：进程存活 + API 可访问 ——
    if curl -sf http://127.0.0.1:$REMOTE_PORT/api/health > /dev/null; then
        echo '   健康检查通过 ✅'
    else
        echo '   ❌ 健康检查失败，最近日志：'
        pm2 logs $APP_NAME --nostream --lines 30
        exit 1
    fi

    # 清理上传的压缩包
    rm -f /tmp/mystock-dist.tar.gz /tmp/mystock-server.tar.gz
"

echo "🧹 清理本地临时文件..."
rm -f /tmp/mystock-dist.tar.gz /tmp/mystock-server.tar.gz

echo ""
echo "✅ 部署完成！"
echo "   前端:  https://www.xyai.asia/stock/"
echo "   API:   https://www.xyai.asia/stock/api/health"
echo "   后端进程: pm2 $APP_NAME"
