# Celo PayLink Agent

## Identity

- Name: Celo PayLink Agent
- Purpose: Create and verify stablecoin payment links for real-world payments.
- First network: Celo Sepolia
- First token: USDC
- Metadata endpoint: `/api/agent/metadata.json`
- Activity endpoint: `/api/agent/activity`

## Verification Model

The agent does not treat a pasted transaction hash as proof of payment. It verifies chain data before changing business state.

Checks:

1. Transaction receipt exists.
2. Receipt status is successful.
3. At least one ERC-20 `Transfer` log is emitted by the configured USDC contract.
4. Transfer receiver matches the PayLink receiver address.
5. Transfer amount is greater than or equal to the requested amount.
6. Transaction hash has not been reused for another PayLink.
7. Transaction block time is not after the PayLink expiration.

## Decision Results

- `success`: PayLink was created, a payment was verified, or a receipt was issued.
- `warning`: Transaction is pending, underpaid, or not yet available from RPC.
- `failure`: Transaction failed, is duplicated, uses the wrong token, uses the wrong receiver, or violates expiration.
- `info`: The agent recorded an intermediate action such as transaction submission.

## Data Stored In D1

- `paylinks`: payment requests and current status
- `payment_attempts`: submitted transaction hashes and parsed onchain payment details
- `agent_decision_logs`: auditable checks and explanations
- `receipts`: final receipt records for verified payments

## Security Boundary

The app never asks for a private key. Wallet signing stays inside the user's EVM wallet. The backend verifies public transaction data and stores application state.

