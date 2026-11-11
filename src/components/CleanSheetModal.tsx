import React from 'react';

interface CleanSheetModalProps {
  isOpen: boolean;
  isClearing: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export const CleanSheetModal: React.FC<CleanSheetModalProps> = ({
  isOpen,
  isClearing,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl border border-slate-200 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-base font-bold text-slate-900">
          Reset All Transactions?
        </h3>

        <p className="text-xs text-slate-600">
          Clears all income records, expenses, and transfers. Accounts and settings remain intact.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={isClearing}
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isClearing}
            onClick={onConfirm}
            className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {isClearing ? 'Resetting...' : 'Reset Data'}
          </button>
        </div>
      </div>
    </div>
  );
};
