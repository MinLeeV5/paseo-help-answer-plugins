import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReplyManager } from "./client/manager";
import { ReplySettings } from "./client/settings";
import { hasDesktopDom } from "./client/web";
import { messages } from "./client/i18n";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({ id: "preferences", title: messages.message("title"), icon: "MessageCircle", Component: ReplySettings });
  if (!hasDesktopDom()) return removeSettings;
  const manager = new ReplyManager(client);
  void manager.start();
  return () => { removeSettings(); return manager.dispose(); };
}
