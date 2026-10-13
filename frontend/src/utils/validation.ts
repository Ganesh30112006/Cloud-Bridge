/** Small field validators. Each returns an error message, or null when valid. */

export type Validator = (value: string) => string | null;

export const required =
  (label: string): Validator =>
  (value) =>
    value.trim() ? null : `${label} is required.`;

export const maxLength =
  (label: string, max: number): Validator =>
  (value) =>
    value.length > max ? `${label} must be ${max} characters or fewer.` : null;

export function compose(...validators: Validator[]): Validator {
  return (value) => {
    for (const validator of validators) {
      const error = validator(value);
      if (error) return error;
    }
    return null;
  };
}

export const email: Validator = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : 'Enter a valid email address.';

/** Application names become service names on both providers: 3–40 chars, lowercase, hyphens. */
export const applicationName: Validator = (value) => {
  if (!value) return 'Application name is required.';
  if (value.length < 3 || value.length > 40) return 'Application name must be 3 to 40 characters.';
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(value)) {
    return 'Application name can use lowercase letters, numbers and hyphens, starting with a letter and ending with a letter or number.';
  }
  if (value.includes('--')) return 'Application name cannot contain consecutive hyphens.';
  return null;
};

export const containerImage: Validator = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return 'Image reference is required.';
  if (/\s/.test(trimmed)) return 'Image reference cannot contain spaces.';
  if (/^[a-z]+:\/\//i.test(trimmed)) return 'Image reference must not include a scheme; use registry/repository:tag.';
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+(?::[\w][\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/.test(trimmed)) {
    return 'Image reference must include the registry and repository, e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/app:1.4.0';
  }
  return null;
};

export const gitBranch: Validator = (value) => {
  if (!value.trim()) return 'Branch is required.';
  if (/\s|\.\.|[~^:?*[\\]|^\/|\/$|\.lock$/.test(value)) return 'Branch is not a valid branch name.';
  return null;
};

export const relativePath =
  (label: string): Validator =>
  (value) => {
    if (!value.trim()) return `${label} is required.`;
    if (value.startsWith('/') || value.split('/').includes('..')) {
      return `${label} must be relative to the repository root and cannot contain "..".`;
    }
    return null;
  };

export const healthCheckPath: Validator = (value) => {
  if (!value) return null;
  if (!value.startsWith('/')) return 'Health check path must start with /.';
  if (/\s/.test(value) || value.length > 200) return 'Health check path cannot contain spaces or exceed 200 characters.';
  return null;
};

export function integerInRange(label: string, min: number, max: number): Validator {
  return (value) => {
    if (!/^\d+$/.test(value.trim())) return `${label} must be a whole number.`;
    const n = Number(value);
    if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
    return null;
  };
}

export const envVarName: Validator = (value) => {
  if (!value) return 'Name is required.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return 'Use letters, numbers and underscores, starting with a letter or underscore.';
  }
  if (value.length > 128) return 'Use 128 characters or fewer.';
  return null;
};

/** Names that suggest a secret; such values should go into Secrets instead. */
export function looksSecret(name: string): boolean {
  return /(secret|password|passwd|token|api_?key|private_?key|credential)/i.test(name);
}

export const awsAccountId: Validator = (value) =>
  /^\d{12}$/.test(value.trim()) ? null : 'An AWS account ID is 12 digits.';

export const awsRoleArn: Validator = (value) =>
  /^arn:aws(?:-[a-z]+)*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/.test(value.trim())
    ? null
    : 'Enter an IAM role ARN, e.g. arn:aws:iam::123456789012:role/CloudBridgeDeploy';

export const gcpProjectId: Validator = (value) =>
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.trim())
    ? null
    : 'Project IDs are 6–30 lowercase letters, digits or hyphens, starting with a letter.';

export const gcpWorkloadIdentityProvider: Validator = (value) =>
  /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/.test(
    value.trim(),
  )
    ? null
    : 'Use the full resource name: projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER';

export const gcpServiceAccount: Validator = (value) =>
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value.trim())
    ? null
    : 'Enter a service account email ending in .iam.gserviceaccount.com';
