import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type JarvisSyncPlugin from "./main.js";
import { formatApiError } from "./api.js";

/** Settings tab (Obsidian ≥1.13 declarative definitions). */
export class JarvisSyncSettingTab extends PluginSettingTab {
  plugin: JarvisSyncPlugin;
  private pairingCode = "";

  constructor(app: App, plugin: JarvisSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    let next = value;
    if (key === "apiBaseUrl" && typeof next === "string") {
      next = next.trim().replace(/\/+$/, "");
    } else if (key === "deviceName" && typeof next === "string") {
      next = next.trim();
    } else if (key === "vaultSubdir" && typeof next === "string") {
      next = next.trim() || ".";
    }
    await super.setControlValue(key, next);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const paired = Boolean(this.plugin.settings.deviceToken);
    const pairedDesc = paired
      ? `已配对${this.plugin.settings.deviceId ? `（${this.plugin.settings.deviceId.slice(0, 8)}…）` : ""}。可在 PWA 吊销。`
      : "未配对";

    return [
      {
        type: "group",
        heading: "Jarvis 同步",
        items: [
          {
            name: "关于",
            desc: "只读同步服务器上的笔记。在 PWA「设置」生成配对码后粘贴到下方。",
          },
          {
            name: "API 地址",
            desc: "本机调试：https://your-host.example（无尾斜杠）",
            control: {
              type: "text",
              key: "apiBaseUrl",
              placeholder: "https://your-host.example",
            },
          },
          {
            name: "设备名称",
            desc: "显示在 PWA 设备列表",
            control: {
              type: "text",
              key: "deviceName",
              placeholder: "Obsidian",
            },
          },
          {
            name: "配对状态",
            desc: pairedDesc,
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setButtonText(paired ? "清除本地授权" : "—")
                  .setDisabled(!paired)
                  .onClick(async () => {
                    if (!paired) return;
                    await this.plugin.clearPairing();
                    new Notice("Jarvis：已清除本地授权");
                    this.update();
                  }),
              );
            },
          },
          {
            name: "配对码",
            desc: "PWA 设置页生成，短时有效",
            render: (setting) => {
              setting
                .addText((text) =>
                  text
                    .setPlaceholder("ABCD-1234")
                    .setValue(this.pairingCode)
                    .onChange((value) => {
                      this.pairingCode = value.trim();
                    }),
                )
                .addButton((btn) =>
                  btn
                    .setButtonText("配对")
                    .setCta()
                    .onClick(async () => {
                      try {
                        await this.plugin.pairWithCode(this.pairingCode);
                        this.pairingCode = "";
                        new Notice("Jarvis：配对成功");
                        this.update();
                      } catch (err) {
                        new Notice(`Jarvis：${formatApiError(err)}`, 8000);
                      }
                    }),
                );
            },
          },
          {
            name: "启动时同步",
            desc: "打开库时自动拉一次更新",
            control: {
              type: "toggle",
              key: "syncOnStartup",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "高级",
        items: [
          {
            name: "写入子目录",
            desc: "相对本库根；打开知识根时填「.」",
            control: {
              type: "text",
              key: "vaultSubdir",
              placeholder: ".",
            },
          },
          {
            name: "远端已删文件",
            desc: "本地仍留着的旧文件怎么处理",
            control: {
              type: "dropdown",
              key: "orphanPolicy",
              options: {
                keep: "保留",
                delete: "删除",
              },
            },
          },
        ],
      },
    ];
  }
}
