import { ArrowLeft, ArrowRight, Cloud, Rocket } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { RequirePermission } from '../../app/RequirePermission';
import { UnsavedChangesDialog } from '../../components/dialogs/UnsavedChangesDialog';
import { Alert } from '../../components/feedback/Alert';
import { CardSkeleton } from '../../components/feedback/CardSkeleton';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { Button, ButtonLink } from '../../components/forms/Button';
import { SelectField, TextAreaField, TextField } from '../../components/forms/Field';
import { FormErrorSummary } from '../../components/forms/FormErrorSummary';
import { useFormState } from '../../components/forms/useFormState';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { connectionStatus } from '../../components/status/statusMaps';
import { useApi, useDemoMode } from '../../hooks/useApi';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useMutation } from '../../hooks/useMutation';
import { useResource } from '../../hooks/useResource';
import { useToast } from '../../hooks/useToast';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import type { CreateApplicationRequest, ProviderConnection } from '../../types/api';
import { messages, simulated } from '../../utils/messages';
import { CPU_OPTIONS, MEMORY_OPTIONS, PROVIDERS, providerLabel } from '../../utils/providers';
import { validateRepositoryUrl } from '../../utils/url';
import {
  applicationName,
  compose,
  containerImage,
  gitBranch,
  integerInRange,
  maxLength,
  relativePath,
  required,
  type Validator,
} from '../../utils/validation';
import './applications.css';

const INITIAL = {
  name: '',
  description: '',
  connection_id: '',
  region: '',
  source_type: 'image',
  image: '',
  repository_url: '',
  branch: 'main',
  dockerfile_path: 'Dockerfile',
  port: '8080',
  cpu: '1',
  memory: '2Gi',
  min_instances: '0',
  max_instances: '3',
};

type FormValues = typeof INITIAL;
type FieldName = keyof FormValues;

const STEPS: Array<{ title: string; fields: FieldName[] }> = [
  { title: 'Basics', fields: ['name', 'description', 'connection_id', 'region'] },
  { title: 'Source', fields: ['source_type', 'image', 'repository_url', 'branch', 'dockerfile_path'] },
  { title: 'Runtime', fields: ['port', 'cpu', 'memory', 'min_instances', 'max_instances'] },
  { title: 'Review', fields: [] },
];

/** Server field paths → form fields. */
const SERVER_FIELDS: Record<string, FieldName> = {
  'source.image': 'image',
  'source.repository_url': 'repository_url',
  'source.branch': 'branch',
  'source.dockerfile_path': 'dockerfile_path',
  'source.type': 'source_type',
};

function toRequest(v: FormValues): CreateApplicationRequest {
  const isImage = v.source_type === 'image';
  return {
    name: v.name,
    description: v.description.trim() || null,
    connection_id: v.connection_id,
    region: v.region,
    source: {
      type: isImage ? 'image' : 'repository',
      image: isImage ? v.image.trim() : null,
      repository_url: isImage ? null : v.repository_url.trim(),
      branch: isImage ? null : v.branch.trim(),
      dockerfile_path: isImage ? null : v.dockerfile_path.trim(),
    },
    port: Number(v.port),
    cpu: v.cpu,
    memory: v.memory,
    min_instances: Number(v.min_instances),
    max_instances: Number(v.max_instances),
  };
}

