import { SubNav } from '../../components/navigation/SubNav';

export function ApplicationSubNav({ id }: { id: string }) {
  const base = `/applications/${encodeURIComponent(id)}`;
  return (
    <SubNav
      label="Application sections"
      items={[
        { to: base, label: 'Overview', end: true },
        { to: `${base}/configuration`, label: 'Configuration' },
        { to: `/deployments?application_id=${encodeURIComponent(id)}`, label: 'Deployments' },
      ]}
    />
  );
}
