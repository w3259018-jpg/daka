# 为一打卡项目记忆
## 项目名称说明
- 小程序名称：**为一自在**（不是"微易打卡"，weiyi = 为一，域名 weiyidaka.online）

## 杰哥工作习惯
- 改代码前必须先问，不能自作主张直接改
- 先分析原因，再给方案，不要上来就动手

## 域名与证书
- 域名：weiyidaka.online，DNS由DNSPod管理
- ICP备案：粤ICP备2026056836号，主体变更已通过（2026-06-10确认）
- SSL证书：腾讯云免费证书，Apache格式存放于 `D:/小程序/daka/weiyidaka.online_apache/`
  - 签名证书：weiyidaka.online.crt
  - 签名私钥：weiyidaka.online.key
  - 证书链：root_bundle.crt
- 微信云托管：自定义域名已绑定，HTTPS功能需上传证书开启

## 部署架构
- 后端：Node.js + 微信云托管
- 存储：腾讯云COS
- 数据库：MySQL
- 小程序请求域名配置：miniprogram/utils/config.js

## 后端部署状态（2026-06-10更新）
- 个人主体：已部署到微信云托管，https://weiyidaka.online 正常运行
- 企业主体：已部署到微信云托管，公网域名仅测试用（不可配置到小程序服务器域名）
- 小程序服务器域名只允许配置自定义域名 weiyidaka.online，不允许配置云托管默认域名
- 企业主体环境变量已配置完成，服务运行正常，API接口和MySQL连接均验证通过
- 企业主体MySQL：10.26.105.18:3306，用户root，数据库daka（手动创建，utf8mb4）
- 企业主体COS：7072-prod-d9gcnv7ps49120d4e-1441939426，ap-shanghai
- 杰哥不再想本地启动后端，测试时统一走云服务器
- weiyidaka.online 自定义域名待绑定到企业主体新服务，SSL证书需重新上传
- 企业小程序 request 合法域名待配置：https://weiyidaka.online

## 后端环境变量
- 代码读取变量名：MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE
- WX_APPID、WX_SECRET、JWT_SECRET
- STORAGE、STORAGE_DRIVER、COS_REGION、COS_BUCKET、COS_SECRET_ID、COS_SECRET_KEY
