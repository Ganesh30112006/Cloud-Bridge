import { Cloud, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RequirePermission } from '../../app/RequirePermission';
import { UnsavedChangesDialog } from '../../components/dialogs/UnsavedChangesDialog';
import { Alert } from '../../components/feedback/Alert';
import { Button, ButtonLink } from '../../components/forms/Button';
import { SelectField, TextField } from '../../components/forms/Field';
import { FormErrorSummary } from '../../components/forms/FormErrorSummary';
import { useFormState } from '../../components/forms/useFormState';
import { PageHeader } from '../../components/layout/PageHeader';
import { Panel } from '../../components/layout/Panel';
import { useApi, useDemoMode } from '../../hooks/useApi';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useMutation } from '../../hooks/useMutation';
import { useToast } from '../../hooks/useToast';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import type { CreateConnectionRequest, ProviderKind } from '../../types/api';
import { messages, simulated } from '../../utils/messages';
import { PROVIDERS, PROVIDER_KINDS } from '../../utils/providers';
import {
  awsAccountId,
  awsRoleArn,
  compose,
  gcpProjectId,
  gcpServiceAccount,
  gcpWorkloadIdentityProvider,
  maxLength,
  required,
  type Validator,
} from '../../utils/validation';
import './providers.css';

const INITIAL = {
  name: '',
  default_region: '',
  account_id: '',
  role_arn: '',
  project_id: '',
  workload_identity_provider: '',
  service_account_email: '',
};

type Values = typeof INITIAL;

const SERVER_FIELDS: Record<string, keyof Values> = {
  'aws.account_id': 'account_id',
  'aws.role_arn': 'role_arn',
  'gcp.project_id': 'project_id',
  'gcp.workload_identity_provider': 'workload_identity_provider',
  'gcp.service_account_email': 'service_account_email',
};

