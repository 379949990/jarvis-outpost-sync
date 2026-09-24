/**
 * 增量同步 main → 本地 vault 文件。
 * Incremental pull into the open vault; no schedule; no git writes.
 */
import { Notice, TFile } from "obsidian";
import type JarvisSyncPlugin from "./main.js";
import {
  apiError,
  formatApiError,
  normalizeApiError,
  vaultFile,
  vaultFilesBatch,
  vaultHead,
  vaultTree,
  type VaultTreeItem,
} from "./api.js";

const MANIFEST_DIR = ".jarvis-sync";
const MANIFEST_PATH = `${MANIFEST_DIR}/manifest.json`;
/** Max paths per batch request. */
const BATCH_MAX_FILES = 40;
/** Soft byte budget per batch request. */
const BATCH_MAX_BYTES = 3.5 * 1024 * 1024;

export type SyncManifest = {
  last_tree_sha: string;
  files: Record<string, string>;
  updated_at?: string;
};

function shouldIgnoreRemotePath(path: string, configDir: string): boolean {
  const p = path.replace(/\\/g, "/");
  const cfg = configDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cfg) return p.startsWith(`${MANIFEST_DIR}/`) || p.includes(`/${MANIFEST_DIR}/`);
  return (
    p.startsWith(`${cfg}/`) ||
    p.includes(`/${cfg}/`) ||
    p.startsWith(`${MANIFEST_DIR}/`) ||
    p.includes(`/${MANIFEST_DIR}/`)
  );
}

function joinVaultSubdir(subdir: string, rel: string): string {
  const base = (subdir || ".").replace(/\\/g, "/").replace(/\/+$/, "");
  const file = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!base || base === ".") return file;
  return `${base}/${file}`;
}

