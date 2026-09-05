'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { isAnswered, type ResponseValue, type TemplateItem } from '@gather/core';
import { saveAnswerAction, submitPortalAction } from '@/app/portal/[id]/actions';
import type { PortalFileView, PortalView } from '@/lib/portal-data';
import { FileUpload } from './file-upload';

/**
 * The client's checklist.
 *
 * Two things drive every decision here. The person using it did not choose Gather, did not
 * want another website, and is very likely on a phone — so nothing is behind a menu and
 * nothing needs a manual. And they will close the tab mid-sentence — so every answer is
 * saved as it is typed, and the page says plainly when it has been.
 */

/** Long enough not to post on every keystroke, short enough to survive a closed tab. */
const AUTOSAVE_MS = 700;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface ItemStateMap {
  [itemId: string]: { value: ResponseValue; files: PortalFileView[] };
}

function initialState(view: PortalView): ItemStateMap {
  const state: ItemStateMap = {};
  for (const section of view.sections) {
    for (const entry of section.items) {
      state[entry.item.id] = { value: entry.value, files: entry.files };
    }
  }
  return state;
}

const inputClasses =
  'focus:ring-brand-600 block w-full rounded-lg border-0 bg-white px-3 py-3 text-base ' +
  'text-slate-900 ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2';

