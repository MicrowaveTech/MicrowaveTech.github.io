# 量化看板：集中在 quant 目录

目标仓库：`MicrowaveTech/MicrowaveTech.github.io`，分支 `main`。
线上地址：`https://microwavetech.github.io/quant/`。
网页入口为 `quant/index.html`，生成数据在 `quant/data/`。
本目录 `quant/_quant/` 保存构建脚本、`site/` 网页源文件、`tests/` 测试和 `inbox/` 上传数据。
唯一位于仓库根目录的入口是 `.github/workflows/quant-pages.yml`，GitHub 只从这个固定位置发现工作流。

聚宽上传路径：`quant/_quant/inbox/four-strategies/YYYY-MM-DD/BATCH_ID.json`。
日志、账户和交易数据在公开仓库中可见，认证配置和 Token 仅放在聚宽投资研究目录。

在仓库根目录运行：

```sh
python3 -m unittest discover -s quant/_quant/tests -q
python3 quant/_quant/build_static.py --site quant/_quant/site --inbox quant/_quant/inbox --output quant
python3 -m http.server 8766 --bind 127.0.0.1
```

预览 `http://127.0.0.1:8766/quant/`。这是独立看板仓库，不需要 Jekyll 或旧博客文件。
工作流生成 `_site/quant/` 并发布 `_site/`，构建源码和原始上传批次仅保存在公开仓库内。
手动上传方式见同目录的 `DEPLOY.md`。研究目录的策略代码和 Token 配置不属于此公开目录。
