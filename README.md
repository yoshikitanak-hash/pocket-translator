# 口袋翻译

个人使用的轻量翻译网页，支持 Gemini 官方 API、流式翻译、同语言修改、当前句子追问、语境解释、本地历史和词句收藏。

## 本地运行

在项目目录运行 `python -m http.server 8001 --bind 0.0.0.0`，浏览器打开 `http://localhost:8001/`。手机与电脑连接同一 Wi-Fi 后，使用电脑的局域网地址。

设置中输入自己的 Google API Key，再拉取并选择模型。不同协议、域名和端口的浏览器存储相互独立，因此原测试页保存的 Key 不会自动出现在新版。密钥只保存在当前浏览器，调用时直接发送 Google。导出文件不包含密钥。浏览器本地存储并非加密保险箱，请仅在可信设备使用。

## PWA

包含 manifest、应用图标和 Service Worker。部署到 HTTPS 后可在 iPhone Safari 添加到主屏幕。缓存只覆盖应用静态文件，不缓存 API 请求；模型翻译仍需联网。局域网 HTTP 仅用于测试，无法据此验证正式 PWA 安装和离线外壳。

## 验证

Node.js 运行 `npm test`，无第三方依赖。测试模拟网络，不使用真实密钥，也不代表翻译质量已经验收。

## 发布范围

仅发布 index.html、css、js、icons、manifest.webmanifest 和 sw.js。交接文件、对话记录、密钥、备份和本地测试资料不应上传。正式站点通过 GitHub Pages 托管，仅发布应用静态文件。
