# 口袋翻译

在线使用：https://yoshikitanak-hash.github.io/pocket-translator/

iPhone 使用 Safari 打开在线地址，点击分享，再选择添加到主屏幕。首次使用在设置中输入自己的 Key。在线站点与本地测试页存储独立，需要重新输入 Key；历史仍保留在原测试页。

个人使用的轻量翻译网页，支持 Gemini 官方 API、流式翻译、同语言修改、当前句子追问、语境解释、本地历史和词句收藏。

## 本地运行

在项目目录运行 `python -m http.server 8001 --bind 0.0.0.0`，浏览器打开 `http://localhost:8001/`。手机与电脑连接同一 Wi-Fi 后，使用电脑的局域网地址。

设置中输入自己的 Google API Key，再拉取并选择模型。不同协议、域名和端口的浏览器存储相互独立，因此原测试页保存的 Key 不会自动出现在新版。密钥只保存在当前浏览器，调用时直接发送 Google。导出文件不包含密钥。浏览器本地存储并非加密保险箱，请仅在可信设备使用。

## PWA

包含 manifest、应用图标和 Service Worker。部署到 HTTPS 后可在 iPhone Safari 添加到主屏幕。缓存只覆盖应用静态文件，不缓存 API 请求；模型翻译仍需联网。局域网 HTTP 仅用于测试，无法据此验证正式 PWA 安装和离线外壳。

## 验证

本机开发副本包含模拟网络的自动检查，覆盖停止、历史恢复、流式解析及 PWA 资源。测试文件未随公开站点发布。检查通过不代表全部语言的翻译质量均已验收。

## 发布范围

仅发布 index.html、css、js、icons、manifest.webmanifest 和 sw.js。交接文件、对话记录、密钥、备份和本地测试资料不应上传。正式站点通过 GitHub Pages 托管，仅发布应用静态文件。
