import { Eye, EyeOff, Save, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { applyPreset, PROVIDER_PRESETS } from '@/lib/ai/settings';
import type { AiSettings } from '@/lib/types';

export function AiSettingsPanel({
  settings,
  onClose,
  onSave,
  onTestConnection,
  testing,
  testResult,
}: {
  settings: AiSettings;
  onClose?: () => void;
  onSave: (next: AiSettings) => Promise<boolean>;
  onTestConnection: (next: AiSettings) => Promise<{ ok: boolean; message: string }>;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}) {
  const [draft, setDraft] = useState<AiSettings>({ ...settings });
  const [showKey, setShowKey] = useState(false);
  const [saveError, setSaveError] = useState('');

  function handleProviderChange(provider: string) {
    setDraft(applyPreset(draft, provider as AiSettings['provider']));
  }

  async function handleSave() {
    setSaveError('');
    const ok = await onSave(draft);
    if (ok) {
      onClose?.();
      return;
    }
    setSaveError('Provider permission was not granted.');
  }

  const canTest =
    draft.apiKey.trim() !== '' &&
    draft.baseUrl.trim() !== '' &&
    draft.model.trim() !== '';

  return (
    <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-deep" aria-hidden="true" />
          <p className="text-sm font-medium text-ink tracking-[2px]">AI 设置</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink-secondary"
          >
            关闭
          </button>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            className="rounded-sm"
          />
          启用 AI 释义
        </label>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Provider</label>
          <select
            value={draft.provider}
            onChange={(event) => handleProviderChange(event.target.value)}
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-fade"
          >
            {PROVIDER_PRESETS.map((preset) => (
              <option key={preset.provider} value={preset.provider}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">API Key</label>
          <div className="flex gap-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder="sk-..."
              className="flex-1 rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-fade"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="rounded-sm border border-border bg-paper-input p-1.5 text-muted hover:text-ink-secondary"
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>
          <p className="mt-0.5 text-[10px] text-muted">
            Key 存储在本地，仅发送至您选择的 provider。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Base URL</label>
          <input
            type="url"
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="https://api.deepseek.com"
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-fade"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Model</label>
          <input
            type="text"
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            placeholder="deepseek-v4-flash"
            className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-fade"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm tracking-[1px] transition hover:brightness-95"
          >
            <Save className="h-3 w-3" /> 保存
          </button>
          <button
            type="button"
            onClick={() => void onTestConnection(draft)}
            disabled={testing || !canTest}
            className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:opacity-50"
          >
            {testing ? (
              '...'
            ) : testResult ? (
              testResult.ok ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />
            ) : (
              <Wifi className="h-3 w-3" />
            )}
            测试连接
          </button>
          {testResult && (
            <span className={`text-[11px] ${testResult.ok ? 'text-ink-secondary' : 'text-accent-deep'}`}>
              {testResult.message}
            </span>
          )}
          {saveError && <span className="text-[11px] text-accent-deep">{saveError}</span>}
        </div>
      </div>
    </section>
  );
}
