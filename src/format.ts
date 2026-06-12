export function shortenAddress(value = "", chars = 6) {
  if (!value || value.length <= chars * 2 + 5) {
    return value;
  }
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

export function formatDateTime(value?: string) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatAmount(value: string | number, digits = 2) {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(numeric);
}

export function parseTokenAmount(amount: string, decimals: number) {
  const normalized = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a positive number");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function rawToAmount(raw: string, decimals: number) {
  const rawValue = BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = rawValue / base;
  const fraction = (rawValue % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

export function buildExplorerTxUrl(explorerUrl: string, txHash: string) {
  return `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}
