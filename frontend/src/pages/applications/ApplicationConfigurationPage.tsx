import { KeyRound, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { Dialog } from '../../components/dialogs/Dialog';
import { UnsavedChangesDialog } from '../../components/dialogs/UnsavedChangesDialog';
import { Alert } from '../../components/feedback/Alert';
import { CardSkeleton } from '../../components/feedback/CardSkeleton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { Button } from '../../components/forms/Button';
import { SelectField, TextField } from '../../components/forms/Field';
import { FormErrorSummary } from '../../components/forms/FormErrorSummary';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { RelativeTime } from '../../components/status/RelativeTime';
import { useApi, useDemoMode } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useMutation } from '../../hooks/useMutation';
import { useResource } from '../../hooks/useResource';
import { useToast } from '../../hooks/useToast';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import type { ApplicationConfiguration, UpdateConfigurationRequest } from '../../types/api';
import { randomId } from '../../utils/id';
import { messages, simulated } from '../../utils/messages';
import { CPU_OPTIONS, MEMORY_OPTIONS } from '../../utils/providers';
import { envVarName, healthCheckPath, integerInRange, looksSecret } from '../../utils/validation';
import { AccessDeniedPage } from '../errors/AccessDeniedPage';
import { ApplicationNotFound } from './ApplicationsPage';
import { ApplicationSubNav } from './ApplicationSubNav';
import './applications.css';

interface EnvRow {
  key: string;
  name: string;
  value: string;
}

interface Draft {
  port: string;
  cpu: string;
  memory: string;
  min_instances: string;
  max_instances: string;
  health_check_path: string;
  environment: EnvRow[];
}

function toDraft(config: ApplicationConfiguration): Draft {
  return {
    port: String(config.port),
    cpu: config.cpu,
    memory: config.memory,
    min_instances: String(config.min_instances),
    max_instances: String(config.max_instances),
    health_check_path: config.health_check_path ?? '',
    environment: config.environment.map((e) => ({ key: randomId(), name: e.name, value: e.value })),
  };
}

function comparable(d: Draft) {
  return JSON.stringify({ ...d, environment: d.environment.map(({ name, value }) => ({ name, value })) });
}

type Errors = Partial<Record<string, string>>;

function validate(d: Draft): Errors {
  const errors: Errors = {};
  const set = (key: string, message: string | null) => {
    if (message) errors[key] = message;
  };
  set('port', integerInRange('Port', 1, 65535)(d.port));
  set('min_instances', integerInRange('Minimum instances', 0, 25)(d.min_instances));
  set('max_instances', integerInRange('Maximum instances', 1, 25)(d.max_instances));
  if (!errors.min_instances && !errors.max_instances && Number(d.min_instances) > Number(d.max_instances)) {
    errors.max_instances = 'Maximum instances must be at least the minimum.';
  }
  set('health_check_path', healthCheckPath(d.health_check_path));
  const seen = new Set<string>();
  d.environment.forEach((row, i) => {
    const nameError = envVarName(row.name);
    if (nameError) errors[`environment.${i}.name`] = `Variable ${i + 1}: ${nameError}`;
    else if (seen.has(row.name)) errors[`environment.${i}.name`] = `Variable ${i + 1}: ${row.name} is already defined.`;
    seen.add(row.name);
    if (row.value.length > 4096) errors[`environment.${i}.value`] = `Variable ${i + 1}: values are limited to 4096 characters.`;
  });
  return errors;
}

