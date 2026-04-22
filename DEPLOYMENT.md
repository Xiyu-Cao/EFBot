# 部署与更新文档

EFBot (Endaxis) 部署在 Ubuntu 24.04 服务器，纯静态站点，Nginx 托管 + Let's Encrypt HTTPS。

- 线上域名：https://endfieldbot.com
- 项目路径（服务器）：`/var/www/EFBot`
- Nginx 站点配置：`/etc/nginx/sites-available/endaxis`
- 一键部署脚本：`/var/www/EFBot/deploy.sh`

---

## 日常更新流程

### 本地提交代码

```bash
git add -A
git commit -m "xxx"
git push
```

### SSH 上服务器跑部署脚本

```bash
ssh 你的服务器
bash /var/www/EFBot/deploy.sh
```

脚本内容：

```bash
#!/bin/bash
set -e
cd /var/www/EFBot
git pull
cd apps/endaxis-web
npm ci
npm run build
echo "✅ Deployed at $(date)"
```

脚本会 `git pull` 最新代码 → `npm ci` → `npm run build`，构建产物直接覆盖 `dist/`，Nginx 下次请求就拿到新文件。**不需要重启 Nginx。**

> 构建过程几秒钟内 `dist/` 可能文件不一致，对个人项目完全可接受。

---

## 首次部署步骤（备忘，重装服务器时用）

### 1. 装环境

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 防火墙
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
```

### 2. 克隆 + 首次构建

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www

# 如果遇到 GnuTLS 错误，先跑：
# git config --global http.postBuffer 524288000
# git config --global http.version HTTP/1.1

git clone https://github.com/Xiyu-Cao/EFBot.git
cd EFBot/apps/endaxis-web
npm ci
npm run build
```

### 3. 配 Nginx

`/etc/nginx/sites-available/endaxis`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name endfieldbot.com www.endfieldbot.com;

    root /var/www/EFBot/apps/endaxis-web/dist;
    index index.html;

    # SPA fallback，避免深链刷新 404
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 构建产物带 hash，长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/endaxis /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 4. HTTPS（DNS 生效后）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d endfieldbot.com -d www.endfieldbot.com
```

选项：邮箱 → 同意条款 → 重定向选 **2**（强制跳 HTTPS）。

证书 90 天自动续期，验证：

```bash
sudo systemctl status certbot.timer
```

---

## 排查

### `git clone` / `git pull` 报 `GnuTLS recv error`

```bash
git config --global http.postBuffer 524288000
git config --global http.version HTTP/1.1
```

还不行就用浅克隆 `git clone --depth=1 ...`，或换 SSH URL。

### `npm ci` 卡很久

正常的。首次装 ~700MB，`sharp` 要编译原生二进制，2-5 分钟正常。

判断是真卡还是在干活：另开窗口 `top`，有 `node`/`cc1` 吃 CPU 就是在工作。

国内服务器可换镜像加速：

```bash
npm config set registry https://registry.npmmirror.com
```

### 验证站点状态

```bash
# HTTPS 正常
curl -I https://endfieldbot.com            # 期望 200

# HTTP 自动跳 HTTPS
curl -I http://endfieldbot.com             # 期望 301 + Location: https://...

# Nginx 配置语法
sudo nginx -t

# 证书自动续期状态
sudo systemctl status certbot.timer        # 期望 active (waiting)
```

### Nginx 改了配置

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`reload` 不会中断服务，比 `restart` 安全。

### 查 Nginx 日志

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 回滚到上一个版本

如果某次部署后站点挂了：

```bash
cd /var/www/EFBot
git log --oneline -5              # 看最近几次提交，找上一个好的 SHA
git checkout <上个好的SHA>
cd apps/endaxis-web
npm ci && npm run build
```

修好后把 `master` 推一个修复 commit，再 `git checkout master && bash /var/www/EFBot/deploy.sh` 回到正轨。
