# 口袋翻译

在线使用：https://yoshikitanak-hash.github.io/pocket-translator/

iPhone 使用 Safari 打开在线地址，点击分享，再选择添加到主屏幕。首次使用在设置中输入自己的 Key。在线站点与本地测试页存储独立，需要重新输入 Key；历史仍保留在原测试页。

个人使用的轻量翻译网页，支持 Gemini、OpenAI、Anthropic、DeepSeek 官方 API 以及 OpenRouter 聚合接口，提供流式翻译、同语言修改、当前句子追问、语境解释、本地历史和词句收藏。

## 本地运行

在项目目录运行 `python -m http.server 8001 --bind 0.0.0.0`，浏览器打开 `http://localhost:8001/`。手机与电脑连接同一 Wi-Fi 后，使用电脑的局域网地址。

设置中输入自己的 Google API Key，再拉取并选择模型。不同协议、域名和端口的浏览器存储相互独立，因此原测试页保存的 Key 不会自动出现在新版。密钥只保存在当前浏览器，调用时直接发送 Google。导出文件不包含密钥。浏览器本地存储并非加密保险箱，请仅在可信设备使用。

## PWA

包含 manifest、应用图标和 Service Worker。部署到 HTTPS 后可在 iPhone Safari 添加到主屏幕。缓存只覆盖应用静态文件，不缓存 API 请求；模型翻译仍需联网。局域网 HTTP 仅用于测试，无法据此验证正式 PWA 安装和离线外壳。

## 验证

本机开发副本包含模拟网络的自动检查，覆盖停止、历史恢复、流式解析及 PWA 资源。测试文件未随公开站点发布。检查通过不代表全部语言的翻译质量均已验收。

## 发布范围

仅发布 index.html、css、js、icons、manifest.webmanifest 和 sw.js。交接文件、对话记录、密钥、备份和本地测试资料不应上传。正式站点通过 GitHub Pages 托管，仅发布应用静态文件。

## 供应商状态

设置中选择供应商，各自保存 Key 与上次使用的模型。模型可以拉取，也可以手动填写准确 ID。拉取列表不保证其中每个模型均可用于当前文字接口。

Gemini 已有用户 iPhone 真实调用验证。OpenAI 使用 Responses API，Anthropic 使用 Messages API，DeepSeek 与 OpenRouter 使用 Chat Completions API。新增供应商已通过模拟请求和流式协议检查，尚未完成真实 Key 与 iPhone 验证。浏览器直连可能受跨域、网络、地区及模型权限限制；不会静默切换到第三方中转。OpenRouter 本身是明确标注的聚合服务。

新增 Moonshot/Kimi 国内、国际接口及 Z.ai 国际、智谱 BigModel 国内常规 API 接口，各入口独立保存 Key。无需借助 OpenRouter。新增入口尚待真实 Key 与手机跨域实测；不使用 Coding Plan 专用接口。模型列表提供完整下拉选择，新增供应商不再自动指定第一个模型。

2026-10-18 用户反馈 Z.ai 和智谱国内直连翻译失败。同一网页 Origin 的无密钥 OPTIONS 检查中，两家模型列表预检含跨域允许头，chat/completions 的 POST 预检缺少允许头；DeepSeek 对照正常。网页直连存在限制，模型拉取成功不等同翻译成功。不自动绕过，不部署公共中转；GLM 保留官方 Z.ai / 智谱路线，后续考虑用户控制的后端连接官方 API，不要求使用 OpenRouter。

后续排查发现，Z.ai 与智谱的 chat/completions 地址末尾添加斜线后，POST 预检返回正确跨域头。v1.1.4 已使用此路径，并用无效测试 Key 验证可返回带跨域头的 401；有效 Key 真实翻译尚待验证。此前不能直连的结论仅适用于未带末尾斜线的预检路径。
