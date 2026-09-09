# MicrowaveTech 看板：新账号手动部署

目标账号：`MicrowaveTech`。
目标仓库：`MicrowaveTech/MicrowaveTech.github.io`，公开仓库，分支 `main`。
部署后的看板地址：**https://microwavetech.github.io/quant/**。

当前仅完成本地部署包和聚宽上传配置切换，尚未创建远程仓库或替你发布。
这是新账号下的独立看板，不需要复制旧博客，也不需要自有服务器或公网 endpoint。

## 1. 用新账号创建仓库

1. 在 GitHub 切换或登录 **MicrowaveTech**，打开 https://github.com/new 。
2. Owner 选择 **MicrowaveTech**。
3. Repository name 填写 **MicrowaveTech.github.io**。
4. Visibility 选择 **Public**。
5. 勾选 **Add a README file** 后创建，让仓库有初始提交。
6. 确认默认分支为 **main**；本包的工作流和聚宽配置都使用 main。

如果该仓库已创建，直接使用它。此部署包按公开仓库准备。

## 2. 上传网站包

使用 `dist/github-pages-quant.zip`，或者本地 `deployment/github-pages/`。
解压后把 **quant 整个文件夹从仓库根目录上传**，不要先进入线上 quant 再拖入 quant，否则会变成 `quant/quant/`。
根目录应该是：

```text
MicrowaveTech.github.io/
├── README.md
├── quant/
│   ├── index.html
│   ├── app.js、config.js、styles.css、vendor/
│   ├── data/
│   └── _quant/
│       ├── build_static.py、parser.py、demo.py
│       ├── site/
│       ├── tests/
│       └── inbox/
└── .github/
    └── workflows/
        └── quant-pages.yml
```

除了 GitHub 要求固定位置的工作流入口，网站相关文件都集中在 quant 中。
不要上传 ZIP 本身，也不要上传外层 github-pages 或 deployment 文件夹。

`.github` 是隐藏目录。Mac Finder 按 Command + Shift + . 显示后，可把包内整个 `.github` 拖到仓库根目录的上传页面。
也可以在仓库根目录点击 **Add file → Create new file**，文件名填 `.github/workflows/quant-pages.yml`，将新版文件内容粘贴进去，提交到 **main**。
请使用本包里的新版工作流；旧账号版本监听 master 并构建旧博客，不适用于这次的新仓库。
GitHub 网页上传可能忽略空目录或 `.gitkeep`，不影响首次构建；首次策略上传会自动建立日志子目录。

## 3. 启用 Pages 并首次发布

1. 新仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 打开 **Actions → Publish Quant Dashboard → Run workflow**，选择 **main** 并运行。
3. 等待 build、deploy 都成功，再访问 https://microwavetech.github.io/quant/ 。

程序运行测试、解析日志，生成 `_site/quant/`，发布 `_site/`。不需要 Jekyll、Gemfile、旧博客首页或 `_config.yml`。
页面入口是 `/quant/`；本包未生成网站根路径的主页。
正式数据区初始为空。“演示数据”开关展示虚构样例，没有导入旧账号或本地回测日志。

## 4. 创建新账号的上传 Token

使用 MicrowaveTech 账号进入 **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**：

- Resource owner：**MicrowaveTech**。
- Repository access：**Only select repositories**，仅选择 **MicrowaveTech.github.io**。
- Repository permissions：**Contents → Read and write**，Metadata 保持默认读取权限。
- 设置有效期并保存 Token。到期需要更新聚宽配置。

该 Token 用于写入日志，不需要 Workflows 写权限。不要把真实 Token 上传到仓库或贴进 Issues；旧账号 Token 不用于新账号配置。

## 5. 更新聚宽

使用 `dist/joinquant-github-sync.zip` 或本地 `deployment/joinquant/`：

| 文件 | 聚宽位置 |
| --- | --- |
| `joinquant_four_strategies.py` | 策略编辑器中整体替换四策略代码，并更新对应模拟交易 |
| `dashboard_sync_config.json` | 投资研究根目录，替换此前同名同步配置 |

这两个文件仅用于聚宽，不放到公开仓库。原企业微信配置继续使用。
包内同步默认关闭，填入新账号 Token 后改为：

```json
{
  "enabled": true,
  "transport": "github",
  "owner": "MicrowaveTech",
  "repo": "MicrowaveTech.github.io",
  "branch": "main",
  "source_id": "four-strategies",
  "token": "这里替换成 MicrowaveTech 新生成的真实 Token"
}
```

不需要 endpoint。代码默认分支也已切换到 main，显式配置的 branch 优先。
只给一个模拟盘使用 four-strategies，避免不同账户的持仓和资产混在同一看板。
如果模拟盘存在尚未确认的待发批次，配置切换后会向新仓库重试；已确认上传到旧仓库的历史记录不会自动搬迁。

## 6. 自动更新怎样运行

仅聚宽 `sim_trade` 模拟交易采集和上传；回测不上传。

- 09:00 盘前报告完成后上传全文。
- 10:00 至 15:00 每个整点上传积累的记录，包括实际新增成交。
- 15:01 收盘报告完成后上传，15:30 补发或重试。
- 没有新记录不请求。失败保留同一批次，确认 GitHub 已保存后才清除待发记录。

聚宽提示 `【看板同步】上传成功，本批 N 条记录` 后，新仓库应出现：

```text
quant/_quant/inbox/four-strategies/交易日期/批次编号.json
```

新提交触发 Actions 解析发布，此外每小时第 17 分钟会运行一次。GitHub 调度和发布可能排队，不能保证整点立即更新。
网页每小时刷新，打开期间每分钟检查一次已发布索引。资产和持仓以报告快照为准，不会因网页刷新而自动获得新行情。
同步范围是完整盘前报告、确认成交和收盘报告，不是聚宽全部控制台日志。
原始批次和生成数据属于公开仓库/网站内容；Token 不写入上传数据。

## 常见问题

- **仓库上传正常、Actions 不运行**：检查 workflow 是否在根目录 `.github/workflows/`，是否提交到 main，Pages Source 是否为 GitHub Actions。
- **Actions 提示账户计费锁定**：这是 GitHub 账户状态，需要在该账号的 Billing 页面或 GitHub Support 核查；不能通过改策略代码解除。
- **聚宽上传失败**：检查 Token 属于新账号且具有新仓库 Contents 写权限，owner/repo/branch 是否和上面一致，以及聚宽能否访问 api.github.com。
- **只有演示数据**：关闭演示开关；真实数据从启用同步后的模拟交易生成，不会自动补齐历史。
- **要暂停上传**：将聚宽研究目录配置的 enabled 改成 false。

本地验证覆盖批次重试、去重、静态构建、部署包路径和浏览器交互；远程发布及聚宽云端联网需在完成配置后验证。

官方参考：[Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[GitHub 文件 API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)。
