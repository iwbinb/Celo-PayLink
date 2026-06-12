import { CELO_SEPOLIA } from "./config";

declare global {
  interface Window {
    ethereum?: {
      request: <T = unknown>(args: {
        method: string;
        params?: unknown[];
      }) => Promise<T>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (
        event: string,
        handler: (...args: unknown[]) => void
      ) => void;
    };
  }
}

export function hasWallet() {
  return Boolean(window.ethereum);
}

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask or a Celo wallet.");
  }
  const accounts = await window.ethereum.request<string[]>({
    method: "eth_requestAccounts"
  });
  return accounts[0];
}

export async function getChainId() {
  if (!window.ethereum) return undefined;
  const chainId = await window.ethereum.request<string>({
    method: "eth_chainId"
  });
  return chainId;
}

export async function ensureCeloSepolia() {
  if (!window.ethereum) {
    throw new Error("No wallet available");
  }
  const current = await getChainId();
  if (current?.toLowerCase() === CELO_SEPOLIA.hexChainId) {
    return;
  }
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CELO_SEPOLIA.hexChainId }]
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) {
      throw error;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CELO_SEPOLIA.hexChainId,
          chainName: CELO_SEPOLIA.name,
          nativeCurrency: CELO_SEPOLIA.nativeCurrency,
          rpcUrls: [CELO_SEPOLIA.rpcUrl],
          blockExplorerUrls: [CELO_SEPOLIA.explorerUrl]
        }
      ]
    });
  }
}

function strip0x(value: string) {
  return value.replace(/^0x/i, "");
}

function pad64(value: string) {
  return strip0x(value).padStart(64, "0");
}

export function encodeErc20Transfer(to: string, amountRaw: string) {
  const selector = "a9059cbb";
  const address = pad64(to.toLowerCase());
  const amount = BigInt(amountRaw).toString(16).padStart(64, "0");
  return `0x${selector}${address}${amount}`;
}

export async function sendUsdcPayment(args: {
  from: string;
  tokenAddress: string;
  receiverAddress: string;
  amountRaw: string;
}) {
  if (!window.ethereum) {
    throw new Error("No wallet available");
  }
  await ensureCeloSepolia();
  const data = encodeErc20Transfer(args.receiverAddress, args.amountRaw);
  return window.ethereum.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: args.from,
        to: args.tokenAddress,
        value: "0x0",
        data
      }
    ]
  });
}
