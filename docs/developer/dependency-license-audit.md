# 依赖许可证审计

> **简体中文** | [English](../en/developer/dependency-license-audit.md)

最近一次基线检查：2026-08-03。

本文件记录包管理器元数据层面的许可证兼容性检查，便于依赖升级时比较变化。它不能替代发布前对实际打包文件、版权声明和完整许可证文本的复核。

本文是历史审计记录，不是随锁文件自动更新的实时报告。依赖发生变化后，必须重新执行审计并记录新的日期、工具和结果，不能只修改统计数字。

## 项目许可证选择

LazyTerm 采用 `GPL-3.0-or-later`。默认 VNC 构建会链接 `GPL-2.0-or-later` 的 LibVNCClient，选择 GPLv3 或以后版本可以与其“or later”条款兼容。

## 前端依赖

检查来源：`package-lock.json` 中 550 个依赖包的许可证字段。

主要许可证表达式包括 MIT、Apache-2.0、ISC、BSD、MPL-2.0、LGPL-3.0-or-later、BlueOak-1.0.0、Python-2.0、CC-BY-4.0、SIL OFL、Zlib 和 0BSD。未发现要求项目采用 GPL 不兼容许可证的包。

LGPL 条目来自 Sharp 的平台运行时包和 libvips。它们是构建工具依赖树中的可选平台包；发布时仍需确认实际产物是否包含对应二进制及其声明。

`package-lock.json` 中以下两个旧包缺少标准 `license` 字段：

- `console-browserify@1.2.0`
- `querystring-es3@0.2.1`

两者安装目录中的旧式 `licenses` 字段和随附许可证文件均声明 MIT。

## Rust 依赖

检查来源：`cargo metadata --format-version 1 --locked` 返回的 730 个包。

Cargo 元数据中没有缺失许可证字段的包。绝大多数依赖采用 MIT、Apache-2.0、BSD、ISC、MPL-2.0、Zlib、Unicode-3.0、BSL-1.0、CC0 或这些许可证的组合。

包含 GPL/LGPL 字样的依赖为：

| 包 | 许可证表达式 | 说明 |
| --- | --- | --- |
| `app` | `GPL-3.0-or-later` | LazyTerm 本身 |
| `unescaper@0.1.8` | `GPL-3.0/MIT` | 包元数据提供 GPLv3 或 MIT 选择，与项目许可证兼容 |
| `r-efi@5.3.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | 可选择 MIT 或 Apache-2.0 |

## 发布前仍需检查

- 根据最终安装包生成实际依赖清单，而不是只依赖锁文件。
- 保留需要随二进制分发的版权声明和许可证全文。
- 每次新增、升级或替换依赖和预编译 DLL 后重新执行检查。
- 对无法使用有效 SPDX 表达式描述的许可证进行人工复核。
- 复核 FreeRDP、WinPR、OpenSSL、LibVNCClient、MsTscAx sidecar 与随附 DLL 的准确版本、源码和分发义务。
