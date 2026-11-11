import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface WrapSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface WrapSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: WrapSelectOption[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export const WrapSelect: React.FC<WrapSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  buttonClassName = '',
  triggerClassName = '',
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const minMenuW = Math.min(Math.max(rect.width, 220), viewportW - 24);
    let left = rect.left;
    if (left + minMenuW > viewportW - 12) {
      left = Math.max(12, viewportW - minMenuW - 12);
    }

    const spaceBelow = viewportH - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;

    const maxHeight = Math.min(260, Math.max(140, openUpward ? spaceAbove - 8 : spaceBelow - 8));
    const top = openUpward ? Math.max(12, rect.top - maxHeight - 6) : rect.bottom + 6;

    setMenuPos({
      top,
      left,
      width: minMenuW,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, options.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const handleScrollOrResize = () => {
      updatePosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  const hasGroups = options.some((opt) => Boolean(opt.group));
  const groupedEntries = React.useMemo(() => {
    if (!hasGroups) return [{ group: '', items: options }];
    const map = new Map<string, WrapSelectOption[]>();
    for (const opt of options) {
      const g = opt.group || '';
      const list = map.get(g) || [];
      list.push(opt);
      map.set(g, list);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [options, hasGroups]);

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full min-w-0 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-900 hover:border-slate-300 focus:border-slate-900 focus:outline-none transition-colors ${buttonClassName} ${triggerClassName}`}
      >
        <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">
          {displayLabel}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen &&
        menuPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              width: `${menuPos.width}px`,
              maxHeight: `${menuPos.maxHeight}px`,
            }}
            className="z-[120] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl divide-y divide-slate-100"
          >
            {groupedEntries.map((entry) => (
              <div key={entry.group || '__ungrouped__'} className="divide-y divide-slate-100/70">
                {entry.group && (
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50">
                    {entry.group}
                  </div>
                )}
                {entry.items.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-start justify-between gap-2.5 px-3 py-2.5 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-slate-100 font-semibold text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal break-words leading-relaxed">
                        {opt.label}
                      </span>
                      {isSelected && (
                        <span className="text-slate-900 shrink-0 text-[11px] font-bold mt-0.5">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