export function PortalChecklist({
  requestId,
  view,
  readOnly,
  onSubmitted,
}: {
  requestId: string;
  view: PortalView;
  readOnly: boolean;
  onSubmitted: () => void;
}) {
  const [state, setState] = useState<ItemStateMap>(() => initialState(view));
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queued = useRef(new Map<string, unknown>());

  const flush = useCallback(
    async (itemId: string) => {
      const timer = timers.current.get(itemId);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(itemId);
      }
      if (!queued.current.has(itemId)) return;

      const value = queued.current.get(itemId);
      queued.current.delete(itemId);
      setSaveState((current) => ({ ...current, [itemId]: 'saving' }));

      const result = await saveAnswerAction(requestId, itemId, value);
      if (result.ok) {
        setSaveState((current) => ({ ...current, [itemId]: 'saved' }));
        setErrors((current) => {
          if (!(itemId in current)) return current;
          const next = { ...current };
          delete next[itemId];
          return next;
        });
      } else {
        setSaveState((current) => ({ ...current, [itemId]: 'error' }));
        setErrors((current) => ({ ...current, [itemId]: result.error }));
      }
    },
    [requestId],
  );

  const change = useCallback(
    (itemId: string, value: ResponseValue, immediate: boolean) => {
      setState((current) => ({
        ...current,
        [itemId]: { value, files: current[itemId]?.files ?? [] },
      }));
      queued.current.set(itemId, value);

      const existing = timers.current.get(itemId);
      if (existing) clearTimeout(existing);

      if (immediate) {
        void flush(itemId);
        return;
      }
      setSaveState((current) => ({ ...current, [itemId]: 'pending' }));
      timers.current.set(
        itemId,
        setTimeout(() => void flush(itemId), AUTOSAVE_MS),
      );
    },
    [flush],
  );

  // A phone that gets a call, or a tab that gets closed, does not wait for a debounce.
  // `pagehide` and `visibilitychange` are the last two moments the page reliably gets.
  useEffect(() => {
    const flushAll = () => {
      for (const itemId of [...queued.current.keys()]) void flush(itemId);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onVisibility);
    const pending = timers.current;
    return () => {
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, [flush]);

  const setFiles = useCallback((itemId: string, files: PortalFileView[]) => {
    setState((current) => ({
      ...current,
      [itemId]: { value: current[itemId]?.value ?? null, files },
    }));
  }, []);

  const progress = useMemo(() => {
    let answered = 0;
    let required = 0;
    let requiredAnswered = 0;
    let total = 0;
    for (const section of view.sections) {
      for (const entry of section.items) {
        const current = state[entry.item.id];
        const done = isAnswered(entry.item, current?.value ?? null, current?.files.length ?? 0);
        total += 1;
        if (done) answered += 1;
        if (entry.item.required) {
          required += 1;
          if (done) requiredAnswered += 1;
        }
      }
    }
    return { total, answered, required, requiredAnswered };
  }, [state, view]);

  const outstanding = progress.required - progress.requiredAnswered;

  function submit() {
    setSubmitError(null);
    startSubmit(async () => {
      for (const itemId of [...queued.current.keys()]) await flush(itemId);
      const result = await submitPortalAction(requestId);
      if (result.ok) onSubmitted();
      else setSubmitError(result.error);
    });
  }

  return (
    <div className="space-y-8">
      <ProgressSummary answered={progress.answered} total={progress.total} />

      {view.sections.map((section, sectionIndex) => (
        <section key={section.id} data-testid="portal-section">
          <h2 className="text-lg font-semibold text-slate-900">
            {sectionIndex + 1}. {section.title}
          </h2>
          {section.description ? (
            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
          ) : null}

          <div className="mt-4 space-y-4">
            {section.items.map((entry) => {
              const current = state[entry.item.id] ?? { value: null, files: [] };
              return (
                <ItemCard
                  key={entry.item.id}
                  requestId={requestId}
                  item={entry.item}
                  value={current.value}
                  files={current.files}
                  rejectNote={entry.rejectNote}
                  save={saveState[entry.item.id] ?? 'idle'}
                  error={errors[entry.item.id]}
                  readOnly={readOnly}
                  onValue={change}
                  onFiles={setFiles}
                />
              );
            })}
          </div>
        </section>
      ))}

      {readOnly ? null : (
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-base font-semibold text-slate-900">All done?</h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            {outstanding > 0
              ? `${outstanding} required item${outstanding === 1 ? '' : 's'} still to go. Your answers are already saved — you can come back to this link any time.`
              : 'Everything required is in. Let your accountant know it is ready to review.'}
          </p>
          {submitError ? (
            <p role="alert" className="mb-3 text-sm text-red-700">
              {submitError}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="portal-submit"
            onClick={submit}
            disabled={outstanding > 0 || isSubmitting}
            className="bg-brand-700 hover:bg-brand-800 min-h-12 w-full rounded-lg px-4 text-base font-medium text-white disabled:bg-slate-300 disabled:text-slate-600"
          >
            {isSubmitting ? 'Sending…' : 'Send to my accountant'}
          </button>
        </div>
      )}
    </div>
  );
}

function ProgressSummary({ answered, total }: { answered: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700" data-testid="portal-progress">
          {answered} of {total} done
        </span>
        <span className="text-sm text-slate-500">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Items completed"
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="bg-brand-600 h-full transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label = {
    pending: 'Saving…',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Not saved',
    idle: '',
  }[state];
  return (
    <span
      data-testid="save-state"
      aria-live="polite"
      className={`text-xs ${state === 'error' ? 'text-red-700' : 'text-slate-500'}`}
    >
      {label}
    </span>
  );
}

function ItemCard({
  requestId,
  item,
  value,
  files,
  rejectNote,
  save,
  error,
  readOnly,
  onValue,
  onFiles,
}: {
  requestId: string;
  item: TemplateItem & { id: string };
  value: ResponseValue;
  files: PortalFileView[];
  rejectNote: string | null;
  save: SaveState;
  error?: string;
  readOnly: boolean;
  onValue: (itemId: string, value: ResponseValue, immediate: boolean) => void;
  onFiles: (itemId: string, files: PortalFileView[]) => void;
}) {
  const done = isAnswered(item, value, files.length);

  return (
    <div
      data-testid="portal-item"
      data-answered={done ? 'yes' : 'no'}
      className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5"
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <p className="text-base font-medium break-words text-slate-900">
          {item.label}
          {item.required ? (
            <span className="ml-1 text-red-600" aria-label="required">
              *
            </span>
          ) : null}
        </p>
        {done ? (
          <span
            aria-hidden
            className="mt-0.5 shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset"
          >
            Done
          </span>
        ) : null}
      </div>

      {item.helpText ? <p className="mb-3 text-sm text-slate-600">{item.helpText}</p> : null}

      {rejectNote ? (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Please take another look: </span>
          {rejectNote}
        </p>
      ) : null}

      {item.type === 'file' ? (
        <FileUpload
          requestId={requestId}
          itemId={item.id}
          label={item.label}
          accept={item.config.accept}
          maxFiles={item.config.maxFiles}
          files={files}
          onChange={(next) => onFiles(item.id, next)}
          disabled={readOnly}
        />
      ) : (
        <AnswerControl item={item} value={value} readOnly={readOnly} onValue={onValue} />
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        {error ? (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        ) : (
          <span />
        )}
        <SaveIndicator state={save} />
      </div>
    </div>
  );
}

function AnswerControl({
  item,
  value,
  readOnly,
  onValue,
}: {
  item: TemplateItem & { id: string };
  value: ResponseValue;
  readOnly: boolean;
  onValue: (itemId: string, value: ResponseValue, immediate: boolean) => void;
}) {
  const set = (next: ResponseValue, immediate = true) => onValue(item.id, next, immediate);

  switch (item.type) {
    case 'text':
      return (
        <input
          type="text"
          className={inputClasses}
          aria-label={item.label}
          placeholder={item.config.placeholder}
          maxLength={item.config.maxLength}
          disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => set(event.target.value, false)}
          onBlur={(event) => set(event.target.value)}
        />
      );

    case 'longtext':
      return (
        <textarea
          className={inputClasses}
          rows={4}
          aria-label={item.label}
          placeholder={item.config.placeholder}
          maxLength={item.config.maxLength}
          disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => set(event.target.value, false)}
          onBlur={(event) => set(event.target.value)}
        />
      );

    case 'yesno':
      return (
        <fieldset disabled={readOnly} className="flex gap-3">
          <legend className="sr-only">{item.label}</legend>
          {[
            { label: 'Yes', choice: true },
            { label: 'No', choice: false },
          ].map((option) => (
            <label
              key={option.label}
              className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-base font-medium ring-1 ring-inset ${
                value === option.choice
                  ? 'bg-brand-50 text-brand-900 ring-brand-500'
                  : 'bg-white text-slate-700 ring-slate-300'
              }`}
            >
              <input
                type="radio"
                name={`item-${item.id}`}
                className="sr-only"
                checked={value === option.choice}
                onChange={() => set(option.choice)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );

    case 'date':
      return (
        <input
          type="date"
          className={inputClasses}
          aria-label={item.label}
          min={item.config.min}
          max={item.config.max}
          disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => set(event.target.value || null)}
        />
      );

    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            // `decimal` rather than `numeric`: it gives a phone keypad with a decimal
            // point, which is what someone typing an amount needs.
            inputMode="decimal"
            className={inputClasses}
            aria-label={item.label}
            min={item.config.min}
            max={item.config.max}
            disabled={readOnly}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) =>
              set(event.target.value === '' ? null : Number(event.target.value), false)
            }
            onBlur={(event) => set(event.target.value === '' ? null : Number(event.target.value))}
          />
          {item.config.unit ? (
            <span className="shrink-0 text-sm text-slate-500">{item.config.unit}</span>
          ) : null}
        </div>
      );

    case 'choice': {
      const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      return (
        <fieldset disabled={readOnly} className="space-y-2">
          <legend className="sr-only">{item.label}</legend>
          {item.config.options.map((option) => {
            const selected = chosen.includes(option);
            return (
              <label
                key={option}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-4 py-2 text-base ring-1 ring-inset ${
                  selected
                    ? 'bg-brand-50 text-brand-900 ring-brand-500'
                    : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                <input
                  type={item.config.multiple ? 'checkbox' : 'radio'}
                  name={`item-${item.id}`}
                  className="accent-brand-700 h-5 w-5"
                  checked={selected}
                  onChange={(event) => {
                    if (!item.config.multiple) {
                      set(option);
                      return;
                    }
                    const next = event.target.checked
                      ? [...chosen, option]
                      : chosen.filter((entry) => entry !== option);
                    set(next.length > 0 ? next : null);
                  }}
                />
                <span className="break-words">{option}</span>
              </label>
            );
          })}
        </fieldset>
      );
    }

    case 'file':
      return null;
  }
}
