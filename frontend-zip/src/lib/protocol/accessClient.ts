import type { SegmentManifest, StreamManifest } from './manifest';

export interface HealthResponse {
  status: string;
  requestId: string;
  ready: boolean;
  service: string;
  mode: 'simulation' | 'onchain' | 'on-chain';
  isSimulation: boolean;
  simulation: boolean;
  timestamp: string;
  chainId: number;
  settlement: string | null;
  activeSettlement: string | null;
  config: { network: string; mode: string; settlementAddress: string; corsOrigin: string; requireOnChainSession: boolean };
  chain: { configured: boolean; settlementAddress: string | null; network: string; mode: string };
  availableStreams: string[];
}

export interface SegmentAccessRequest {
  sessionId: `0x${string}`;
  sessionSigner: `0x${string}`;
  recipient: `0x${string}`;
  contractAddress: `0x${string}`;
  chainId: number;
  streamId: string;
  segmentIndex: number;
  voucher: { sessionId: `0x${string}`; cumulativeUnits: string; signature: `0x${string}` };
}

export interface SegmentAccessResponse {
  success: boolean;
  granted: boolean;
  sessionId: string;
  segmentIndex: number;
  cumulativeUnits: string;
  segmentToken: string;
  contentUrl: string;
  error?: string;
  code?: string;
}

export interface CheckpointSyncResponse { success: boolean; settledUnits?: string; error?: string }

function apiError(status: number, data: unknown): Error {
  const body = data as { error?: string; reason?: string; message?: string; code?: string; requestId?: string };
  const detail = body.message || body.error || `Access service HTTP ${status}`;
  const reason = body.reason ? ` (${body.reason})` : '';
  const requestId = body.requestId ? ` [request ${body.requestId}]` : '';
  return new Error(`${body.code ? `${body.code}: ` : ''}${detail}${reason}${requestId}`);
}

export class AccessServiceClient {
  private baseUrl: string;
  private dynamicManifestCache = new Map<string, StreamManifest>();

  constructor(baseUrl = import.meta.env?.VITE_ACCESS_SERVICE_URL || 'http://localhost:4001') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  getBaseUrl(): string { return this.baseUrl; }
  setBaseUrl(url: string): void { this.baseUrl = url.replace(/\/+$/, ''); this.dynamicManifestCache.clear(); }

  async getHealth(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, data);
    return data as HealthResponse;
  }

  async getManifest(streamId: string): Promise<StreamManifest> {
    const cached = this.dynamicManifestCache.get(streamId);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/api/manifest/${encodeURIComponent(streamId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, data);
    const manifest = data as StreamManifest;
    this.dynamicManifestCache.set(streamId, manifest);
    return manifest;
  }

  async getSegmentProof(streamId: string, index: number): Promise<{ segment: SegmentManifest; proof: `0x${string}`[]; manifestRoot: `0x${string}`; merkleRoot: `0x${string}` }> {
    const res = await fetch(`${this.baseUrl}/api/manifest/${encodeURIComponent(streamId)}/segment/${index}/proof`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, data);
    return data;
  }

  async requestSegmentAccess(body: SegmentAccessRequest): Promise<SegmentAccessResponse> {
    const res = await fetch(`${this.baseUrl}/api/access/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.granted) throw apiError(res.status, data);
    return data as SegmentAccessResponse;
  }

  async fetchGatedContent(streamId: string, segmentIndex: number, token: string, contentUrl?: string): Promise<{ data: Uint8Array; byteLength: number; mimeType: string }> {
    const url = contentUrl ? `${this.baseUrl}${contentUrl}` : `${this.baseUrl}/api/access/content/${encodeURIComponent(streamId)}/segment_${segmentIndex}.ts?token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw apiError(res.status, await res.json().catch(() => ({})));
    const data = new Uint8Array(await res.arrayBuffer());
    return { data, byteLength: data.byteLength, mimeType: res.headers.get('content-type') || 'video/mp2t' };
  }

  async checkpointSync(sessionId: `0x${string}`, settledUnits?: number): Promise<CheckpointSyncResponse> {
    const res = await fetch(`${this.baseUrl}/api/session/checkpoint-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, settledUnits }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw apiError(res.status, data);
    return data as CheckpointSyncResponse;
  }
}

export const accessService = new AccessServiceClient();
