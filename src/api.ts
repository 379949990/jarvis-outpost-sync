/** HTTP client for the self-hosted Outpost API (device token; no token logging). */

import { requestUrl } from "obsidian";

export type ApiError = {
  status: number;
  error: string;
};

/** 可 throw 的 API 错误（满足 only-throw-error） */
export class JarvisApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "JarvisApiError";
    this.status = status;
    this.code = code;
  }
}

export function apiError(status: number, code: string): JarvisApiError {
  return new JarvisApiError(status, code);
}

const ERROR_LABEL: Record<string, string> = {
  pairing_disabled: "服务器已关闭新配对",
  pairing_code_expired: "配对码已过期，请在 PWA 重新生成",
  pairing_code_used: "配对码已使用",
  invalid_pairing_code: "配对码无效",
  invalid_body: "请求无效",
  state_unconfigured: "服务器状态库未就绪",
  unauthorized: "授权已失效，请重新配对",
  api_base_required: "请先填写 API 地址",
  pairing_code_required: "请输入配对码",
  not_paired: "尚未配对",
  pair_failed: "配对失败",
  pair_incomplete: "配对响应不完整",
  refresh_failed: "刷新授权失败",
  refresh_incomplete: "刷新响应不完整",
  head_failed: "读取版本失败",
  head_incomplete: "版本响应不完整",
  tree_failed: "读取文件列表失败",
  batch_failed: "下载文件失败",
  batch_too_large: "单批文件过大，请重试同步（将自动缩小批次）",
  batch_too_many_files: "单批文件过多，请重试同步",
  network_error: "无法连接 API（请确认地址正确且服务已启动）",
  unknown_error: "未知错误",
};

export function normalizeApiError(err: unknown): ApiError {
  if (err instanceof JarvisApiError) {
    return { status: err.status, error: err.code };
  }
  if (err && typeof err === "object") {
    const o = err as { status?: unknown; error?: unknown; code?: unknown };
    if (typeof o.error === "string" && o.error.trim()) {
      const status =
        typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0;
      return { status, error: o.error.trim() };
    }
    if (typeof o.code === "string" && o.code.trim()) {
      const status =
        typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0;
      return { status, error: o.code.trim() };
    }
  }
  if (err instanceof TypeError || err instanceof Error) {
    return { status: 0, error: "network_error" };
  }
  return { status: 0, error: "unknown_error" };
}

export function formatApiError(err: unknown): string {
  const e = normalizeApiError(err);
  const label = ERROR_LABEL[e.error] ?? e.error;
  if (e.status === 0) return label;
  return `${label}（HTTP ${e.status}）`;
}

async function apiJson(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const res = await requestUrl({
      url: opts.url,
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      throw: false,
    });
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = res.json;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } catch {
    throw apiError(0, "network_error");
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
}

export type PairResult = {
  deviceId: string;
  token: string;
  refreshToken: string;
  name: string;
};

export async function pairWithCode(
  apiBaseUrl: string,
  code: string,
  deviceName: string,
): Promise<PairResult> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/auth/pair`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      code: code.trim(),
      deviceName: deviceName || undefined,
    }),
  });
  if (status < 200 || status >= 300) {
    throw apiError(status, typeof body.error === "string" ? body.error : "pair_failed");
  }
  const token = typeof body.token === "string" ? body.token : "";
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!token || !refreshToken || !deviceId) {
    throw apiError(status, "pair_incomplete");
  }
  return {
    deviceId,
    token,
    refreshToken,
    name: typeof body.name === "string" ? body.name : deviceName,
  };
}

export async function refreshDeviceToken(
  apiBaseUrl: string,
  refreshToken: string,
): Promise<PairResult> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/auth/token/refresh`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ refreshToken }),
  });
  if (status < 200 || status >= 300) {
    throw apiError(
      status,
      typeof body.error === "string" ? body.error : "refresh_failed",
    );
  }
  const token = typeof body.token === "string" ? body.token : "";
  const nextRefresh = typeof body.refreshToken === "string" ? body.refreshToken : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!token || !nextRefresh || !deviceId) {
    throw apiError(status, "refresh_incomplete");
  }
  return {
    deviceId,
    token,
    refreshToken: nextRefresh,
    name: typeof body.name === "string" ? body.name : "",
  };
}

export type VaultHead = { tree_sha: string; commit_sha: string };

export async function vaultHead(apiBaseUrl: string, token: string): Promise<VaultHead> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/vault/head`,
    headers: authHeaders(token),
  });
  if (status < 200 || status >= 300) {
    throw apiError(
      status,
      typeof body.error === "string"
        ? body.error
        : status === 401
          ? "unauthorized"
          : "head_failed",
    );
  }
  const tree_sha = typeof body.tree_sha === "string" ? body.tree_sha : "";
  if (!tree_sha) {
    throw apiError(status, "head_incomplete");
  }
  return {
    tree_sha,
    commit_sha: typeof body.commit_sha === "string" ? body.commit_sha : "",
  };
}

export type VaultTreeItem = { path: string; hash: string; size: number };

export async function vaultTree(
  apiBaseUrl: string,
  token: string,
): Promise<VaultTreeItem[]> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/vault/tree`,
    headers: authHeaders(token),
  });
  if (status < 200 || status >= 300) {
    throw apiError(
      status,
      typeof body.error === "string"
        ? body.error
        : status === 401
          ? "unauthorized"
          : "tree_failed",
    );
  }
  return Array.isArray(body.items) ? (body.items as VaultTreeItem[]) : [];
}

export async function vaultFile(
  apiBaseUrl: string,
  token: string,
  path: string,
): Promise<{ content: string; hash: string }> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/vault/file?path=${encodeURIComponent(path)}`,
    headers: authHeaders(token),
  });
  if (status < 200 || status >= 300) {
    throw apiError(
      status,
      typeof body.error === "string"
        ? body.error
        : status === 401
          ? "unauthorized"
          : "batch_failed",
    );
  }
  return {
    content: typeof body.content === "string" ? body.content : "",
    hash: typeof body.hash === "string" ? body.hash : "",
  };
}

export async function vaultFilesBatch(
  apiBaseUrl: string,
  token: string,
  paths: string[],
): Promise<{
  files: Record<string, { content: string; hash: string }>;
  missing: string[];
}> {
  const { status, body } = await apiJson({
    url: `${apiBaseUrl}/api/vault/files:batch`,
    method: "POST",
    headers: {
      ...authHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify({ paths }),
  });
  if (status < 200 || status >= 300) {
    throw apiError(
      status,
      typeof body.error === "string"
        ? body.error
        : status === 401
          ? "unauthorized"
          : "batch_failed",
    );
  }
  return {
    files:
      body.files && typeof body.files === "object"
        ? (body.files as Record<string, { content: string; hash: string }>)
        : {},
    missing: Array.isArray(body.missing) ? (body.missing as string[]) : [],
  };
}
