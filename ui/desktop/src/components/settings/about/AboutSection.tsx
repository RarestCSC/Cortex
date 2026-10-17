import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import CortexIcon from '../../CortexIcon';
import { Button } from '../../ui/button';
import type { AppInfo } from '../../../types/appInfo';
import { defineMessages, useIntl } from '../../../i18n';

const i18n = defineMessages({
  version: { id: 'aboutSection.version', defaultMessage: 'Version' },
  author: { id: 'aboutSection.author', defaultMessage: 'Author' },
  runtime: { id: 'aboutSection.runtime', defaultMessage: 'Runtime' },
  electron: { id: 'aboutSection.electron', defaultMessage: 'Electron' },
  chrome: { id: 'aboutSection.chrome', defaultMessage: 'Chromium' },
  node: { id: 'aboutSection.node', defaultMessage: 'Node.js' },
  platform: { id: 'aboutSection.platform', defaultMessage: 'Platform' },
  paths: { id: 'aboutSection.paths', defaultMessage: 'Data & configuration' },
  pathRoot: { id: 'aboutSection.pathRoot', defaultMessage: 'Path root' },
  configDir: { id: 'aboutSection.configDir', defaultMessage: 'Config directory' },
  dataDir: { id: 'aboutSection.dataDir', defaultMessage: 'Data directory' },
  copy: { id: 'aboutSection.copy', defaultMessage: 'Copy' },
  copied: { id: 'aboutSection.copied', defaultMessage: 'Copied' },
  licenseTitle: { id: 'aboutSection.licenseTitle', defaultMessage: 'License' },
  licenseBody: {
    id: 'aboutSection.licenseBody',
    defaultMessage:
      'Cortex is distributed under the Apache License 2.0. It began as a fork of the Goose project; the original Apache-2.0 and MIT notices are retained.',
  },
  independentTitle: { id: 'aboutSection.independentTitle', defaultMessage: 'Independent build' },
  independentBody: {
    id: 'aboutSection.independentBody',
    defaultMessage:
      'This build is maintained on its own. It does not phone home, has no telemetry, and does not check for updates. Your model providers and MCP servers still reach the network as you configure them.',
  },
  compatTitle: { id: 'aboutSection.compatTitle', defaultMessage: 'Compatibility note' },
  compatBody: {
    id: 'aboutSection.compatBody',
    defaultMessage:
      'The GOOSE_* environment variables and goose_* configuration keys are kept unchanged on purpose: they are a public interface, so existing setups keep working.',
  },
});

const AUTHOR = 'rarestcsc';

function CopyablePath({ label, value }: { label: string; value: string }) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-secondary">{label}</p>
        <code className="break-all text-sm text-text-primary">{value}</code>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {intl.formatMessage(copied ? i18n.copied : i18n.copy)}
      </Button>
    </div>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-text-primary">{title}</h2>
      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-3 text-sm">
            <dt className="w-40 flex-shrink-0 text-text-secondary">{row.label}</dt>
            <dd className="min-w-0 flex-1 break-words text-text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Paragraph({ title, body }: { title: string; body: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium text-text-primary">{title}</h2>
      <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
    </section>
  );
}

export default function AboutSection() {
  const intl = useIntl();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    setInfo(window.electron.getAppInfo());
  }, []);

  return (
    <div className="max-w-3xl space-y-10 pb-8">
      <div className="flex items-center gap-5">
        <CortexIcon size="default" hover={false} />
        <div>
          <h2 className="text-2xl font-light text-text-primary">Cortex</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {intl.formatMessage(i18n.version)} {info?.version ?? '—'}
          </p>
          <p className="text-sm text-text-secondary">
            {intl.formatMessage(i18n.author)} {AUTHOR}
          </p>
        </div>
      </div>

      {info && (
        <>
          <Section
            title={intl.formatMessage(i18n.runtime)}
            rows={[
              {
                label: intl.formatMessage(i18n.electron),
                value: `${info.electron} · ${intl.formatMessage(i18n.chrome)} ${info.chrome} · ${intl.formatMessage(i18n.node)} ${info.node}`,
              },
              {
                label: intl.formatMessage(i18n.platform),
                value: `${info.platform} ${info.arch}`,
              },
            ]}
          />

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-text-primary">
              {intl.formatMessage(i18n.paths)}
            </h2>
            {info.pathRoot && (
              <CopyablePath
                label={intl.formatMessage(i18n.pathRoot)}
                value={info.pathRoot}
              />
            )}
            <CopyablePath
              label={intl.formatMessage(i18n.configDir)}
              value={info.configDir}
            />
            <CopyablePath label={intl.formatMessage(i18n.dataDir)} value={info.dataDir} />
          </section>
        </>
      )}

      <Paragraph
        title={intl.formatMessage(i18n.independentTitle)}
        body={intl.formatMessage(i18n.independentBody)}
      />
      <Paragraph
        title={intl.formatMessage(i18n.compatTitle)}
        body={intl.formatMessage(i18n.compatBody)}
      />
      <Paragraph
        title={intl.formatMessage(i18n.licenseTitle)}
        body={intl.formatMessage(i18n.licenseBody)}
      />
    </div>
  );
}