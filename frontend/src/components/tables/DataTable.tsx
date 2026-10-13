import type { ReactNode } from 'react';
import './table.css';

export interface Column<T> {
  key: string;
  header: string;
  render(row: T): ReactNode;
  className?: string;
  /** Header is still read by screen readers, but hidden visually (e.g. an actions column). */
  hideHeader?: boolean;
}

interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string;
  /** Set while a background refresh is running over the rows shown. */
  busy?: boolean;
}

/**
 * Plain semantic table. Below 40rem each row stacks into label/value pairs,
 * so tables stay readable on phones without horizontal scrolling.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, busy = false }: DataTableProps<T>) {
  return (
    <div className="table-scroll">
      <table className="data-table data-table--stack" aria-busy={busy || undefined}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.className}>
                {col.hideHeader ? <span className="visually-hidden">{col.header}</span> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.className} data-label={col.hideHeader ? '' : col.header}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
