# Celo PayLink

Agent-powered USDC payment links for real-world payments on Celo Sepolia.

## Live App

- App: [https://celo-paylink.pages.dev](https://celo-paylink.pages.dev)
- Agent metadata: [https://celo-paylink.pages.dev/api/agent/metadata.json](https://celo-paylink.pages.dev/api/agent/metadata.json)
- Agent activity: [https://celo-paylink.pages.dev/api/agent/activity](https://celo-paylink.pages.dev/api/agent/activity)

## What It Does

Celo PayLink lets a receiver create a shareable payment link for a specific USDC amount. A payer opens the link, pays on Celo Sepolia, and the agent verifies the transaction before marking the request as paid or issuing a receipt.

The agent checks:

- transaction receipt status
- USDC transfer log
- receiver address
- payment amount
- duplicate transaction hash
- PayLink expiration

## Network

- Network: Celo Sepolia
- Chain ID: `11142220`
- RPC: `https://forno.celo-sepolia.celo-testnet.org`
- Explorer: `https://celo-sepolia.blockscout.com`
- USDC: `0x01C5C0122039549AD1493B8220cABEdD739BC44E`

## Tech Stack

- React
- Vite
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- Celo Sepolia JSON-RPC

## Local Development

```bash
npm install
npm run d1:migrate:local
npm run pages:dev
```

Open [http://localhost:8788](http://localhost:8788).

## Deployment

```bash
npm run d1:migrate:remote
npm run deploy
```

The Cloudflare D1 binding name is `DB`.

## Security

- The app never asks for private keys or seed phrases.
- Wallet signing stays inside the user's EVM wallet.
- The backend verifies public transaction data and stores PayLink state in D1.
- Only the configured Celo Sepolia USDC contract is accepted for payment verification.

