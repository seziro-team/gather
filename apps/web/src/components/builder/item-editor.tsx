'use client';

import type { ReactNode } from 'react';
import { ITEM_TYPE_LABELS } from '@gather/core';
import { Badge, Input, Textarea } from '@/components/ui';
import type { DraftItem } from './draft';

const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600';

function Small({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/** The type-specific half of an item's settings. Every control here is rendered by the preview. */
function ConfigEditor({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
}) {
  switch (item.type) {
    case 'file':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Small label="Accepted file types (optional)">
            <Input
              value={item.accept}
              placeholder=".pdf, .jpg, .png"
              onChange={(event) => onChange({ accept: event.target.value })}
            />
          </Small>
          <Small label="Maximum number of files (optional)">
            <Input
              type="number"
              min={1}
              max={50}
              value={item.maxFiles}
              onChange={(event) => onChange({ maxFiles: event.target.value })}
            />
          </Small>
        </div>
      );
    case 'text':
    case 'longtext':
      return (
        <Small label="Placeholder (optional)">
          <Input
            value={item.placeholder}
            onChange={(event) => onChange({ placeholder: event.target.value })}
          />
        </Small>
      );
    case 'date':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Small label="Earliest allowed (optional)">
            <Input
              type="date"
              value={item.dateMin}
              onChange={(event) => onChange({ dateMin: event.target.value })}
            />
          </Small>
          <Small label="Latest allowed (optional)">
            <Input
              type="date"
              value={item.dateMax}
              onChange={(event) => onChange({ dateMax: event.target.value })}
            />
          </Small>
        </div>
      );
    case 'number':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Small label="Minimum (optional)">
            <Input
              type="number"
              value={item.numberMin}
              onChange={(event) => onChange({ numberMin: event.target.value })}
            />
          </Small>
          <Small label="Maximum (optional)">
            <Input
              type="number"
              value={item.numberMax}
              onChange={(event) => onChange({ numberMax: event.target.value })}
            />
          </Small>
          <Small label="Unit (optional)">
            <Input
              value={item.unit}
              placeholder="USD"
              onChange={(event) => onChange({ unit: event.target.value })}
            />
          </Small>
        </div>
      );
    case 'choice':
      return (
        <div className="space-y-2">
          <span className={fieldLabel}>Options</span>
          {item.options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={option}
                aria-label={`Option ${index + 1}`}
                onChange={(event) => {
                  const options = [...item.options];
                  options[index] = event.target.value;
                  onChange({ options });
                }}
              />
              <button
                type="button"
                className="rounded-md px-2 text-sm text-slate-500 hover:text-red-700"
                aria-label={`Remove option ${index + 1}`}
                disabled={item.options.length <= 2}
                onClick={() => onChange({ options: item.options.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="text-brand-700 text-sm underline"
              onClick={() => onChange({ options: [...item.options, ''] })}
            >
              Add option
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={item.multiple}
                onChange={(event) => onChange({ multiple: event.target.checked })}
              />
              Allow more than one answer
            </label>
          </div>
        </div>
      );
    case 'yesno':
      return null;
  }
}

export function ItemEditor({
  item,
  index,
  onChange,
  onRemove,
  handleProps,
}: {
  item: DraftItem;
  index: number;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
  handleProps: Record<string, unknown>;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          {...handleProps}
          className="cursor-grab touch-none rounded px-1.5 py-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        >
          <span aria-hidden>⠿</span>
        </button>
        <Badge>{ITEM_TYPE_LABELS[item.type]}</Badge>
        <span className="font-mono text-xs text-slate-400">#{index + 1}</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={item.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          Required
        </label>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-red-700"
          onClick={onRemove}
        >
          Delete
        </button>
      </div>

      <Small label="What are you asking for?">
        <Input
          value={item.label}
          placeholder="e.g. Form W-2 from every employer"
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </Small>

      <Small label="Help text (optional)">
        <Textarea
          rows={2}
          value={item.helpText}
          placeholder="Anything that stops the client guessing."
          onChange={(event) => onChange({ helpText: event.target.value })}
        />
      </Small>

      <ConfigEditor item={item} onChange={onChange} />
    </div>
  );
}

export function ItemTypePicker({ onAdd }: { onAdd: (type: DraftItem['type']) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-600">Add an item:</span>
      {(Object.keys(ITEM_TYPE_LABELS) as DraftItem['type'][]).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onAdd(type)}
          className="rounded-md bg-white px-2.5 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          + {ITEM_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
