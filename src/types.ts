/** Plugin settings; tokens stay in local data.json only. */
export type OrphanPolicy = "keep" | "delete";

export type JarvisSyncSettings = {
  apiBaseUrl: string;
  syncOnStartup: boolean;
  orphanPolicy: OrphanPolicy;
  silentOverwrite: boolean;
  vaultSubdir: string;
  /** device access token（配对后写入；勿 console） */
  deviceToken: string;
  refreshToken: string;
  deviceId: string;
  deviceName: string;
};

export const DEFAULT_SETTINGS: JarvisSyncSettings = {
  apiBaseUrl: "",
  syncOnStartup: true,
  orphanPolicy: "keep",
  silentOverwrite: false,
  vaultSubdir: ".",
  deviceToken: "",
  refreshToken: "",
  deviceId: "",
  deviceName: "",
};
