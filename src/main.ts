import { Notice, Plugin } from "obsidian";
import {
  formatApiError,
  normalizeApiError,
  pairWithCode,
  refreshDeviceToken,
  apiError,
} from "./api.js";
import { JarvisSyncSettingTab } from "./settings.js";
import { notifySyncError, notifySyncResult, runIncrementalSync } from "./sync.js";
import { DEFAULT_SETTINGS, type JarvisSyncSettings } from "./types.js";

export const PLUGIN_ID = "jarvis-outpost-sync" as const;

export default class JarvisSyncPlugin extends Plugin {
  settings: JarvisSyncSettings = { ...DEFAULT_SETTINGS };
  private statusEl: HTMLElement | null = null;
  private syncing = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new JarvisSyncSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.setStatus("空闲");

    this.addCommand({
      id: "jarvis-sync-now",
      name: "Jarvis：立即同步",
      callback: () => {
        void this.requestSync("manual");
      },
    });

    this.addRibbonIcon("refresh-cw", "Jarvis 立即同步", () => {
      void this.requestSync("manual");
    });

    if (!this.settings.apiBaseUrl) {
      new Notice("Jarvis：请先在设置中填写 API 地址", 6000);
      this.setStatus("需配置");
    } else if (this.settings.syncOnStartup) {
      void this.requestSync("startup");
    }
  }

  onunload(): void {
    this.statusEl = null;
  }

  setStatus(text: string): void {
    this.statusEl?.setText(`Jarvis：${text}`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<JarvisSyncSettings>,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async clearPairing(): Promise<void> {
    this.settings.deviceToken = "";
    this.settings.refreshToken = "";
    this.settings.deviceId = "";
    await this.saveSettings();
    this.setStatus("未配对");
  }

  async pairWithCode(code: string): Promise<void> {
    if (!this.settings.apiBaseUrl) {
      throw apiError(0, "api_base_required");
    }
    if (!code.trim()) {
      throw apiError(0, "pairing_code_required");
    }
    const result = await pairWithCode(
      this.settings.apiBaseUrl,
      code,
      this.settings.deviceName || "Obsidian",
    );
    this.settings.deviceToken = result.token;
    this.settings.refreshToken = result.refreshToken;
    this.settings.deviceId = result.deviceId;
    if (result.name) this.settings.deviceName = result.name;
    await this.saveSettings();
    this.setStatus("已配对");
  }

  async ensureFreshToken(): Promise<string> {
    if (!this.settings.apiBaseUrl) {
      throw apiError(0, "api_base_required");
    }
    if (!this.settings.deviceToken) {
      throw apiError(0, "not_paired");
    }
    return this.settings.deviceToken;
  }

  async refreshTokenOrThrow(): Promise<string> {
    if (!this.settings.apiBaseUrl || !this.settings.refreshToken) {
      throw apiError(401, "unauthorized");
    }
    const result = await refreshDeviceToken(
      this.settings.apiBaseUrl,
      this.settings.refreshToken,
    );
    this.settings.deviceToken = result.token;
    this.settings.refreshToken = result.refreshToken;
    this.settings.deviceId = result.deviceId;
    await this.saveSettings();
    return result.token;
  }

  async requestSync(reason: "startup" | "manual"): Promise<void> {
    if (!this.settings.apiBaseUrl) {
      new Notice("Jarvis：请先填写 API 地址");
      this.setStatus("需配置");
      return;
    }
    if (!this.settings.deviceToken) {
      new Notice("Jarvis：尚未配对，请在设置中粘贴配对码");
      this.setStatus("未配对");
      return;
    }
    if (this.syncing) {
      new Notice("Jarvis：同步进行中");
      return;
    }
    this.syncing = true;
    this.setStatus("同步中…");
    try {
      const result = await runIncrementalSync(this);
      notifySyncResult(result, reason);
      this.setStatus(
        result.skipped
          ? `已是最新 @${result.treeSha.slice(0, 7)}`
          : `已更新 ${result.updated} 个文件`,
      );
    } catch (err) {
      notifySyncError(err);
      const apiErr = normalizeApiError(err);
      this.setStatus(apiErr.status === 401 ? "授权失效" : formatApiError(apiErr));
    } finally {
      this.syncing = false;
    }
  }
}
