import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bell,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Copy,
  ExternalLink,
  FileCheck2,
  Filter,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  XCircle
} from "lucide-react";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { sendUsdcPayment, connectWallet, ensureCeloSepolia, hasWallet } from "./chain";
import { AGENT_NAME, CELO_SEPOLIA, DEFAULT_RECEIVER_ADDRESS, USDC_TOKEN } from "./config";
import {
  buildExplorerTxUrl,
  formatAmount,
  formatDate,
  formatDateTime,
  isAddress,
  shortenAddress
} from "./format";
import {
  AgentDecisionLog,
  CreatePayLinkInput,
  DashboardResponse,
  PayLink,
  PayLinkDetail,
  PayLinkStatus
} from "./types";

type Toast = { message: string; kind?: "success" | "warning" | "error" };

const statusLabels: Record<PayLinkStatus, string> = {
  pending: "Active",
  verifying: "Verifying",
  paid: "Paid",
  underpaid: "Underpaid",
  expired: "Expired",
  invalid: "Invalid",
  cancelled: "Cancelled"
};

const nav = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "PayLinks", icon: Link2, path: "/" },
  { label: "Payments", icon: CircleDollarSign, path: "/" },
  { label: "Recipients", icon: Users, path: "/" },
  { label: "Agent", icon: ShieldCheck, path: "/agent" },
  { label: "Receipts", icon: ReceiptText, path: "/" },
  { label: "Settings", icon: Settings, path: "/" }
];

const defaultForm = (): CreatePayLinkInput => ({
  title: "",
  purpose: "Community dinner contribution",
  amount: "10.00",
  receiverAddress: DEFAULT_RECEIVER_ADDRESS,
  receiverName: "Celo PayLink Test Wallet",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
});

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handle = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return { path, navigate };
}

function ToastView({ toast, onClose }: { toast?: Toast; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, 2400);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return <div className={`toast ${toast.kind || "success"}`}>{toast.message}</div>;
}

