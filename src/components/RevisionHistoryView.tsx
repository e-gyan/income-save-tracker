import React, { useState } from 'react';
import { RevisionEntry } from '../types/finance.ts';
import { formatSemanticVersion } from '../lib/calculations.ts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.tsx';

interface RevisionHistoryViewProps {
  revisions: RevisionEntry[];
  currentVersion: number;
  currentSemanticVersion: string;
  onRollback?: (revision: RevisionEntry) => Promise<void>;
}

export const RevisionHistoryView: React.FC<RevisionHistoryViewProps> = ({
  revisions,
  currentVersion,
  currentSemanticVersion,
  onRollback,
}) => {
  const [pendingRollbackRev, setPendingRollbackRev] = useState<RevisionEntry | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const handleConfirmRollback = async () => {
    if (!pendingRollbackRev || !onRollback) return;
    setIsRollingBack(true);
    try {
      await onRollback(pendingRollbackRev);
      setPendingRollbackRev(null);
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Version Control
        </h1>
        <span
          className="rounded-lg border px-3 py-1 font-mono text-xs font-bold"
          style={{
            borderColor: 'var(--app-accent-border)',
            backgroundColor: 'var(--app-accent-soft)',
            color: 'var(--app-accent-text)',
          }}
        >
          v{currentSemanticVersion}
        </span>
      </div>

      {/* Version Status Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Current Release</span>
          <span className="mt-1 font-mono text-xl font-bold text-slate-900 block">
            v{currentSemanticVersion}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Version Sequence</span>
          <span className="mt-1 font-mono text-xl font-bold text-slate-900 block tabular-nums">
            #{currentVersion}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Total Commits</span>
          <span className="mt-1 font-mono text-xl font-bold text-slate-900 block tabular-nums">
            {revisions.length}
          </span>
        </div>
      </div>

      {/* Revision Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-700 font-semibold font-sans">
              <tr>
                <th className="py-2.5 px-3.5">Semantic Version</th>
                <th className="py-2.5 px-3.5">Timestamp</th>
                <th className="py-2.5 px-3.5">Event</th>
                <th className="py-2.5 px-3.5">Change Log</th>
                {onRollback && <th className="py-2.5 px-3.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revisions.map((rev, idx) => {
                const isCurrent = idx === 0 || rev.versionNumber === currentVersion;
                const semver = formatSemanticVersion(rev);
                return (
                  <tr key={rev.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="font-bold text-slate-900">v{semver}</span>
                      {isCurrent && (
                        <span
                          className="ml-2 font-sans text-[10px] text-white px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--app-accent)' }}
                        >
                          HEAD
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-500 whitespace-nowrap tabular-nums">
                      {new Date(rev.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3.5 font-sans text-slate-700">
                      <span className="border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-[11px]">
                        {rev.actionType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 font-sans text-slate-800">
                      {rev.summary}
                    </td>
                    {onRollback && (
                      <td className="py-2.5 px-3.5 text-right font-sans whitespace-nowrap">
                        {Boolean(rev.snapshotData && !isCurrent) && (
                          <button
                            type="button"
                            disabled={isRollingBack}
                            onClick={() => setPendingRollbackRev(rev)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {revisions.length === 0 && (
                <tr>
                  <td
                    colSpan={onRollback ? 5 : 4}
                    className="py-8 text-center text-xs font-sans text-slate-400"
                  >
                    v1.0.0 initialized. Changes increment semantic versions automatically.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDeleteModal
        isOpen={Boolean(pendingRollbackRev)}
        title="Restore Version Snapshot?"
        message={
          pendingRollbackRev
            ? `Restore application state to v${formatSemanticVersion(pendingRollbackRev)}?`
            : 'Restore this version?'
        }
        confirmLabel="Yes, Restore"
        onCancel={() => setPendingRollbackRev(null)}
        onConfirm={handleConfirmRollback}
      />
    </div>
  );
};
