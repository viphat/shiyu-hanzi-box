import { ArrowLeft, Database, Download, Globe2, KeyRound, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import iconUrl from '../../assets/icon.png';
import { DEFAULT_AI_SETTINGS, getAiSettings, setAiApiKey, setAiSettings } from '@/lib/ai/settings';
import { buildIndex } from '@/lib/dictionary';
import { t } from '@/lib/i18n';
import { hashKaikkiEntries, isAllowedKaikkiUrl, parseKaikkiJsonl } from '@/lib/kaikki';
import { clearKaikkiCache, setKaikkiCache } from '@/lib/kaikki-cache';
import {
  DEFAULT_KAIKKI_SOURCE_URL,
  enableKaikki,
  recordKaikkiImport,
  resetKaikki,
  setUiLocale,
} from '@/lib/settings';
import type { UiLocale } from '@/lib/types';
import { useSettings } from '../newtab/hooks/useSettings';

type Message = { tone: 'success' | 'error'; text: string } | null;

export function SettingsApp() {
  const { settings, loading, mutate } = useSettings();
  const locale = settings.uiLocale;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState(settings.kaikki.sourceUrl);
  const [aiSettings, setAiSettingsState] = useState(DEFAULT_AI_SETTINGS);
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState(DEFAULT_AI_SETTINGS.apiKey);
  const [savingAiKey, setSavingAiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    setSourceUrl(settings.kaikki.sourceUrl);
  }, [settings.kaikki.sourceUrl]);

  useEffect(() => {
    let mounted = true;
    getAiSettings().then((next) => {
      if (!mounted) return;
      setAiSettingsState(next);
      setAiApiKeyDraft(next.apiKey);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen p-8 text-sm text-ink-secondary">{t('zh-CN', 'app.loading')}</div>;
  }

  async function updateLocale(uiLocale: UiLocale) {
    await mutate((current) => setUiLocale(current, uiLocale));
    setMessage({ tone: 'success', text: t(uiLocale, 'settings.saved') });
  }

  async function updateKaikkiEnabled(enabled: boolean) {
    await mutate((current) => enableKaikki(current, enabled));
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await importText(await file.text(), {
      sourceUrl: sourceUrl || settings.kaikki.sourceUrl,
      sourceName: file.name,
    });
  }

  async function downloadKaikki() {
    if (!isAllowedKaikkiUrl(sourceUrl)) {
      setMessage({ tone: 'error', text: t(locale, 'settings.invalidKaikkiUrl') });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const granted = await browser.permissions.request({
        origins: ['https://kaikki.org/*'],
      });
      if (!granted) {
        setMessage({ tone: 'error', text: t(locale, 'settings.permissionDenied') });
        return;
      }

      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await importText(await response.text(), {
        sourceUrl,
        sourceName: 'Kaikki Chinese',
      });
    } catch {
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    } finally {
      setBusy(false);
    }
  }

  async function importText(
    text: string,
    source: { sourceUrl: string; sourceName: string },
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = parseKaikkiJsonl(text);
      if (parsed.entries.length === 0) {
        throw new Error('No usable Chinese entries found');
      }
      const hash = hashKaikkiEntries(parsed.entries);
      await setKaikkiCache(hash, buildIndex(parsed.entries));
      await mutate((current) =>
        recordKaikkiImport(current, {
          sourceUrl: source.sourceUrl,
          sourceName: source.sourceName,
          hash,
          entryCount: parsed.entries.length,
          importedAt: Date.now(),
        }),
      );
      setMessage({
        tone: 'success',
        text: `${t(locale, 'settings.ready')}: ${parsed.entries.length}`,
      });
    } catch {
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    } finally {
      setBusy(false);
    }
  }

  async function removeKaikki() {
    const hash = settings.kaikki.hash;
    if (hash) await clearKaikkiCache(hash);
    await mutate((current) => resetKaikki(current));
    setSourceUrl(DEFAULT_KAIKKI_SOURCE_URL);
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  async function saveAiApiKey() {
    setSavingAiKey(true);
    setMessage(null);
    try {
      const next = setAiApiKey(aiSettings, aiApiKeyDraft);
      await setAiSettings(next);
      setAiSettingsState(next);
      setAiApiKeyDraft(next.apiKey);
      setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
    } catch {
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    } finally {
      setSavingAiKey(false);
    }
  }

  return (
    <div className="min-h-screen text-ink">
      <header className="cinnabar-header-accent border-b-2 border-border-strong bg-paper-light">
        <div className="mx-auto max-w-4xl px-5 py-6">
          <a
            href={browser.runtime.getURL('/newtab.html')}
            className="mb-5 inline-flex items-center gap-1 text-xs text-muted hover:text-cinnabar"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t(locale, 'settings.back')}
          </a>
          <div className="flex items-center gap-3">
            <img src={iconUrl} alt="" className="h-11 w-11 rounded-sm" aria-hidden="true" />
            <div>
              <h1 className="text-[26px] font-bold leading-none text-ink tracking-[5px]">
                {t(locale, 'settings.title')}
              </h1>
              <p className="mt-2 text-xs leading-6 text-muted tracking-[1px]">
                {t(locale, 'settings.kaikkiBody')}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-5 py-6">
        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.language')}</h2>
          </div>
          <select
            value={locale}
            onChange={(event) => updateLocale(event.target.value as UiLocale)}
            className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.defaultDictionary')}</h2>
          </div>
          <p className="text-xs leading-6 text-muted">{t(locale, 'settings.defaultDictionaryBody')}</p>
          <a
            href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-muted hover:text-cinnabar"
          >
            {t(locale, 'dictionary.ccCedict')}
          </a>
        </section>

        <AiApiKeySection
          locale={locale}
          apiKey={aiApiKeyDraft}
          saving={savingAiKey}
          onApiKeyChange={setAiApiKeyDraft}
          onSave={saveAiApiKey}
        />

        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'dictionary.kaikki')}</h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.kaikkiBody')}</p>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={settings.kaikki.enabled}
              onChange={(event) => updateKaikkiEnabled(event.target.checked)}
              className="h-4 w-4 accent-cinnabar"
            />
            {t(locale, 'settings.enableKaikki')}
          </label>
          <label className="block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.sourceUrl')}
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,application/jsonl,application/json,text/plain"
              className="hidden"
              onChange={importFile}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {t(locale, 'settings.importFile')}
            </button>
            <button
              onClick={downloadKaikki}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2.5 text-sm text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {busy ? t(locale, 'settings.processing') : t(locale, 'settings.download')}
            </button>
            <button
              onClick={removeKaikki}
              disabled={busy || !settings.kaikki.hash}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {t(locale, 'settings.removeKaikki')}
            </button>
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.importedEntries')}</dt>
              <dd className="mt-0.5 text-ink-secondary">{settings.kaikki.entryCount || t(locale, 'settings.notImported')}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>Hash</dt>
              <dd className="mt-0.5 truncate text-ink-secondary">{settings.kaikki.hash ?? '-'}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.ready')}</dt>
              <dd className="mt-0.5 text-ink-secondary">
                {settings.kaikki.importedAt
                  ? new Intl.DateTimeFormat(locale).format(new Date(settings.kaikki.importedAt))
                  : t(locale, 'settings.notImported')}
              </dd>
            </div>
          </dl>
        </section>

        {message ? (
          <p
            role="status"
            className={`text-xs tracking-[1px] ${message.tone === 'error' ? 'text-cinnabar' : 'text-ink-secondary'}`}
          >
            {message.text}
          </p>
        ) : null}
      </main>
    </div>
  );
}

export function AiApiKeySection({
  locale,
  apiKey,
  saving,
  onApiKeyChange,
  onSave,
}: {
  locale: UiLocale;
  apiKey: string;
  saving: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onSave: () => void | Promise<void>;
}) {
  return (
    <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-cinnabar" />
        <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.aiTitle')}</h2>
      </div>
      <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.aiBody')}</p>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <label className="block flex-1 text-xs font-medium tracking-[1px] text-muted">
          {t(locale, 'settings.aiApiKey')}
          <input
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={t(locale, 'settings.aiApiKeyPlaceholder')}
            autoComplete="off"
            className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-1 rounded-sm bg-cinnabar px-3 py-2.5 text-sm text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? t(locale, 'settings.saving') : t(locale, 'settings.saveApiKey')}
        </button>
      </form>
      <p className="mt-2 text-[11px] leading-5 text-muted">{t(locale, 'settings.aiKeyHelp')}</p>
    </section>
  );
}
