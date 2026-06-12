export type PayLinkStatus =
  | "pending"
  | "verifying"
  | "paid"
  | "underpaid"
  | "expired"
  | "invalid"
  | "cancelled";

export type AttemptStatus =
  | "submitted"
  | "verifying"
  | "verified"
  | "underpaid"
  | "invalid"
  | "duplicate"
  | "failed";

export interface PayLink {
  id: string;
  publicId: string;
  title: string;
  purpose: string;
  receiverAddress: string;
  receiverName?: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  amount: string;
  amountRaw: string;
  status: PayLinkStatus;
  network: string;
  chainId: number;
  publicUrl?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  receiptId?: string;
}

export interface PaymentAttempt {
  id: string;
  paylinkId: string;
  txHash: string;
  payerAddress?: string;
  receiverAddress?: string;
  tokenAddress?: string;
  amountRaw?: string;
  amountFormatted?: string;
  status: AttemptStatus;
  failureReason?: string;
  blockNumber?: number;
  confirmedAt?: string;
  createdAt: string;
}

export interface AgentDecisionLog {
  id: string;
  paylinkId?: string;
  attemptId?: string;
  action: string;
  inputSummary: string;
  checks: Array<{
    label: string;
    status: "passed" | "failed" | "pending" | "info";
    evidence: string;
  }>;
  result: "success" | "warning" | "failure" | "info";
  explanation: string;
  createdAt: string;
}

export interface Receipt {
  id: string;
  paylinkId: string;
  attemptId: string;
  receiptNumber: string;
  receiverAddress: string;
  payerAddress: string;
  tokenSymbol: string;
  amount: string;
  txHash: string;
  network: string;
  explorerUrl: string;
  agentSummary: string;
  issuedAt: string;
}

export interface PayLinkDetail extends PayLink {
  attempts: PaymentAttempt[];
  decisions: AgentDecisionLog[];
  receipt?: Receipt;
}

export interface Metrics {
  totalReceived: string;
  totalPayLinks: number;
  successfulPayments: number;
  conversionRate: number;
  activePayLinks: number;
}

export interface DashboardResponse {
  paylinks: PayLink[];
  decisions: AgentDecisionLog[];
  metrics: Metrics;
}

export interface CreatePayLinkInput {
  title: string;
  purpose: string;
  amount: string;
  receiverAddress: string;
  receiverName?: string;
  expiresAt: string;
}
