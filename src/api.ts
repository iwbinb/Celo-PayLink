import { CreatePayLinkInput, DashboardResponse, PayLinkDetail } from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  async dashboard(): Promise<DashboardResponse> {
    return request<DashboardResponse>("/api/paylinks");
  },

  async createPayLink(input: CreatePayLinkInput): Promise<PayLinkDetail> {
    return request<PayLinkDetail>("/api/paylinks", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async getPayLink(publicId: string): Promise<PayLinkDetail> {
    return request<PayLinkDetail>(`/api/paylinks/${publicId}`);
  },

  async submitAttempt(publicId: string, txHash: string) {
    return request(`/api/paylinks/${publicId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ txHash })
    });
  },

  async verify(publicId: string, txHash: string): Promise<PayLinkDetail> {
    return request<PayLinkDetail>(`/api/paylinks/${publicId}/verify`, {
      method: "POST",
      body: JSON.stringify({ txHash })
    });
  },

  async parseAgent(input: string) {
    return request<Partial<CreatePayLinkInput>>("/api/agent/parse", {
      method: "POST",
      body: JSON.stringify({ input })
    });
  },

  async agentProfile() {
    return request("/api/agent/profile");
  }
};
