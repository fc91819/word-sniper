# 单词狙击手

面向初三中考英语复习的单页背词游戏。玩家通过打靶选择、拼写和默写练习词义、拼写与例句。

## 运行

直接双击 `index.html`，或将它拖进浏览器。无需安装、构建或启动服务器。每个浏览器配置文件分别保存本机学习进度；如果浏览器禁用了 `localStorage`，仍然可以训练，但关闭页面后进度不会保留。

用 `?today=2026-11-05` 模拟日期，例如打开 `index.html?today=2026-11-05`。模拟日期会影响到期复习和连续打卡计算。

## 每日训练

- 先复习到期单词，最多 30 个；随后学习 12 个未学单词。
- box 0–1 为打靶选择；box 2–3 为装弹拼写，有首字母和字母数提示；box 4–5 为无提示默写。
- 答对后升级一个 box，间隔为 1、2、4、7、15 天；答错回到 box 1，次日到期，并在本局最后重出一次。
- 打靶误射扣生命；拼写错误记录错题并要求照抄，不扣生命。本局评价由命中率（75%）和剩余生命（25%）合成 A–D。
- box 3 起算已掌握。每道题会显示音标、例句和翻译；可点击例句播放朗读。
- 优先使用浏览器英文语音；没有英文语音时使用有道词典发音。

## 文件

- `index.html`：页面结构和三种界面（首页、训练、结算）。
- `style.css`：军事战术风格、手机竖屏布局、动画和减少动态效果适配。
- `game.js`：答题流程、射击效果、拼写键盘、连击、军衔和结算。
- `srs.js`：复习队列、box 调度、日期模拟、localStorage 读写和打卡天数。
- `words.js`：200 个中考常用词，挂载到全局变量 `WORDS`。
- `manifest.webmanifest`、`service-worker.js`、`icons/`：PWA 安装信息、离线缓存和应用图标。
- `tools/draw-icons.py`：用 Python 标准库重绘 PWA 图标。
- `DECISIONS.md`：技术和产品决策台账。
- `HANDOFF.md`：当前运行说明、文件职责和项目进度。

## 进度数据

进度仅保存在当前浏览器的 `localStorage`，不上传到服务器。更换浏览器或设备不会自动同步。复习日期按浏览器本地日期计算；`?today=` 可覆盖当天日期用于调试。

## 发布到 GitHub Pages

GitHub 账号准备好后，在项目根目录使用 GitHub CLI 登录并创建公开仓库、推送当前分支：

1. 运行 `gh auth login` 完成登录。
2. 运行 `gh repo create word-sniper --public --source=. --remote=origin --push` 创建公开仓库并推送。
3. 打开仓库的 **Settings → Pages**，将 **Build and deployment** 设为 **Deploy from a branch**，选择 `main` 分支和 `/(root)` 目录并保存。
4. 发布完成后网址为 `https://用户名.github.io/word-sniper/`，其中“用户名”替换成 GitHub 用户名。

页面资源、manifest 图标和 service worker 都使用相对项目路径；service worker 按注册作用域缓存资源，因此可部署在 `/word-sniper/` 子路径。首次联网打开后，页面会缓存离线所需文件；Safari 中可用“添加到主屏幕”安装。此说明是待执行步骤，本仓库当前尚未发布。
