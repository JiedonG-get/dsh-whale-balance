# dsh-whale-balance · 白饭余额

> 把 DeepSeek 账户余额写进 **对话上下文**，让模型自己知道还剩多少钱。

DSH 的余额插件基本都是给人看的挂件、侧栏、悬浮球。这个插件反过来：**让 AI 知道自己在烧钱**。

余额低于水位线时，注入的那句话会变硬——省着点用，这句话是模型写给自己的。

## 三样东西

| | 说明 |
|---|---|
| **上下文注入** | 每轮往 system prompt 的 context 里挂一行余额：`【白饭】余额 CNY 12.34，还够` |
| **whale_balance 工具** | 模型想查就查，返回余额、是否可用、是否低于水位线 |
| **首页角标** | 页面左下角一枚可拖动的小标签：整行加粗、颜色随峰谷、边框随水位，20 秒拉一次真实数据 |

## 安装

```bash
# 本地目录
dsh plugin --profile web add link:/path/to/dsh-whale-balance

# 或从 npm（发布后）
dsh plugin --profile web add dsh-whale-balance
```

装完重启 DSH。确认插件的 `bundles` 里在**靠前位置**（第一屏渲染前注册注入行）。

## 配置

插件没有设置页，配置在：

```
/sdcard/DeepseekHarness/whale-balance/config.json
```

```json
{
  "showBadge": true,
  "injectContext": true,
  "injectText": "【白饭】余额 {currency} {balance}，{low}",
  "toolEnabled": true,
  "lowWater": 5
}
```

| 字段 | 说明 |
|---|---|
| `showBadge` | 是否在首页显示可拖动的余额角标 |
| `injectContext` | 是否每轮把余额写进上下文 |
| `injectText` | 注入的文本，可用 `{balance}` `{currency}` `{low}` |
| `lowWater` | 水位线（元），低于它时 `{low}` 变成「低于警戒线」 |
| `refName` | 从 DSH 凭据里取哪一把 key，默认 `DEEPSEEK_API_KEY` |

改完立刻生效（注入下一轮、角标下次拉取）。角标位置存在浏览器 `localStorage`，拖到哪下次还在哪。

## 峰时 / 谷时

官方口径（2026-08-17 起）：**北京时间 9:00–12:00、14:00–18:00 为高峰，其余为空闲时段，空闲价格是高峰的一半**。

角标最右侧显示 `峰时`（红）或 `谷时`（绿），整行文字颜色跟着变。

## 怎么拿余额

```
~/.dsh/.credentials.yaml → refs.DEEPSEEK_API_KEY
        ↓
GET https://api.deepseek.com/user/balance
```

只读已有凭据，不新增、不上传、不落日志。请求失败不进缓存，后台每 10 秒重试直到成功。

## 关于角标的两个坑（踩过，写下来）

1. **`tapIndex` 必须是 `html → html` 的纯函数。** 返回对象会让宿主每次渲染首页都 400，表现为「Web 页面尚不可用」——App 会把它判成插件故障并自动禁用。
2. **注入脚本里不要依赖 `fetch` 的回调。** 页面侧回调不一定拿得到；改成数据脚本自己 `document.getElementById` 改文字。
3. **数字别交给 JS 去写。** 最终稳的做法是：注入的 HTML 里就把 `白饭 CNY 12.34` 印好，脚本只负责拖动和面板。页面 JS 执行环境不可控（回调不触发、fetch 被拦都遇到过），但 HTML 一定会渲染。

## 配置示例

见 `config.example.json`。

## License

MIT
