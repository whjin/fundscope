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

# 生成 `HTTPS` 证书

```bash
certbot certonly --manual --preferred-challenges dns -d wuhuajin.com -d www.wuhuajin.com
# 每次生成的解析记录和 value 需要手动添加到 DNS 服务器，总共有两个

# 验证根域名TXT记录（替换成你自己的域名）
dig @8.8.8.8 -t TXT _acme-challenge.wuhuajin.com +short

# 验证www域名TXT记录
dig @8.8.8.8 -t TXT _acme-challenge.www.wuhuajin.com +short

# 完成以上校验后才能继续按回车执行后续证书生成
```

> 已经完成了域名备案，域名为wuhuajin.com，该域名已经用于个人博客，当前项目fundscope是github的演示项目，访问路径可以是fundscope.wuhuajin.com或wuhuajin.com/fundscope，如果需要选择，则优先采用wuhuajin.com/fundscope。当前项目fundscope已经部署到阿里云服务器，访问地址为。需求是对部署进行优化或重新部署，实现协议更换为https（如果可以，访问地址改为wuhuajin.com/fundscope），然后把部署成功后的步骤进行精简，生成skill保存在skills/fund-holding-viewer/SKILL.md中。
test_change_1786619604
test_change_1786619623
