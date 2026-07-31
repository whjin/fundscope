# 部署流程

```bash
# 1. 更新系统包
dnf update -y

# 2. 安装环境：Node、Git、Nginx
dnf install nodejs npm git nginx -y

# 3. 全局安装pm2进程守护
npm install pm2 -g

# 4. 拉取GitHub上你的H5+Express项目
git clone https://github.com/你的账号/仓库名.git
cd 仓库文件夹

# 5. 安装依赖并后台启动
npm install
pm2 start server.js --name web-server

# 6. 设置开机自启
pm2 startup
pm2 save
```

```bash
# 清理失败文件夹
rm -rf fundscope
git clone https://gitclone.com/github.com/whjin/fundscope.git

cd fundscope
npm install
pm2 start server.js --name fund-server
pm2 startup && pm2 save
```
