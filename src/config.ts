export const CELO_SEPOLIA = {
  id: "celo-sepolia",
  name: "Celo Sepolia",
  chainId: 11142220,
  hexChainId: "0xaa044c",
  rpcUrl:
    import.meta.env.VITE_CELO_RPC_URL ||
    "https://forno.celo-sepolia.celo-testnet.org",
  explorerUrl:
    import.meta.env.VITE_CELO_EXPLORER_URL ||
    "https://celo-sepolia.blockscout.com",
  nativeCurrency: {
    name: "CELO",
    symbol: "CELO",
    decimals: 18
  }
};

export const USDC_TOKEN = {
  symbol: "USDC",
  name: "USD Coin",
  address:
    import.meta.env.VITE_USDC_ADDRESS ||
    "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  decimals: 6
};

export const DEFAULT_RECEIVER_ADDRESS =
  import.meta.env.VITE_DEFAULT_RECEIVER_ADDRESS ||
  "0x0000000000000000000000000000000000000001";

export const AGENT_NAME = "Celo PayLink Agent";