function ConfigurationForm({
  applicationId,
  config,
  readOnly,
  onSaved,
  onReload,
}: {
  applicationId: string;
  config: ApplicationConfiguration;
  readOnly: boolean;
  onSaved(config: ApplicationConfiguration): void;
  onReload(): void;
}) {
  const api = useApi();
  const demo = useDemoMode();
  const { notify } = useToast();
  const [baseline, setBaseline] = useState(() => toDraft(config));
  const [draft, setDraft] = useState(baseline);
  const [version, setVersion] = useState(config.version);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const clientErrors = useMemo(() => validate(draft), [draft]);
  const isDirty = comparable(draft) !== comparable(baseline);
  const { blocker } = useUnsavedChanges(isDirty && !readOnly);
  const save = useMutation((body: UpdateConfigurationRequest) => api.applications.updateConfiguration(applicationId, body));
  const conflict = save.error?.status === 409;

  const errorFor = (key: string) => serverErrors[key] ?? (submitted ? (clientErrors[key] ?? null) : null);
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setServerErrors({});
  };
  const updateRow = (index: number, patch: Partial<EnvRow>) =>
    update({ environment: draft.environment.map((r, i) => (i === index ? { ...r, ...patch } : r)) });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(clientErrors).length > 0) {
      summaryRef.current?.focus();
      return;
    }
    const result = await save.run({
      version,
      port: Number(draft.port),
      cpu: draft.cpu,
      memory: draft.memory,
      min_instances: Number(draft.min_instances),
      max_instances: Number(draft.max_instances),
      health_check_path: draft.health_check_path.trim() || null,
      environment: draft.environment.map(({ name, value }) => ({ name, value })),
    });
    if (result.ok) {
      const next = toDraft(result.data);
      setBaseline(next);
      setDraft(next);
      setVersion(result.data.version);
      setSubmitted(false);
      onSaved(result.data);
      notify(simulated(messages.configurationSaved(), demo));
      return;
    }
    if (!result.error) return;
    const mapped: Errors = {};
    for (const fe of result.error.fieldErrors) mapped[fe.field] = fe.message;
    setServerErrors(mapped);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const clientMessages = submitted ? Object.values(clientErrors).filter((m): m is string => Boolean(m)) : [];
  const disabled = readOnly || save.isPending;

  return (
    <form className="form" onSubmit={onSubmit} noValidate aria-label="Application configuration">
      {readOnly && (
        <Alert tone="info" role="status">
          You can view this configuration but not change it. Ask an administrator for the developer role to edit it.
        </Alert>
      )}
      {conflict ? (
        <Alert
          tone="warning"
          title="The configuration changed since you opened it"
          role="alert"
          requestId={save.error?.requestId}
          actions={<Button size="sm" onClick={() => setConfirmDiscard(true)}>Load latest version</Button>}
        >
          Someone else saved a newer version. Your edits are still here; load the latest version to see their changes (your
          unsaved edits will be discarded), then make your changes again.
        </Alert>
      ) : (
        <FormErrorSummary ref={summaryRef} error={save.error} fieldMessages={save.error ? [] : clientMessages} />
      )}

      <Panel title="Runtime">
        <div className="form-grid form-grid--3">
          <TextField label="Container port" required type="number" inputMode="numeric" min={1} max={65535} value={draft.port} onChange={(e) => update({ port: e.target.value })} error={errorFor('port')} disabled={disabled} />
          <SelectField label="CPU (vCPU)" required value={draft.cpu} onChange={(e) => update({ cpu: e.target.value })} error={errorFor('cpu')} disabled={disabled}>
            {[...new Set([...CPU_OPTIONS, draft.cpu])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <SelectField label="Memory" required value={draft.memory} onChange={(e) => update({ memory: e.target.value })} error={errorFor('memory')} disabled={disabled}>
            {[...new Set([...MEMORY_OPTIONS, draft.memory])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
          <TextField label="Minimum instances" required type="number" inputMode="numeric" min={0} max={25} value={draft.min_instances} onChange={(e) => update({ min_instances: e.target.value })} error={errorFor('min_instances')} disabled={disabled} />
          <TextField label="Maximum instances" required type="number" inputMode="numeric" min={1} max={25} value={draft.max_instances} onChange={(e) => update({ max_instances: e.target.value })} error={errorFor('max_instances')} disabled={disabled} />
          <TextField label="Health check path" optional mono placeholder="/healthz" value={draft.health_check_path} onChange={(e) => update({ health_check_path: e.target.value })} error={errorFor('health_check_path')} disabled={disabled} hint="Leave empty to use the provider's default TCP check." />
        </div>
      </Panel>

      <Panel
        title="Environment variables"
        actions={
          !readOnly && (
            <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => update({ environment: [...draft.environment, { key: randomId(), name: '', value: '' }] })} disabled={disabled}>
              Add variable
            </Button>
          )
        }
      >
        <p className="text-muted text-small" style={{ marginBottom: 'var(--space-3)' }}>
          Plain-text values, visible to anyone who can view this application. Put passwords, tokens and keys in Secrets below.
        </p>
        {draft.environment.length === 0 ? (
          <p className="text-muted">No environment variables.</p>
        ) : (
          <div className="env-table">
            {draft.environment.map((row, i) => (
              <div className="env-row" key={row.key}>
                <TextField
                  label={`Variable ${i + 1} name`}
                  mono
                  spellCheck={false}
                  autoComplete="off"
                  value={row.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  error={errorFor(`environment.${i}.name`)}
                  hint={looksSecret(row.name) ? 'This looks like a secret. Store it in Secrets instead, so its value is never displayed.' : undefined}
                  disabled={disabled}
                />
                <TextField
                  label={`Variable ${i + 1} value`}
                  mono
                  spellCheck={false}
                  autoComplete="off"
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  error={errorFor(`environment.${i}.value`)}
                  disabled={disabled}
                />
                {!readOnly && (
                  <Button
                    style={{ marginTop: '1.6rem' }}
                    variant="ghost"
                    iconOnly
                    aria-label={`Remove variable ${row.name || i + 1}`}
                    onClick={() => update({ environment: draft.environment.filter((_, j) => j !== i) })}
                    disabled={disabled}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {!readOnly && (
        <div className="form-actions">
          <span className="text-muted text-small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {isDirty ? 'You have unsaved changes. Saved changes take effect on the next deployment.' : 'No unsaved changes.'}
          </span>
          <Button onClick={() => { setDraft(baseline); setServerErrors({}); setSubmitted(false); save.reset(); }} disabled={!isDirty || save.isPending} icon={<Undo2 size={16} aria-hidden="true" />}>
            Discard changes
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            loadingLabel="Saving…"
            disabled={!isDirty || (submitted && Object.keys(clientErrors).length > 0)}
            icon={<Save size={16} aria-hidden="true" />}
          >
            Save configuration
          </Button>
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
      <ConfirmDialog
        open={confirmDiscard}
        title="Load the latest configuration?"
        description="Your unsaved edits will be discarded and replaced with the version currently saved."
        confirmLabel="Discard my edits and reload"
        pendingLabel="Loading…"
        pending={false}
        error={null}
        onConfirm={() => {
          setConfirmDiscard(false);
          setDraft(baseline);
          onReload();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </form>
  );
}

function SecretsPanel({ applicationId, config, readOnly, onChange }: { applicationId: string; config: ApplicationConfiguration; readOnly: boolean; onChange(next: ApplicationConfiguration): void }) {
  const api = useApi();
  const demo = useDemoMode();
  const { notify } = useToast();
  const [editing, setEditing] = useState<{ name: string; isNew: boolean } | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const saveSecret = useMutation((n: string, v: string) => api.applications.setSecret(applicationId, n, v));
  const deleteSecret = useMutation((n: string) => api.applications.deleteSecret(applicationId, n));

  const nameError = editing?.isNew
    ? (envVarName(name) ?? (config.secrets.some((s) => s.name === name) ? 'A secret with this name exists. Use Replace value instead.' : null))
    : null;
  const valueError = value.length === 0 ? 'Value is required.' : value.length > 8192 ? 'Values are limited to 8192 characters.' : null;

  const open = (secretName: string | null) => {
    saveSecret.reset();
    setName(secretName ?? '');
    setValue('');
    setSubmitted(false);
    setEditing({ name: secretName ?? '', isNew: secretName === null });
  };
  const close = () => {
    setValue('');
    setEditing(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || valueError || !editing) return;
    const secretName = editing.isNew ? name : editing.name;
    const result = await saveSecret.run(secretName, value);
    // The value is dropped from memory whatever the outcome of a successful request.
    if (result.ok) {
      setValue('');
      setEditing(null);
      onChange({ ...config, secrets: [...config.secrets.filter((s) => s.name !== result.data.name), result.data] });
      notify(simulated(messages.secretSaved(result.data.name), demo));
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const result = await deleteSecret.run(removing);
    if (result.ok) {
      onChange({ ...config, secrets: config.secrets.filter((s) => s.name !== removing) });
      notify(simulated(messages.secretDeleted(removing), demo));
      setRemoving(null);
    }
  };

  return (
    <Panel
      title="Secrets"
      actions={!readOnly && <Button size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => open(null)}>Add secret</Button>}
    >
      <p className="text-muted text-small" style={{ marginBottom: 'var(--space-3)' }}>
        Secret values are write-only. CloudBridge stores them encrypted and never shows them again; only names are listed.
      </p>
      {config.secrets.length === 0 ? (
        <EmptyState compact icon={KeyRound} title="No secrets" message="Add database URLs, API keys and other sensitive values here." />
      ) : (
        <ul className="secret-list">
          {config.secrets.map((s) => (
            <li key={s.name} className="secret-list__item">
              <span>
                <span className="mono">{s.name}</span>
                <span className="data-table__secondary">
                  <span className="secret-value" aria-label="Value hidden">••••••••</span> · updated <RelativeTime value={s.updated_at} />
                </span>
              </span>
              {!readOnly && (
                <span className="cluster">
                  <Button size="sm" onClick={() => open(s.name)}>
                    Replace value
                  </Button>
                  <Button size="sm" variant="ghost" iconOnly aria-label={`Remove secret ${s.name}`} onClick={() => { deleteSecret.reset(); setRemoving(s.name); }}>
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        title={editing?.isNew ? 'Add secret' : `Replace value of ${editing?.name ?? ''}`}
        onClose={close}
        busy={saveSecret.isPending}
        footer={
          <>
            <Button onClick={close} disabled={saveSecret.isPending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="secret-form" loading={saveSecret.isPending} loadingLabel="Saving…">
              Save secret
            </Button>
          </>
        }
      >
        <form id="secret-form" className="form" onSubmit={submit} noValidate autoComplete="off">
          <FormErrorSummary error={saveSecret.error} />
          {editing?.isNew && (
            <TextField label="Name" required mono spellCheck={false} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={submitted ? nameError : null} hint="Exposed to the application as an environment variable." disabled={saveSecret.isPending} />
          )}
          <TextField
            label="Value"
            required
            type="password"
            mono
            autoComplete="new-password"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={submitted ? valueError : null}
            hint={editing?.isNew ? undefined : 'The current value is not shown. Saving replaces it.'}
            disabled={saveSecret.isPending}
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove secret ${removing ?? ''}?`}
        description="The application loses access to this value on its next deployment. The value cannot be recovered."
        confirmLabel="Remove secret"
        pendingLabel="Removing…"
        pending={deleteSecret.isPending}
        error={deleteSecret.error}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Panel>
  );
}

export function ApplicationConfigurationPage() {
  const { applicationId = '' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const app = useResource(`application:${applicationId}`, (signal) => api.applications.get(applicationId, signal));
  const config = useResource(`application:${applicationId}:configuration`, (signal) => api.applications.getConfiguration(applicationId, signal));
  const readOnly = !can('applications:update');

  const error = app.error ?? config.error;
  if (error?.status === 404) return <ApplicationNotFound />;
  if (error?.status === 403) return <AccessDeniedPage resource="this application's configuration" requestId={error.requestId} />;

  const name = app.data?.name ?? 'Application';
  return (
    <div className="page">
      <PageHeader
        title="Configuration"
        documentTitle={`${name} configuration`}
        description="Runtime settings, environment variables and secrets used by the next deployment."
        breadcrumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Applications', to: '/applications' },
          { label: name, to: `/applications/${encodeURIComponent(applicationId)}` },
          { label: 'Configuration' },
        ]}
      />
      <ApplicationSubNav id={applicationId} />
      {(app.status === 'loading' || config.status === 'loading') && (
        <Panel>
          <CardSkeleton lines={6} label="Loading configuration" />
        </Panel>
      )}
      {app.status !== 'loading' && config.status !== 'loading' && error && (
        <Panel>
          <ErrorState
            error={error}
            onRetry={() => {
              app.reload();
              config.reload();
            }}
          />
        </Panel>
      )}
      {app.status === 'success' && config.status === 'success' && config.data && (
        <>
          <ConfigurationForm
            key={config.data.version}
            applicationId={applicationId}
            config={config.data}
            readOnly={readOnly}
            onSaved={(next) => config.setData(() => next)}
            onReload={config.reload}
          />
          <SecretsPanel applicationId={applicationId} config={config.data} readOnly={readOnly} onChange={(next) => config.setData(() => next)} />
        </>
      )}
    </div>
  );
}