function CreateApplicationForm({ connections }: { connections: ProviderConnection[] }) {
  const api = useApi();
  const demo = useDemoMode();
  const navigate = useNavigate();
  const { notify } = useToast();
  const idempotencyKey = useIdempotencyKey();
  const [step, setStep] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const usable = connections.filter((c) => c.status === 'connected');
  const initial = useMemo(() => {
    const first = usable.length === 1 ? usable[0] : undefined;
    return { ...INITIAL, connection_id: first?.id ?? '', region: first?.default_region ?? '' };
  }, [usable]);

  const [sourceType, setSourceType] = useState(initial.source_type);
  const validators = useMemo((): Partial<Record<FieldName, Validator>> => {
    const base: Partial<Record<FieldName, Validator>> = {
      name: applicationName,
      description: maxLength('Description', 280),
      connection_id: required('Provider connection'),
      region: required('Region'),
      port: integerInRange('Port', 1, 65535),
      min_instances: integerInRange('Minimum instances', 0, 25),
      max_instances: integerInRange('Maximum instances', 1, 25),
    };
    if (sourceType === 'image') base.image = containerImage;
    else {
      base.repository_url = compose(required('Repository URL'), (v) => validateRepositoryUrl(v.trim()));
      base.branch = gitBranch;
      base.dockerfile_path = relativePath('Dockerfile path');
    }
    return base;
  }, [sourceType]);

  const form = useFormState<FormValues>(initial, validators);
  const { values } = form;
  const minMaxError =
    Number(values.min_instances) > Number(values.max_instances) ? 'Minimum instances cannot exceed maximum instances.' : null;
  const { blocker, allowNavigation } = useUnsavedChanges(form.isDirty);

  const create = useMutation((payload: CreateApplicationRequest, key: string) =>
    api.applications.create(payload, { idempotencyKey: key }),
  );

  const selectedConnection = connections.find((c) => c.id === values.connection_id);
  const regions = selectedConnection ? PROVIDERS[selectedConnection.provider].regions : [];

  const stepErrors = (index: number) =>
    (STEPS[index]?.fields ?? [])
      .map((f) => form.clientErrors[f])
      .concat(index === 2 && minMaxError ? [minMaxError] : [])
      .filter((m): m is string => Boolean(m));

  const goNext = () => {
    form.setSubmitted(true);
    if (stepErrors(step).length > 0) {
      summaryRef.current?.focus();
      return;
    }
    form.setSubmitted(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step < STEPS.length - 1) {
      goNext();
      return;
    }
    const firstInvalid = STEPS.findIndex((_, i) => stepErrors(i).length > 0);
    if (firstInvalid >= 0) {
      form.setSubmitted(true);
      setStep(firstInvalid);
      return;
    }
    const payload = toRequest(values);
    const result = await create.run(payload, idempotencyKey(payload));
    if (result.ok) {
      notify(simulated(messages.applicationCreated(result.data.name), demo));
      allowNavigation();
      navigate(`/applications/${encodeURIComponent(result.data.id)}`);
      return;
    }
    if (!result.error) return;
    const rest = form.applyServerErrors(result.error, SERVER_FIELDS);
    setUnmatched(rest);
    const errorStep = STEPS.findIndex((s) => s.fields.some((f) => result.error?.fieldErrors.some((fe) => (SERVER_FIELDS[fe.field] ?? fe.field) === f)));
    if (errorStep >= 0) setStep(errorStep);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const setConnection = (id: string) => {
    form.setValue('connection_id', id);
    const conn = connections.find((c) => c.id === id);
    if (conn) form.setValue('region', conn.default_region);
  };

  const field = (name: FieldName) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) => form.setValue(name, e.target.value),
    onBlur: () => form.touch(name),
    error: form.errorFor(name),
    disabled: create.isPending,
  });

  const visibleErrors = form.submitted ? stepErrors(step) : [];

  return (
    <form className="form" onSubmit={submit} noValidate aria-labelledby="create-app-step-title">
      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={`wizard-steps__item${i < step ? ' wizard-steps__item--done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="wizard-steps__label">{s.title}</span>
            {i < step && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>

      <FormErrorSummary
        ref={summaryRef}
        error={create.error}
        fieldMessages={[...visibleErrors, ...unmatched]}
        onCheckStatus={() => navigate(`/applications?q=${encodeURIComponent(values.name)}`)}
      />
      {create.error && (create.error.kind === 'timeout' || create.error.kind === 'network') && (
        <Alert tone="info">
          Submitting again with the same values is safe: CloudBridge recognizes a repeated request and will not create a
          second application.
        </Alert>
      )}

      <Panel title={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]?.title}`} id="create-app-step">
        {step === 0 && (
          <div className="form-grid">
            <TextField
              label="Application name"
              required
              autoComplete="off"
              spellCheck={false}
              mono
              hint="Lowercase letters, numbers and hyphens, 3–40 characters. Used as the service name on the provider."
              {...field('name')}
            />
            <SelectField
              label="Provider connection"
              required
              hint={usable.length < connections.length ? 'Connections that are not validated cannot be selected.' : undefined}
              {...field('connection_id')}
              onChange={(e) => setConnection(e.target.value)}
            >
              <option value="">Select a connection</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.status !== 'connected'}>
                  {c.name} — {providerLabel(c.provider)}
                  {c.status !== 'connected' ? ` (${connectionStatus[c.status].label})` : ''}
                </option>
              ))}
            </SelectField>
            <TextAreaField label="Description" optional rows={2} className="form-grid__full" {...field('description')} />
            <SelectField label="Region" required {...field('region')} disabled={!selectedConnection || create.isPending}>
              <option value="">{selectedConnection ? 'Select a region' : 'Select a connection first'}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
          </div>
        )}

        {step === 1 && (
          <div className="form">
            <fieldset className="fieldset">
              <legend>Source</legend>
              <div className="radio-cards">
                {(
                  [
                    ['image', 'Container image', 'Deploy an image that is already in a registry.'],
                    ['repository', 'Git repository', 'CloudBridge builds the image from a Dockerfile.'],
                  ] as const
                ).map(([value, label, description]) => (
                  <label key={value} className="radio-card">
                    <input
                      type="radio"
                      name="source_type"
                      value={value}
                      checked={values.source_type === value}
                      onChange={() => {
                        form.setValue('source_type', value);
                        setSourceType(value);
                      }}
                      disabled={create.isPending}
                    />
                    <span className="radio-card__text">
                      <strong>{label}</strong>
                      <span className="field__hint">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {values.source_type === 'image' ? (
              <TextField
                label="Image reference"
                required
                mono
                spellCheck={false}
                autoComplete="off"
                placeholder="123456789012.dkr.ecr.eu-west-1.amazonaws.com/app:1.0.0"
                hint="Registry, repository and tag or digest. The provider connection must be able to pull it."
                {...field('image')}
              />
            ) : (
              <div className="form-grid">
                <TextField
                  label="Repository URL"
                  required
                  type="url"
                  mono
                  spellCheck={false}
                  autoComplete="off"
                  className="form-grid__full"
                  placeholder="https://github.com/org/repo.git"
                  hint="HTTPS only, without credentials. Repository access is configured on the backend."
                  {...field('repository_url')}
                />
                <TextField label="Branch" required mono spellCheck={false} {...field('branch')} />
                <TextField label="Dockerfile path" required mono spellCheck={false} hint="Relative to the repository root." {...field('dockerfile_path')} />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="form-grid form-grid--3">
            <TextField label="Container port" required type="number" inputMode="numeric" min={1} max={65535} {...field('port')} />
            <SelectField label="CPU (vCPU)" required {...field('cpu')}>
              {CPU_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label="Memory" required {...field('memory')}>
              {MEMORY_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectField>
            <TextField label="Minimum instances" required type="number" inputMode="numeric" min={0} max={25} {...field('min_instances')} hint="0 allows scaling to zero where the provider supports it." />
            <TextField
              label="Maximum instances"
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={25}
              {...field('max_instances')}
              error={form.errorFor('max_instances') ?? (form.submitted ? minMaxError : null)}
            />
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <p className="text-muted">Check the details. Creating the application does not deploy it; you can deploy from the application page.</p>
            <dl className="description-list">
              <dt>Name</dt>
              <dd className="mono">{values.name}</dd>
              <dt>Description</dt>
              <dd>{values.description || '—'}</dd>
              <dt>Provider</dt>
              <dd>
                {selectedConnection ? `${selectedConnection.name} (${providerLabel(selectedConnection.provider)})` : '—'}
              </dd>
              <dt>Region</dt>
              <dd>{values.region}</dd>
              <dt>Source</dt>
              <dd className="mono">
                {values.source_type === 'image'
                  ? values.image
                  : `${values.repository_url} @ ${values.branch} (${values.dockerfile_path})`}
              </dd>
              <dt>Runtime</dt>
              <dd>
                Port {values.port} · {values.cpu} vCPU · {values.memory} · {values.min_instances}–{values.max_instances} instances
              </dd>
            </dl>
          </div>
        )}
      </Panel>

      <div className="form-actions form-actions--split">
        <div className="cluster">
          <ButtonLink to="/applications">Cancel</ButtonLink>
        </div>
        <div className="cluster">
          {step > 0 && (
            <Button onClick={goBack} disabled={create.isPending} icon={<ArrowLeft size={16} aria-hidden="true" />}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" type="submit" icon={<ArrowRight size={16} aria-hidden="true" />}>
              Next
            </Button>
          ) : (
            <Button variant="primary" type="submit" loading={create.isPending} loadingLabel="Creating…" icon={<Rocket size={16} aria-hidden="true" />}>
              Create application
            </Button>
          )}
        </div>
      </div>
      <UnsavedChangesDialog blocker={blocker} />
    </form>
  );
}

export function CreateApplicationPage() {
  const api = useApi();
  const connections = useResource('create-app:connections', (signal) => api.providers.list(signal));

  return (
    <div className="page">
      <PageHeader
        title="Create application"
        description="Register a containerized application with a connected cloud provider."
        breadcrumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Applications', to: '/applications' },
          { label: 'Create' },
        ]}
      />
      <RequirePermission permission="applications:create" resource="application creation">
        {connections.status === 'loading' && (
          <Panel>
            <CardSkeleton lines={4} label="Loading provider connections" />
          </Panel>
        )}
        {connections.status === 'error' && (
          <Panel>
            <ErrorState
              error={connections.error}
              title="Provider connections could not be loaded"
              onRetry={connections.reload}
            />
          </Panel>
        )}
        {connections.status === 'success' && connections.data && !connections.data.some((c) => c.status === 'connected') && (
          <Panel>
            <EmptyState
              icon={Cloud}
              title="Connect a provider first"
              message={
                connections.data.length === 0
                  ? 'Applications are deployed through a provider connection. Add an AWS App Runner or Google Cloud Run connection to continue.'
                  : 'None of your provider connections are validated. Validate a connection to continue.'
              }
              actions={<ButtonLink variant="primary" to={connections.data.length === 0 ? '/providers/new' : '/providers'}>{connections.data.length === 0 ? 'Connect a provider' : 'Review connections'}</ButtonLink>}
            />
          </Panel>
        )}
        {connections.status === 'success' && connections.data?.some((c) => c.status === 'connected') && (
          <CreateApplicationForm connections={connections.data} />
        )}
      </RequirePermission>
    </div>
  );
}
