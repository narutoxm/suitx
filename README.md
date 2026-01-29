# suitx

两个任务的 TypeScript 实现：

- 任务 1：订阅 `ws://54.36.109.38:9000/subscribe`，当 `tx_events` 不为空时，把 `tx_digest` 写入 `public_tx_digest`
- 任务 2：订阅 `wss://sui.validator.giverep.com/wss`（需要 API Key），当 `events` 不为空时，把 `txDigest` 写入 `relay_tx_digest`

## 安装

```bash
npm i
```

## 配置

复制并编辑环境变量：

```bash
cp .env.example .env
```

至少需要设置：

- `MYSQL_PASSWORD`
- `RELAY_API_KEY`

## 运行

开发模式（直接跑 TS）：

```bash
npm run dev:all
npm run dev:public
npm run dev:relay
```

生产模式（先编译再运行）：

```bash
npm run build
npm run start:all
npm run start:public
npm run start:relay
```
