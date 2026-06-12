# Celo PayLink

由 Agent 驱动的 Celo Sepolia USDC 收款链接应用。

## 线上应用

- App：[https://celo-paylink.pages.dev](https://celo-paylink.pages.dev)
- Agent metadata：[https://celo-paylink.pages.dev/api/agent/metadata.json](https://celo-paylink.pages.dev/api/agent/metadata.json)
- Agent activity：[https://celo-paylink.pages.dev/api/agent/activity](https://celo-paylink.pages.dev/api/agent/activity)

## 功能简介

Celo PayLink 可以创建指定 USDC 金额的公开收款链接。付款方打开链接后在 Celo Sepolia 上付款，Agent 会读取链上交易并完成校验，只有付款匹配时才会标记为 paid 并生成 receipt。

Agent 会校验：

- transaction receipt 状态
- USDC transfer log
- 收款地址
- 付款金额
- 重复 transaction hash
- PayLink 过期时间

## 网络

- Network：Celo Sepolia
- Chain ID：`11142220`
- RPC：`https://forno.celo-sepolia.celo-testnet.org`
- Explorer：`https://celo-sepolia.blockscout.com`
- USDC：`0x01C5C0122039549AD1493B8220cABEdD739BC44E`

## 技术栈

- React
- Vite
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- Celo Sepolia JSON-RPC

## 本地开发

```bash
npm install
npm run d1:migrate:local
npm run pages:dev
```

打开 [http://localhost:8788](http://localhost:8788)。

## 部署

```bash
npm run d1:migrate:remote
npm run deploy
```

Cloudflare D1 binding 名称是 `DB`。

## 安全边界

- 应用不会要求输入私钥或助记词。
- 钱包签名始终在用户自己的 EVM 钱包中完成。
- 后端只校验公开链上交易数据，并把 PayLink 状态保存到 D1。
- 付款校验只接受配置好的 Celo Sepolia USDC 合约。