async function readManifest(plugin: JarvisSyncPlugin): Promise<SyncManifest> {
  const adapter = plugin.app.vault.adapter;
  if (!(await adapter.exists(MANIFEST_PATH))) {
    return { last_tree_sha: "", files: {} };
  }
  try {
    const raw = await adapter.read(MANIFEST_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncManifest>;
    return {
      last_tree_sha: parsed.last_tree_sha ?? "",
      files: parsed.files ?? {},
      updated_at: parsed.updated_at,
    };
  } catch {
    return { last_tree_sha: "", files: {} };
  }
}

async function writeManifest(
  plugin: JarvisSyncPlugin,
  manifest: SyncManifest,
): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  if (!(await adapter.exists(MANIFEST_DIR))) {
    await adapter.mkdir(MANIFEST_DIR);
  }
  await adapter.write(
    MANIFEST_PATH,
    JSON.stringify(
      {
        ...manifest,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function ensureParentDirs(
  plugin: JarvisSyncPlugin,
  absPath: string,
): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const parts = absPath.split("/");
  if (parts.length <= 1) return;
  let dir = "";
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    dir = dir ? `${dir}/${part}` : part;
    if (!(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
  }
}

async function writeFileContent(
  plugin: JarvisSyncPlugin,
  absPath: string,
  content: string,
  encoding: "utf-8" | "base64" = "utf-8",
): Promise<void> {
  await ensureParentDirs(plugin, absPath);
  if (encoding === "base64") {
    const binary = base64ToArrayBuffer(content);
    const existing = plugin.app.vault.getAbstractFileByPath(absPath);
    if (existing instanceof TFile) {
      await plugin.app.vault.modifyBinary(existing, binary);
      return;
    }
    await plugin.app.vault.createBinary(absPath, binary);
    return;
  }
  const existing = plugin.app.vault.getAbstractFileByPath(absPath);
  if (existing instanceof TFile) {
    await plugin.app.vault.modify(existing, content);
    return;
  }
  await plugin.app.vault.adapter.write(absPath, content);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 按 tree size + 文件数切批，避免触发服务端 batch_too_large。 */
export function packDownloadBatches(
  paths: string[],
  sizeByPath: Map<string, number>,
): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = sizeByPath.get(path) ?? 0;
    if (size > BATCH_MAX_BYTES) {
      if (cur.length) {
        batches.push(cur);
        cur = [];
        bytes = 0;
      }
      batches.push([path]);
      continue;
    }
    if (
      cur.length > 0 &&
      (cur.length >= BATCH_MAX_FILES || bytes + size > BATCH_MAX_BYTES)
    ) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(path);
    bytes += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function downloadChunkWithRetry(
  withAuthRetry: <T>(fn: () => Promise<T>) => Promise<T>,
  base: string,
  token: string,
  chunk: string[],
): Promise<
  Record<string, { content: string; hash: string; encoding?: "utf-8" | "base64" }>
> {
  if (chunk.length === 0) return {};
  if (chunk.length === 1) {
    const path = chunk[0];
    if (!path) return {};
    try {
      const file = await withAuthRetry(() => vaultFilesBatch(base, token, chunk));
      if (file.files[path]) return file.files;
    } catch (err) {
      const code = normalizeApiError(err).error;
      if (code !== "batch_too_large" && code !== "batch_too_many_files") throw err;
    }
    const single = await withAuthRetry(() => vaultFile(base, token, path));
    return { [path]: single };
  }
  try {
    const batch = await withAuthRetry(() => vaultFilesBatch(base, token, chunk));
    return batch.files;
  } catch (err) {
    const code = normalizeApiError(err).error;
    if (code !== "batch_too_large" && code !== "batch_too_many_files") throw err;
    const mid = Math.ceil(chunk.length / 2);
    const left = await downloadChunkWithRetry(
      withAuthRetry,
      base,
      token,
      chunk.slice(0, mid),
    );
    const right = await downloadChunkWithRetry(
      withAuthRetry,
      base,
      token,
      chunk.slice(mid),
    );
    return { ...left, ...right };
  }
}

export type SyncResult = {
  skipped: boolean;
  updated: number;
  deleted: number;
  treeSha: string;
};

export async function runIncrementalSync(
  plugin: JarvisSyncPlugin,
): Promise<SyncResult> {
  const base = plugin.settings.apiBaseUrl;
  if (!base) throw apiError(0, "api_base_required");
  if (!plugin.settings.deviceToken) {
    throw apiError(0, "not_paired");
  }

  const configDir = plugin.app.vault.configDir;
  let token = plugin.settings.deviceToken;
  const withAuthRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const apiErr = normalizeApiError(err);
      if (apiErr.status === 401 && plugin.settings.refreshToken) {
        token = await plugin.refreshTokenOrThrow();
        return await fn();
      }
      throw err;
    }
  };

  const head = await withAuthRetry(() => vaultHead(base, token));
  const local = await readManifest(plugin);
  if (local.last_tree_sha && local.last_tree_sha === head.tree_sha) {
    return {
      skipped: true,
      updated: 0,
      deleted: 0,
      treeSha: head.tree_sha,
    };
  }

  const remoteItems = (await withAuthRetry(() => vaultTree(base, token))).filter(
    (item) => !shouldIgnoreRemotePath(item.path, configDir),
  );
  const remoteMap = new Map<string, VaultTreeItem>();
  for (const item of remoteItems) remoteMap.set(item.path, item);

  const toDownload: string[] = [];
  const sizeByPath = new Map<string, number>();
  for (const item of remoteItems) {
    sizeByPath.set(item.path, Math.max(0, Number(item.size) || 0));
    if (local.files[item.path] !== item.hash) {
      toDownload.push(item.path);
    }
  }

  const chunks = packDownloadBatches(toDownload, sizeByPath);
  let updated = 0;
  for (const chunk of chunks) {
    const files = await downloadChunkWithRetry(withAuthRetry, base, token, chunk);
    for (const path of chunk) {
      const file = files[path];
      if (!file) continue;
      const abs = joinVaultSubdir(plugin.settings.vaultSubdir, path);
      await writeFileContent(
        plugin,
        abs,
        file.content,
        file.encoding === "base64" ? "base64" : "utf-8",
      );
      local.files[path] = file.hash;
      updated += 1;
    }
  }

  let deleted = 0;
  if (plugin.settings.orphanPolicy === "delete") {
    for (const path of Object.keys(local.files)) {
      if (remoteMap.has(path)) continue;
      if (shouldIgnoreRemotePath(path, configDir)) continue;
      const abs = joinVaultSubdir(plugin.settings.vaultSubdir, path);
      const af = plugin.app.vault.getAbstractFileByPath(abs);
      if (af) {
        await plugin.app.fileManager.trashFile(af);
        deleted += 1;
      }
    }
  }

  const nextFiles: Record<string, string> = {};
  for (const item of remoteItems) {
    nextFiles[item.path] = local.files[item.path] ?? item.hash;
  }

  await writeManifest(plugin, {
    last_tree_sha: head.tree_sha,
    files: nextFiles,
  });

  return {
    skipped: false,
    updated,
    deleted,
    treeSha: head.tree_sha,
  };
}

export function notifySyncResult(result: SyncResult, reason: string): void {
  const why = reason === "startup" ? "启动" : "手动";
  if (result.skipped) {
    new Notice(`Jarvis：已是最新 @${result.treeSha.slice(0, 7)}（${why}）`);
    return;
  }
  const bits = [`更新 ${result.updated} 个`];
  if (result.deleted) bits.push(`删除 ${result.deleted} 个`);
  new Notice(`Jarvis：${bits.join("，")} @${result.treeSha.slice(0, 7)}（${why}）`);
}

export function notifySyncError(err: unknown): void {
  new Notice(`Jarvis：${formatApiError(err)}`, 8000);
}