function AppShell({
  children,
  navigate,
  activePath
}: {
  children: React.ReactNode;
  navigate: (path: string) => void;
  activePath: string;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("/")} aria-label="Open dashboard">
          <span className="brand-mark">C</span>
          <span>Celo PayLink</span>
        </button>
        <nav className="nav-list" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              item.path === activePath ||
              (item.label === "Dashboard" && activePath === "/") ||
              (item.label === "Agent" && activePath.startsWith("/agent"));
            return (
              <button
                key={item.label}
                className={`nav-item ${active ? "active" : ""}`}
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-pill">
            <span>Network</span>
            <strong>{CELO_SEPOLIA.name}</strong>
            <i />
          </div>
          <div className="account-card">
            <span className="account-avatar">A</span>
            <span>
              <strong>Agent Workspace</strong>
              <small>{shortenAddress(DEFAULT_RECEIVER_ADDRESS, 5)}</small>
            </span>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  right
}: {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        <div className="agent-status">
          <span className="status-dot" />
          <span>
            <small>Agent Status</small>
            <strong>Active</strong>
          </span>
        </div>
        {right}
        <button className="icon-button" aria-label="Notifications">
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}

function StatusBadge({ status }: { status: PayLinkStatus | string }) {
  return <span className={`status-badge ${status}`}>{statusLabels[status as PayLinkStatus] || status}</span>;
}

function MetricCard({
  label,
  value,
  sub,
  trend,
  icon: Icon
}: {
  label: string;
  value: string;
  sub: string;
  trend: string;
  icon: typeof CircleDollarSign;
}) {
  return (
    <section className="metric-card">
      <div className="metric-icon">
        <Icon size={24} />
      </div>
      <div>
        <div className="metric-label">{label}</div>
        <strong>{value}</strong>
        <p>{sub}</p>
        <span>{trend}</span>
      </div>
    </section>
  );
}

function CreatePayLinkPanel({
  onCreated,
  setToast
}: {
  onCreated: (detail: PayLinkDetail) => void;
  setToast: (toast: Toast) => void;
}) {
  const [form, setForm] = useState<CreatePayLinkInput>(defaultForm);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [qr, setQr] = useState("");
  const [created, setCreated] = useState<PayLinkDetail | undefined>();
  const [busy, setBusy] = useState(false);
  const valid = Number(form.amount) > 0 && isAddress(form.receiverAddress) && form.purpose.trim().length > 2;

  useEffect(() => {
    const target = created?.publicUrl || `${window.location.origin}/p/preview`;
    QRCode.toDataURL(target, {
      margin: 1,
      width: 180,
      color: { dark: "#171714", light: "#ffffff" }
    }).then(setQr);
  }, [created]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) {
      setToast({ message: "Check amount, purpose, and receiver address.", kind: "warning" });
      return;
    }
    setBusy(true);
    try {
      const expiresAt = new Date(form.expiresAt).toISOString();
      const detail = await api.createPayLink({
        ...form,
        title: form.title || form.purpose,
        expiresAt
      });
      setCreated(detail);
      onCreated(detail);
      setToast({ message: "PayLink created. Agent decision recorded.", kind: "success" });
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function parsePrompt() {
    if (!agentPrompt.trim()) return;
    setBusy(true);
    try {
      const parsed = await api.parseAgent(agentPrompt);
      setForm((current) => ({
        ...current,
        ...parsed,
        receiverAddress: parsed.receiverAddress || current.receiverAddress,
        expiresAt: parsed.expiresAt
          ? parsed.expiresAt.slice(0, 16)
          : current.expiresAt
      }));
      setToast({ message: "Agent parsed the payment request.", kind: "success" });
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const value = created?.publicUrl;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setToast({ message: "PayLink copied.", kind: "success" });
  }

  return (
    <aside className="create-panel">
      <div className="panel-heading">
        <h2>Create PayLink</h2>
        <p>Create a stablecoin payment link and let the agent verify it.</p>
      </div>
      <div className="agent-prompt">
        <label htmlFor="agent-prompt">Agent quick create</label>
        <div className="prompt-row">
          <input
            id="agent-prompt"
            value={agentPrompt}
            placeholder="Collect 25 USDC for dinner, expires tomorrow"
            onChange={(event) => setAgentPrompt(event.target.value)}
          />
          <button className="secondary-button" onClick={parsePrompt} type="button">
            Parse
          </button>
        </div>
      </div>
      <form className="paylink-form" onSubmit={submit}>
        <label>
          Amount
          <div className="amount-row">
            <input
              value={form.amount}
              inputMode="decimal"
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
            <span className="token-pill">{USDC_TOKEN.symbol}</span>
          </div>
        </label>
        <label>
          Purpose
          <input
            value={form.purpose}
            onChange={(event) => setForm({ ...form, purpose: event.target.value })}
          />
        </label>
        <label>
          Expiration
          <input
            type="datetime-local"
            value={form.expiresAt}
            onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
          />
        </label>
        <label>
          Receiver Address
          <input
            value={form.receiverAddress}
            className={!isAddress(form.receiverAddress) ? "input-error" : ""}
            onChange={(event) =>
              setForm({ ...form, receiverAddress: event.target.value })
            }
          />
        </label>
        <div className="qr-preview">
          {qr ? <img src={qr} alt="PayLink QR code preview" /> : <QrCode size={88} />}
          <div>
            <span>PayLink Preview</span>
            <strong>{created ? shortenAddress(created.publicId, 8) : "Ready after create"}</strong>
          </div>
        </div>
        {created?.publicUrl ? (
          <button className="secondary-button full" type="button" onClick={copyLink}>
            <Copy size={16} />
            Copy PayLink
          </button>
        ) : null}
        <button className="primary-button full" disabled={busy || !valid} type="submit">
          {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          {busy ? "Creating..." : "Create PayLink"}
        </button>
      </form>
    </aside>
  );
}

function PayLinksTable({
  paylinks,
  navigate
}: {
  paylinks: PayLink[];
  navigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = paylinks.filter((item) => {
    const target = `${item.purpose} ${item.publicId} ${item.receiverAddress}`.toLowerCase();
    return target.includes(query.toLowerCase());
  });

  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <h2>PayLinks</h2>
        <div className="toolbar-actions">
          <div className="search-field">
            <Search size={16} />
            <input
              value={query}
              placeholder="Search PayLinks..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button className="secondary-button">
            <Filter size={16} />
            Filters
          </button>
          <button className="icon-button" aria-label="More table actions">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title / Purpose</th>
                <th>Amount</th>
                <th>Token</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} onClick={() => navigate(`/paylinks/${item.publicId}`)}>
                  <td>
                    <strong>{item.title || item.purpose}</strong>
                    <small>{item.purpose}</small>
                  </td>
                  <td>{formatAmount(item.amount)} </td>
                  <td>
                    <span className="token-mini">{item.tokenSymbol}</span>
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{formatDate(item.expiresAt)}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Link2}
          title="Create your first PayLink"
          body="PayLinks will appear here after you create stablecoin payment requests."
        />
      )}
    </section>
  );
}

