import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/**
 * Page, page size and filters live in the URL so lists survive reloads and can
 * be linked. Only non-sensitive values (search text, filters) go here.
 */
export function useListParams<K extends string>(filterKeys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get('page'));
  const rawSize = Number(params.get('page_size'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawSize) ? rawSize : 25;
  const filters = Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>;

  const update = useCallback(
    (changes: Partial<Record<K | 'page' | 'page_size', string | number | null>>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          let resetPage = false;
          for (const [key, value] of Object.entries(changes) as Array<[string, string | number | null]>) {
            if (value === null || value === '' || value === undefined) next.delete(key);
            else next.set(key, String(value));
            if (key !== 'page') resetPage = true;
          }
          if (resetPage && !('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { page, pageSize, filters, update };
}
