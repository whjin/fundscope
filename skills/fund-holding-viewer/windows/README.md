# Windows 远程部署工具

## 概述

本目录包含在 Windows 环境下远程部署到 Linux 服务器所需的工具和脚本。

## 工具列表

### plink.exe
PuTTY 命令行 SSH 客户端，用于远程执行命令。

**下载地址**：https://the.earth.li/~sgtatham/putty/latest/w64/plink.exe

### pscp.exe
PuTTY 命令行 SCP 客户端，用于文件传输。

**下载地址**：https://the.earth.li/~sgtatham/putty/latest/w64/pscp.exe

## 使用方法

### 1. 首次连接 - 保存主机密钥

```powershell
# 方法一：交互式确认（手动输入 y）
.\plink.exe root@47.107.183.204

# 方法二：使用主机密钥指纹（推荐，自动化脚本用）
.\plink.exe root@47.107.183.204 -hostkey "SHA256:xxxxxx"
```

### 2. 密码认证方式

#### 方式一：密码文件（推荐，避免明文密码）

```powershell
# 创建密码文件 password.txt
# 内容为密码（注意不要有多余空格和换行）

# 使用密码文件连接
.\plink.exe root@47.107.183.204 -pwfile password.txt -hostkey "SHA256:xxxxxx" "echo hello"
```

#### 方式二：命令行密码（不推荐，密码可见）

```powershell
.\plink.exe root@47.107.183.204 -pw "your_password" -hostkey "SHA256:xxxxxx" "echo hello"
```

### 3. 上传文件

```powershell
# 上传单个文件
.\pscp.exe -pwfile password.txt -hostkey "SHA256:xxxxxx" deploy.sh root@47.107.183.204:/root/

# 上传整个目录
.\pscp.exe -pwfile password.txt -hostkey "SHA256:xxxxxx" -r ./scripts root@47.107.183.204:/root/
```

### 4. 远程执行命令

```powershell
# 执行单条命令
.\plink.exe root@47.107.183.204 -pwfile password.txt -hostkey "SHA256:xxxxxx" "ls -la"

# 执行多条命令
.\plink.exe root@47.107.183.204 -pwfile password.txt -hostkey "SHA256:xxxxxx" "cd /www/fundscope && git pull && pm2 restart fund-server"

# 执行本地脚本（先上传再执行）
.\pscp.exe -pwfile password.txt -hostkey "SHA256:xxxxxx" deploy.sh root@47.107.183.204:/root/
.\plink.exe root@47.107.183.204 -pwfile password.txt -hostkey "SHA256:xxxxxx" "chmod +x /root/deploy.sh && bash /root/deploy.sh"
```

## 一键部署脚本示例

### deploy-to-server.ps1

```powershell
# 配置
$server = "root@47.107.183.204"
$passwordFile = "password.txt"
$hostkey = "SHA256:hwJ1y0vCFplAR6a2UD58vwmSSzPfDFpXDTmYZIcTdsU"
$scriptPath = "..\scripts\deploy.sh"
$remotePath = "/root/deploy.sh"

Write-Host "=== 基金持仓系统 - 远程部署 ===" -ForegroundColor Green

# 1. 上传部署脚本
Write-Host "[1/2] 上传部署脚本..." -ForegroundColor Yellow
.\pscp.exe -pwfile $passwordFile -hostkey $hostkey $scriptPath "${server}:${remotePath}"

if ($LASTEXITCODE -ne 0) {
    Write-Host "上传失败！" -ForegroundColor Red
    exit 1
}

# 2. 执行部署脚本
Write-Host "[2/2] 执行部署脚本..." -ForegroundColor Yellow
.\plink.exe $server -pwfile $passwordFile -hostkey $hostkey "chmod +x ${remotePath} && bash ${remotePath}"

if ($LASTEXITCODE -eq 0) {
    Write-Host "部署完成！" -ForegroundColor Green
} else {
    Write-Host "部署失败，请检查错误信息" -ForegroundColor Red
    exit 1
}
```

## 安全建议

1. **不要把密码写在脚本里** - 使用密码文件或 SSH 密钥
2. **密码文件加入 .gitignore** - 避免提交到版本控制
3. **优先使用 SSH 密钥认证** - 比密码更安全
4. **定期更换密码** - 保持服务器安全

## SSH 密钥配置（推荐）

### 生成密钥对

```powershell
# 在 Windows 上生成密钥
ssh-keygen -t ed25519 -C "your_email@example.com"

# 密钥位置：C:\Users\你的用户名\.ssh\id_ed25519
```

### 上传公钥到服务器

```powershell
# 方法一：手动添加
# 把 id_ed25519.pub 的内容添加到服务器的 ~/.ssh/authorized_keys

# 方法二：使用 ssh-copy-id（如果有 Git Bash 或 WSL）
ssh-copy-id root@47.107.183.204
```

### 使用密钥连接

```powershell
# 使用 plink + 私钥
.\plink.exe -i .\id_ed25519.ppk root@47.107.183.204 "echo hello"

# 注意：plink 使用 .ppk 格式的私钥
# 可以用 puttygen.exe 将 OpenSSH 格式转换为 .ppk 格式
```

## 常见问题

### Q: 提示 "Store key in cache? (y/n)"
A: 首次连接需要确认主机密钥。使用 `-hostkey` 参数指定指纹，或手动输入 y 保存。

### Q: 如何获取主机密钥指纹？
A: 首次连接时会显示，或使用以下命令：
```powershell
ssh-keyscan 47.107.183.204 | ssh-keygen -lf -
```

### Q: 中文乱码怎么办？
A: 确保服务器和本地编码一致，或使用 UTF-8 编码。

### Q: 执行命令后没有输出？
A: 检查命令是否正确，或添加 `-v` 参数查看详细调试信息。
