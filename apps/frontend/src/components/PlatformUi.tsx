import type { ReactNode } from 'react';

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const styles = { good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200', warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200', bad: 'border-rose-500/40 bg-rose-500/10 text-rose-200', neutral: 'border-slate-600 bg-slate-800 text-slate-200' };
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

export function UnavailableState({ children }: { children: ReactNode }) {
  return <p className="rounded border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">{children}</p>;
}

export function ActionNotice({ notice }: { notice: { type: 'success' | 'error'; text: string } | null }) {
  if (!notice) return null;
  return <p role="status" className={`rounded border px-3 py-2 text-sm ${notice.type === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>{notice.text}</p>;
}
