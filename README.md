# PDF Read

Chrome 扩展 — PDF 阅读与标注工具，功能 的 PDF 编辑器。

## 功能

- 打开本地 PDF（文件选择 / 拖拽）
- 右键 PDF 链接 →「用 PDF Read 打开」
- 工具：拖拽/选文字、自由画、直线、波浪线、双横线、文字、矩形、圆形、选择、撤销
- 缩放（按钮 / Ctrl+滚轮 / 双指捏合）、适应宽度、页码跳转
- 滚动 / 翻页两种预览模式
- 浅色 / 深色文档主题
- 标注颜色与粗细调节
- 保存（合并标注到 PDF）与导出

## 安装

```bash
npm install
npm run icons   # 首次需要生成扩展图标
```

## 本地预览（推荐开发时使用）

```bash
npm run dev
```

浏览器会自动打开阅读器页面（默认 `http://localhost:5173/src/viewer/index.html`）。支持热更新，改代码后页面会自动刷新。

- 点击工具栏按钮或拖拽本地 PDF 即可预览
- 也可通过 URL 参数加载远程 PDF：`?url=https://example.com/file.pdf`（受目标站点 CORS 限制）

## 构建 Chrome 扩展

```bash
npm run build   # 构建到 dist/
```

扩展开发时可使用监听模式，改代码后需在 `chrome://extensions/` 刷新扩展：

```bash
npm run dev:ext
```

## 加载扩展

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目的 `dist` 目录

## 使用

安装扩展后，**浏览器打开 PDF 链接会自动进入 PDF Read 阅读/标注界面**，无需手动上传。

- 直接访问 `.pdf` 链接（http / https）
- 本地 `file://` PDF（需在扩展详情页开启「允许访问文件网址」）
- 点击工具栏图标可打开空白阅读器
- 在 PDF 链接上右键 →「用 PDF Read 打开」
- 将 PDF 文件拖入阅读区域

### 首次使用建议

1. 打开 `chrome://settings/content/pdfDocuments`
2. 关闭「在 Chrome 中打开 PDF 文件」（改为下载或直接交给扩展拦截）
3. 若需打开本地 PDF：扩展管理页 → PDF Read → 开启「允许访问文件网址」
4. 重新 `npm run build` 后在 `chrome://extensions/` 刷新扩展

## 技术栈

- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF 渲染
- [Fabric.js](https://fabricjs.com/) — 画布标注
- [pdf-lib](https://pdf-lib.js.org/) — PDF 导出合并
- Vite — 构建打包