function AgentFeed({
  decisions,
  navigate
}: {
  decisions: AgentDecisionLog[];
  navigate: (path: string) => void;
}) {
  return (
    <section className="agent-feed">
      <div className="panel-heading row">
        <div>
          <h2>Agent Feed</h2>
          <p>Real-time decisions and actions by your PayLink agent.</p>
        </div>
        <button className="ghost-button" onClick={() => navigate("/agent")}>
          View all
        </button>
      </div>
      {decisions.length ? (
        <div className="feed-list">
          {decisions.map((item) => (
            <div className="feed-row" key={item.id}>
              <span>{formatDateTime(item.createdAt)}</span>
              <Activity size={16} />
              <strong>{humanizeAction(item.action)}</strong>
              <p>{item.explanation}</p>
              <StatusResult result={item.result} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="Agent activity will appear here"
          body="Create and verify PayLinks to build an auditable onchain decision trail."
        />
      )}
    </section>
  );
}

function Dashboard({
  data,
  setData,
  navigate,
  setToast
}: {
  data: DashboardResponse;
  setData: (data: DashboardResponse) => void;
  navigate: (path: string) => void;
  setToast: (toast: Toast) => void;
}) {
  const refresh = useCallback(async () => {
    setData(await api.dashboard());
  }, [setData]);

  return (
    <AppShell navigate={navigate} activePath="/">
      <PageHeader title="Dashboard" subtitle="Overview of your PayLinks and payments on Celo." />
      <section className="metrics-grid">
        <MetricCard
          icon={CircleDollarSign}
          label="Total Received"
          value={`${formatAmount(data.metrics.totalReceived)} ${USDC_TOKEN.symbol}`}
          sub="Verified by agent"
          trend="Live from D1 records"
        />
        <MetricCard
          icon={Link2}
          label="Total PayLinks"
          value={String(data.metrics.totalPayLinks)}
          sub={`${data.metrics.activePayLinks} active links`}
          trend="Creation flow ready"
        />
        <MetricCard
          icon={BadgeCheck}
          label="Payments"
          value={String(data.metrics.successfulPayments)}
          sub="Successful"
          trend="Receipt-backed"
        />
        <MetricCard
          icon={Activity}
          label="Conversion Rate"
          value={`${data.metrics.conversionRate}%`}
          sub="Paid / Created"
          trend="Onchain verified"
        />
      </section>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <PayLinksTable paylinks={data.paylinks} navigate={navigate} />
          <AgentFeed decisions={data.decisions} navigate={navigate} />
        </div>
        <CreatePayLinkPanel
          setToast={setToast}
          onCreated={async (detail) => {
            navigate(`/paylinks/${detail.publicId}`);
            await refresh();
          }}
        />
      </div>
    </AppShell>
  );
}

function PublicPaymentPage({
  publicId,
  navigate,
  setToast
}: {
  publicId: string;
  navigate: (path: string) => void;
  setToast: (toast: Toast) => void;
}) {
  const [detail, setDetail] = useState<PayLinkDetail>();
  const [account, setAccount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");

  const load = useCallback(async () => {
    setDetail(await api.getPayLink(publicId));
  }, [publicId]);

  useEffect(() => {
    load().catch((error) => setToast({ message: error.message, kind: "error" }));
  }, [load, setToast]);

  useEffect(() => {
    QRCode.toDataURL(window.location.href, { width: 168, margin: 1 }).then(setQr);
  }, []);

  async function connect() {
    try {
      const wallet = await connectWallet();
      setAccount(wallet);
      await ensureCeloSepolia();
      setToast({ message: "Wallet connected on Celo Sepolia.", kind: "success" });
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    }
  }

  async function pay() {
    if (!detail) return;
    setBusy(true);
    try {
      const from = account || (await connectWallet());
      setAccount(from);
      const hash = await sendUsdcPayment({
        from,
        tokenAddress: detail.tokenAddress,
        receiverAddress: detail.receiverAddress,
        amountRaw: detail.amountRaw
      });
      setTxHash(hash);
      await api.submitAttempt(publicId, hash);
      const verified = await api.verify(publicId, hash);
      setDetail(verified);
      setToast(verificationToast(verified.status));
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function verifyManual() {
    if (!txHash.trim()) return;
    setBusy(true);
    try {
      await api.submitAttempt(publicId, txHash.trim());
      const verified = await api.verify(publicId, txHash.trim());
      setDetail(verified);
      setToast(verificationToast(verified.status));
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <CenteredLoading label="Loading PayLink..." />;
  }

  return (
    <div className="public-page">
      <header className="public-header">
        <button className="brand small" onClick={() => navigate("/")}>
          <span className="brand-mark">C</span>
          <span>Celo PayLink</span>
        </button>
        <span className="network-chip">{CELO_SEPOLIA.name}</span>
      </header>
      <main className="payment-shell">
        <section className="payment-card">
          <StatusBadge status={detail.status} />
          <div className="payment-amount">
            <span>{detail.tokenSymbol}</span>
            <strong>{formatAmount(detail.amount)}</strong>
          </div>
          <h1>{detail.purpose}</h1>
          <p>
            Pay this request on Celo. The agent will verify the transaction before
            issuing a receipt.
          </p>
          <dl className="fact-list">
            <div>
              <dt>Receiver</dt>
              <dd>{shortenAddress(detail.receiverAddress)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatDateTime(detail.expiresAt)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{CELO_SEPOLIA.name}</dd>
            </div>
          </dl>
          <div className="payment-actions">
            {!account ? (
              <button className="secondary-button full" onClick={connect}>
                <Wallet size={16} />
                Connect Wallet
              </button>
            ) : (
              <button className="secondary-button full" onClick={connect}>
                <Wallet size={16} />
                {shortenAddress(account)}
              </button>
            )}
            <button
              className="primary-button full"
              onClick={pay}
              disabled={busy || detail.status === "paid" || !hasWallet()}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              {detail.status === "paid" ? "Payment Verified" : `Pay ${detail.amount} ${detail.tokenSymbol}`}
            </button>
          </div>
          {!hasWallet() ? (
            <p className="helper warning">
              No browser wallet detected. Paste a completed Celo Sepolia transaction hash below.
            </p>
          ) : null}
          <div className="manual-verify">
            <label htmlFor="tx-hash">Manual transaction hash</label>
            <div className="prompt-row">
              <input
                id="tx-hash"
                value={txHash}
                placeholder="0x..."
                onChange={(event) => setTxHash(event.target.value)}
              />
              <button className="secondary-button" onClick={verifyManual} disabled={busy}>
                Verify
              </button>
            </div>
          </div>
          {detail.receipt ? (
            <button
              className="ghost-button full"
              onClick={() => navigate(`/p/${detail.publicId}/receipt`)}
            >
              <ReceiptText size={16} />
              View receipt
            </button>
          ) : null}
        </section>
        <aside className="verification-card">
          {qr ? <img className="small-qr" src={qr} alt="Payment page QR code" /> : null}
          <h2>Agent verification</h2>
          <p>{verificationMessage(detail.status)}</p>
          <DecisionTimeline decisions={detail.decisions} compact />
        </aside>
      </main>
    </div>
  );
}

function PayLinkDetailPage({
  publicId,
  navigate,
  setToast
}: {
  publicId: string;
  navigate: (path: string) => void;
  setToast: (toast: Toast) => void;
}) {
  const [detail, setDetail] = useState<PayLinkDetail>();
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDetail(await api.getPayLink(publicId));
  }, [publicId]);

  useEffect(() => {
    load().catch((error) => setToast({ message: error.message, kind: "error" }));
  }, [load, setToast]);

  async function copy(value?: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setToast({ message: "Copied.", kind: "success" });
  }

  async function verify() {
    if (!txHash.trim()) return;
    setBusy(true);
    try {
      await api.submitAttempt(publicId, txHash.trim());
      const verified = await api.verify(publicId, txHash.trim());
      setDetail(verified);
      setToast(verificationToast(verified.status));
    } catch (error) {
      setToast({ message: (error as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <CenteredLoading label="Loading PayLink detail..." />;

  return (
    <AppShell navigate={navigate} activePath="/paylinks">
      <div className="detail-header">
        <button className="ghost-button" onClick={() => navigate("/")}>
          <ArrowLeft size={16} />
          Back
        </button>
        <div>
          <h1>{detail.title}</h1>
          <p>{detail.purpose}</p>
        </div>
        <StatusBadge status={detail.status} />
      </div>
      <div className="detail-grid">
        <section className="detail-panel">
          <h2>PayLink Summary</h2>
          <div className="amount-display">
            <span>{detail.tokenSymbol}</span>
            <strong>{formatAmount(detail.amount)}</strong>
          </div>
          <dl className="fact-list stacked">
            <div>
              <dt>Receiver</dt>
              <dd>
                {shortenAddress(detail.receiverAddress)}
                <button className="copy-inline" onClick={() => copy(detail.receiverAddress)}>
                  <Copy size={14} />
                </button>
              </dd>
            </div>
            <div>
              <dt>Public URL</dt>
              <dd>
                {detail.publicUrl ? detail.publicUrl.replace(window.location.origin, "") : `/p/${detail.publicId}`}
                <button className="copy-inline" onClick={() => copy(detail.publicUrl)}>
                  <Copy size={14} />
                </button>
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatDateTime(detail.expiresAt)}</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{detail.tokenSymbol} on {CELO_SEPOLIA.name}</dd>
            </div>
          </dl>
          <button className="primary-button full" onClick={() => navigate(`/p/${detail.publicId}`)}>
            <ExternalLink size={16} />
            Open payment page
          </button>
        </section>
        <section className="detail-panel">
          <h2>Verify Transaction</h2>
          <p className="panel-copy">
            Paste a Celo Sepolia USDC transaction hash and the agent will verify
            token, receiver, amount, duplicate status, and expiration.
          </p>
          <div className="manual-verify">
            <label htmlFor="detail-tx">Transaction hash</label>
            <div className="prompt-row">
              <input
                id="detail-tx"
                value={txHash}
                placeholder="0x..."
                onChange={(event) => setTxHash(event.target.value)}
              />
              <button className="secondary-button" onClick={verify} disabled={busy}>
                {busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                Verify
              </button>
            </div>
          </div>
          {detail.receipt ? (
            <div className="receipt-preview">
              <FileCheck2 size={20} />
              <div>
                <strong>{detail.receipt.receiptNumber}</strong>
                <span>{detail.receipt.agentSummary}</span>
              </div>
              <button onClick={() => navigate(`/p/${detail.publicId}/receipt`)}>
                Open
              </button>
            </div>
          ) : null}
        </section>
        <section className="detail-panel wide">
          <h2>Agent Verification Timeline</h2>
          <DecisionTimeline decisions={detail.decisions} />
        </section>
        <section className="detail-panel wide">
          <h2>Payment Attempts</h2>
          {detail.attempts.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Amount</th>
                    <th>Payer</th>
                    <th>Status</th>
                    <th>Explorer</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>{shortenAddress(attempt.txHash)}</td>
                      <td>{attempt.amountFormatted || "Pending"} {detail.tokenSymbol}</td>
                      <td>{shortenAddress(attempt.payerAddress || "")}</td>
                      <td>{attempt.status}</td>
                      <td>
                        <a href={buildExplorerTxUrl(CELO_SEPOLIA.explorerUrl, attempt.txHash)} target="_blank">
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Clock}
              title="No payment attempts yet"
              body="Attempts appear after a payer submits or pastes a transaction hash."
            />
          )}
        </section>
      </div>
    </AppShell>
  );
}

function ReceiptPage({
  publicId,
  navigate,
  setToast
}: {
  publicId: string;
  navigate: (path: string) => void;
  setToast: (toast: Toast) => void;
}) {
  const [detail, setDetail] = useState<PayLinkDetail>();

  useEffect(() => {
    api
      .getPayLink(publicId)
      .then(setDetail)
      .catch((error) => setToast({ message: error.message, kind: "error" }));
  }, [publicId, setToast]);

  if (!detail) return <CenteredLoading label="Loading receipt..." />;
  if (!detail.receipt) {
    return (
      <div className="public-page">
        <EmptyState
          icon={ReceiptText}
          title="Receipt is not ready"
          body="The agent issues a receipt only after a payment is verified."
        />
      </div>
    );
  }

  return (
    <div className="public-page receipt-page">
      <header className="public-header">
        <button className="brand small" onClick={() => navigate("/")}>
          <span className="brand-mark">C</span>
          <span>Celo PayLink</span>
        </button>
        <StatusBadge status="paid" />
      </header>
      <main className="receipt-shell">
        <section className="receipt-card">
          <FileCheck2 size={32} />
          <span className="receipt-label">Verified Receipt</span>
          <h1>{detail.receipt.receiptNumber}</h1>
          <div className="payment-amount">
            <span>{detail.receipt.tokenSymbol}</span>
            <strong>{formatAmount(detail.receipt.amount)}</strong>
          </div>
          <p>{detail.purpose}</p>
          <dl className="fact-list stacked">
            <div>
              <dt>Payer</dt>
              <dd>{detail.receipt.payerAddress}</dd>
            </div>
            <div>
              <dt>Receiver</dt>
              <dd>{detail.receipt.receiverAddress}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>{detail.receipt.txHash}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{formatDateTime(detail.receipt.issuedAt)}</dd>
            </div>
          </dl>
          <p className="agent-summary">{detail.receipt.agentSummary}</p>
          <div className="button-row">
            <a className="primary-button" href={detail.receipt.explorerUrl} target="_blank">
              <ExternalLink size={16} />
              Open explorer
            </a>
            <button
              className="secondary-button"
              onClick={() => navigator.clipboard.writeText(window.location.href)}
            >
              <Copy size={16} />
              Copy receipt
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function AgentPage({
  data,
  navigate
}: {
  data: DashboardResponse;
  navigate: (path: string) => void;
}) {
  return (
    <AppShell navigate={navigate} activePath="/agent">
      <PageHeader
        title={AGENT_NAME}
        subtitle="Agent identity, capabilities, metadata, and recent decisions."
      />
      <div className="agent-grid">
        <section className="detail-panel">
          <h2>Capabilities</h2>
          <div className="capability-list">
            {[
              "Create stablecoin PayLinks",
              "Verify Celo Sepolia USDC transfers",
              "Detect underpayments",
              "Reject duplicate transactions",
              "Issue receipts",
              "Expose metadata for registry submission"
            ].map((item) => (
              <div key={item}>
                <Check size={16} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="detail-panel">
          <h2>Registry Metadata</h2>
          <pre className="metadata-preview">{JSON.stringify(
            {
              name: AGENT_NAME,
              network: CELO_SEPOLIA.name,
              token: USDC_TOKEN.symbol,
              receiver: shortenAddress(DEFAULT_RECEIVER_ADDRESS),
              metadata: "/api/agent/metadata.json"
            },
            null,
            2
          )}</pre>
          <a className="secondary-button full" href="/api/agent/metadata.json" target="_blank">
            <ExternalLink size={16} />
            Open metadata
          </a>
        </section>
        <section className="detail-panel wide">
          <h2>Recent Agent Decisions</h2>
          <DecisionTimeline decisions={data.decisions} />
        </section>
      </div>
    </AppShell>
  );
}

function DecisionTimeline({
  decisions,
  compact = false
}: {
  decisions: AgentDecisionLog[];
  compact?: boolean;
}) {
  if (!decisions.length) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No decisions yet"
        body="Agent verification steps will appear after PayLinks are created or verified."
      />
    );
  }
  return (
    <div className={`timeline ${compact ? "compact" : ""}`}>
      {decisions.slice(0, compact ? 4 : 20).map((decision) => (
        <article className="timeline-item" key={decision.id}>
          <span className={`timeline-dot ${decision.result}`} />
          <div>
            <div className="timeline-head">
              <strong>{humanizeAction(decision.action)}</strong>
              <StatusResult result={decision.result} />
            </div>
            <p>{decision.explanation}</p>
            {decision.checks?.slice(0, compact ? 2 : 8).map((check) => (
              <small key={`${decision.id}-${check.label}`}>
                {check.status === "passed" ? "✓" : check.status === "failed" ? "!" : "•"}{" "}
                {check.label}: {check.evidence}
              </small>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body
}: {
  icon: typeof Link2;
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function CenteredLoading({ label }: { label: string }) {
  return (
    <div className="centered-loading">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

function StatusResult({ result }: { result: string }) {
  const Icon = result === "success" ? Check : result === "failure" ? XCircle : result === "warning" ? AlertTriangle : Clock;
  return (
    <span className={`result-pill ${result}`}>
      <Icon size={13} />
      {result}
    </span>
  );
}

function humanizeAction(action: string) {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function verificationMessage(status: PayLinkStatus) {
  if (status === "paid") return "Payment verified. Your receipt is ready.";
  if (status === "verifying") return "Agent is checking receipt, token, receiver, amount, duplicate status, and expiration.";
  if (status === "underpaid") return "The transaction was found, but the amount is below this PayLink request.";
  if (status === "invalid") return "The transaction does not match this PayLink.";
  if (status === "expired") return "This PayLink has expired. Ask the receiver for a new link.";
  return "Waiting for payment. The agent will verify the transaction before issuing a receipt.";
}

function verificationToast(status: PayLinkStatus): Toast {
  if (status === "paid") {
    return { message: "Payment verified. Receipt issued.", kind: "success" };
  }
  if (status === "verifying") {
    return { message: "Transaction submitted. Receipt is not available yet.", kind: "warning" };
  }
  if (status === "underpaid") {
    return { message: "Transaction found, but the amount is below the request.", kind: "warning" };
  }
  if (status === "expired") {
    return { message: "The PayLink expired before this transaction could be accepted.", kind: "warning" };
  }
  if (status === "invalid") {
    return { message: "Transaction rejected. It does not match this PayLink.", kind: "error" };
  }
  return { message: "Agent verification complete.", kind: "success" };
}

export function App() {
  const { path, navigate } = useRoute();
  const [data, setData] = useState<DashboardResponse>({
    paylinks: [],
    decisions: [],
    metrics: {
      totalReceived: "0",
      totalPayLinks: 0,
      successfulPayments: 0,
      conversionRate: 0,
      activePayLinks: 0
    }
  });
  const [toast, setToast] = useState<Toast>();

  const loadDashboard = useCallback(async () => {
    setData(await api.dashboard());
  }, []);

  useEffect(() => {
    loadDashboard().catch((error) =>
      setToast({ message: error.message, kind: "error" })
    );
  }, [loadDashboard]);

  const route = useMemo(() => {
    const receipt = path.match(/^\/p\/([^/]+)\/receipt$/);
    if (receipt) return { name: "receipt", id: receipt[1] };
    const payment = path.match(/^\/p\/([^/]+)$/);
    if (payment) return { name: "payment", id: payment[1] };
    const detail = path.match(/^\/paylinks\/([^/]+)$/);
    if (detail) return { name: "detail", id: detail[1] };
    if (path.startsWith("/agent")) return { name: "agent" };
    return { name: "dashboard" };
  }, [path]);

  return (
    <>
      {route.name === "payment" && route.id ? (
        <PublicPaymentPage publicId={route.id} navigate={navigate} setToast={setToast} />
      ) : route.name === "receipt" && route.id ? (
        <ReceiptPage publicId={route.id} navigate={navigate} setToast={setToast} />
      ) : route.name === "detail" && route.id ? (
        <PayLinkDetailPage publicId={route.id} navigate={navigate} setToast={setToast} />
      ) : route.name === "agent" ? (
        <AgentPage data={data} navigate={navigate} />
      ) : (
        <Dashboard data={data} setData={setData} navigate={navigate} setToast={setToast} />
      )}
      <ToastView toast={toast} onClose={() => setToast(undefined)} />
    </>
  );
}
