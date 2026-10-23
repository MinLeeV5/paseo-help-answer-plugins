import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsSection, SettingsCard, SettingsSwitch, SettingsSelect, SettingsInput, SettingsAction } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences } from "../shared/contracts";
import { DEFAULT_PROMPT_TEMPLATE, DEFAULT_SYSTEM_PROMPT } from "../shared/prompt";
import { useReplyTranslation } from "./i18n";

export function ReplySettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [revision, setRevision] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const { locale, t } = useReplyTranslation(draft?.uiLanguage ?? (settings.status === "ready" ? settings.values.uiLanguage : "auto"));
  useEffect(() => {
    if (settings.status === "ready" && !dirty) {
      setDraft(settings.values); setRevision(settings.revision);
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : null, dirty]);
  const change = <Key extends keyof Preferences>(key: Key, value: Preferences[Key]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setDirty(true); setSaved(false);
  };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13 };
  if (settings.status === "invalid") return <View style={{ gap: 12 }}>
    <Text style={muted}>{t("invalidSettings")}</Text>
    <SettingsAction label={t("resetSettings")} actionLabel={t("reset")} onPress={() => void settings.reset()} />
  </View>;
  if (!draft) return <Text style={muted}>{t(settings.status === "error" ? "disconnectedSettings" : "loadingSettings")}</Text>;
  return <View accessibilityLanguage={locale} style={{ gap: 24 }}>
    <Text style={muted}>{t("settingsIntro")}</Text>
    <SettingsSection title={t("appearance")}>
      <SettingsCard>
        <SettingsSelect label={t("uiLanguage")} hint={t("uiLanguageHint")} value={draft.uiLanguage}
          options={[{ label: t("followPaseo"), value: "auto" }, { label: t("chinese"), value: "zh-CN" }, { label: t("english"), value: "en" }]}
          onValueChange={(value) => change("uiLanguage", value)} />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title={t("title")}>
      <SettingsCard>
        <SettingsSwitch label={t("automatic")} hint={t("automaticHint")}
          value={draft.automatic} onValueChange={(value) => change("automatic", value)} />
        <SettingsSelect label={t("count")} value={String(draft.count)}
          options={[2, 3, 4, 5].map((count) => ({ label: t("countOption", { count }), value: String(count) }))}
          onValueChange={(value) => change("count", Number(value))} />
        <SettingsSelect label={t("replyLanguage")} value={draft.language}
          options={[{ label: t("followConversation"), value: "auto" }, { label: t("simplifiedChinese"), value: "zh-CN" }, { label: t("english"), value: "en" }]}
          onValueChange={(value) => change("language", value)} />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title={t("model")} info={t("modelInfo")}>
      <SettingsCard>
        <SettingsInput key={"model-" + revision} label={t("modelOverride")} hint={t("modelOverrideHint")}
          placeholder={t("modelPlaceholder")} initialValue={draft.modelOverride}
          onChangeText={(value) => change("modelOverride", value)} />
        <SettingsInput key={"instructions-" + revision} label={t("instructions")}
          hint={t("instructionsHint")} initialValue={draft.instructions}
          onChangeText={(value) => change("instructions", value)} />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title={t("defaultPrompt")} info={t("defaultPromptInfo")}>
      <ScrollView style={{ maxHeight: 300, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1 }} contentContainerStyle={{ padding: 14 }} nestedScrollEnabled>
        <Text selectable testID="help-answer-default-prompt" accessibilityLanguage="en"
          style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>
          {"SYSTEM\n" + DEFAULT_SYSTEM_PROMPT + "\n\nUSER\n" + DEFAULT_PROMPT_TEMPLATE}
        </Text>
      </ScrollView>
    </SettingsSection>
    <SettingsSection title={t("context")}>
      <SettingsCard>
        <SettingsSelect label={t("history")} value={String(draft.historyTurns)}
          options={[1, 2, 4, 6, 8, 10].map((count) => ({ label: t(count === 1 ? "turn" : "turns", { count }), value: String(count) }))}
          onValueChange={(value) => change("historyTurns", Number(value))} />
        <SettingsSelect label={t("timeout")} value={String(draft.timeoutSeconds)}
          options={[10, 15, 20, 25].map((count) => ({ label: t("seconds", { count }), value: String(count) }))}
          onValueChange={(value) => change("timeoutSeconds", Number(value))} />
      </SettingsCard>
    </SettingsSection>
    <SettingsCard>
      <SettingsAction label={t(settings.saving ? "saving" : saved ? "saved" : "saveSettings")}
        actionLabel={t("save")} disabled={!dirty || settings.saving} onPress={() => void (async () => {
          if (await settings.save(draft, revision)) { setDirty(false); setSaved(true); }
        })()} />
      <SettingsAction label={t("resetSettings")} actionLabel={t("reset")} disabled={settings.saving}
        onPress={() => void (async () => { if (await settings.reset()) { setDirty(false); setSaved(false); } })()} />
    </SettingsCard>
    {settings.saveError && <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
      {settings.saveError}{" "}{t("saveErrorHint")}
    </Text>}
  </View>;
}