function SetupForm({ provider }: { provider: ProviderKind }) {
  const api = useApi();
  const demo = useDemoMode();
  const { notify } = useToast();
  const navigate = useNavigate();
  const idempotencyKey = useIdempotencyKey();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const isAws = provider === 'aws_app_runner';

  const validators = useMemo((): Partial<Record<keyof Values, Validator>> => {
    const common = {
      name: compose(required('Connection name'), maxLength('Connection name', 80)),
      default_region: required('Default region'),
    };
    if (isAws) {
      return {
        ...common,
        account_id: awsAccountId,
        role_arn: awsRoleArn,
      };
    }
    return {
      ...common,
      project_id: gcpProjectId,
      workload_identity_provider: gcpWorkloadIdentityProvider,
      service_account_email: gcpServiceAccount,
    };
  }, [isAws]);

  const form = useFormState(INITIAL, validators);
  const { values } = form;
  const roleAccount = /^arn:aws(?:-[a-z]+)*:iam::(\d{12}):/.exec(values.role_arn.trim())?.[1];
  const accountMismatch =
    isAws && roleAccount && /^\d{12}$/.test(values.account_id.trim()) && roleAccount !== values.account_id.trim()
      ? 'The role ARN belongs to a different account than the account ID above.'
      : null;
  const { blocker, allowNavigation } = useUnsavedChanges(form.isDirty);
  const create = useMutation((payload: CreateConnectionRequest, key: string) => api.providers.create(payload, { idempotencyKey: key }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    form.setSubmitted(true);
    if (!form.isValid || accountMismatch) {
      summaryRef.current?.focus();
      return;
    }
    const payload: CreateConnectionRequest = {
      name: values.name.trim(),
      provider,
      default_region: values.default_region,
      ...(isAws
        ? { aws: { account_id: values.account_id.trim(), role_arn: values.role_arn.trim() } }
        : {
            gcp: {
              project_id: values.project_id.trim(),
              workload_identity_provider: values.workload_identity_provider.trim(),
              service_account_email: values.service_account_email.trim(),
            },
          }),
    };
    const result = await create.run(payload, idempotencyKey(payload));
    if (result.ok) {
      notify(simulated(messages.providerCreated(result.data.name), demo));
      allowNavigation();
      navigate(`/providers/${encodeURIComponent(result.data.id)}`);
      return;
    }
    if (!result.error) return;
    setUnmatched(form.applyServerErrors(result.error, SERVER_FIELDS));
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const field = (name: keyof Values) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) => form.setValue(name, e.target.value),
    onBlur: () => form.touch(name),
    error: form.errorFor(name),
    disabled: create.isPending,
  });

  const clientMessages = form.submitted
    ? [...Object.values(form.clientErrors).filter((m): m is string => Boolean(m)), ...(accountMismatch ? [accountMismatch] : [])]
    : [];

  return (
    <form className="form" onSubmit={submit} noValidate aria-label={`Connect ${PROVIDERS[provider].label}`}>
      <FormErrorSummary
        ref={summaryRef}
        error={create.error}
        fieldMessages={[...(create.error ? [] : clientMessages), ...unmatched]}
        onCheckStatus={() => navigate('/providers')}
      />
      <Panel title="Connection details">
        <div className="form-grid">
          <TextField label="Connection name" required hint="A label for your team, e.g. “Production AWS”." autoComplete="off" {...field('name')} />
          <SelectField label="Default region" required {...field('default_region')}>
            <option value="">Select a region</option>
            {PROVIDERS[provider].regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          {isAws ? (
            <>
              <TextField label="AWS account ID" required inputMode="numeric" mono autoComplete="off" placeholder="123456789012" {...field('account_id')} />
              <TextField
                label="IAM role ARN"
                required
                mono
                spellCheck={false}
                autoComplete="off"
                placeholder="arn:aws:iam::123456789012:role/CloudBridgeDeploy"
                hint="The role CloudBridge assumes. You add its trust policy in the next step."
                {...field('role_arn')}
                error={form.errorFor('role_arn') ?? (form.submitted ? accountMismatch : null)}
              />
            </>
          ) : (
            <>
              <TextField label="Project ID" required mono spellCheck={false} autoComplete="off" placeholder="my-project-123" {...field('project_id')} />
              <TextField
                label="Service account email"
                required
                mono
                spellCheck={false}
                autoComplete="off"
                placeholder="cloudbridge@my-project-123.iam.gserviceaccount.com"
                {...field('service_account_email')}
              />
              <TextField
                label="Workload identity provider"
                required
                mono
                spellCheck={false}
                autoComplete="off"
                className="form-grid__full"
                placeholder="projects/123456789/locations/global/workloadIdentityPools/cloudbridge/providers/cloudbridge"
                hint="Full resource name of the provider in your workload identity pool."
                {...field('workload_identity_provider')}
              />
            </>
          )}
        </div>
      </Panel>
      <Alert tone="info" title="No secret keys are needed">
        {isAws
          ? 'CloudBridge assumes the IAM role with a unique external ID. Do not create or paste access keys.'
          : 'CloudBridge authenticates through workload identity federation. Do not create or paste service account keys.'}
      </Alert>
      <div className="form-actions">
        <ButtonLink to="/providers">Cancel</ButtonLink>
        <Button type="submit" variant="primary" loading={create.isPending} loadingLabel="Saving…" disabled={form.submitted && (!form.isValid || Boolean(accountMismatch))} icon={<ShieldCheck size={16} aria-hidden="true" />}>
          Save and continue
        </Button>
      </div>
      <UnsavedChangesDialog blocker={blocker} />
    </form>
  );
}

export function ProviderSetupPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('provider');
  const provider = PROVIDER_KINDS.find((k) => k === requested) ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Connect a cloud provider"
        description="Give CloudBridge scoped access to deploy to one cloud account or project."
        breadcrumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Cloud providers', to: '/providers' },
          { label: 'Connect' },
        ]}
      />
      <RequirePermission permission="providers:manage" resource="provider connection setup">
        <Panel title="1. Choose a provider">
          <fieldset className="fieldset">
            <legend className="visually-hidden">Provider</legend>
            <div className="radio-cards">
              {PROVIDER_KINDS.map((kind) => (
                <label className="radio-card" key={kind}>
                  <input
                    type="radio"
                    name="provider"
                    value={kind}
                    checked={provider === kind}
                    onChange={() => setParams({ provider: kind }, { replace: true })}
                  />
                  <span className="radio-card__text">
                    <strong>{PROVIDERS[kind].label}</strong>
                    <span className="field__hint">
                      {kind === 'aws_app_runner' ? 'Uses an IAM role with an external ID.' : 'Uses workload identity federation.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>
        {provider ? (
          <SetupForm key={provider} provider={provider} />
        ) : (
          <p className="text-muted">
            <Cloud size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Choose a provider to continue.
          </p>
        )}
      </RequirePermission>
    </div>
  );
}
