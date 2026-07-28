'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { templateBodySchema, type ItemType, type TemplateBody } from '@gather/core';
import { saveRequestStructureAction } from '@/app/(app)/requests/actions';
import { ClientPreview } from '@/components/structure';
import { Alert, Badge, Button, Card, Input, Textarea } from '@/components/ui';
import {
  draftProblems,
  newItem,
  newSection,
  toBody,
  toDraft,
  type DraftItem,
  type DraftSection,
} from './draft';
import { ItemEditor, ItemTypePicker } from './item-editor';
import { moveItem, useReorderable } from './use-reorderable';

function SectionEditor({
  section,
  index,
  total,
  onChange,
  onRemove,
  handleProps,
  dragging,
}: {
  section: DraftSection;
  index: number;
  total: number;
  onChange: (next: DraftSection) => void;
  onRemove: () => void;
  handleProps: Record<string, unknown>;
  dragging: boolean;
}) {
  const moveWithin = useCallback(
    (from: number, to: number) =>
      onChange({ ...section, items: moveItem(section.items, from, to) }),
    [onChange, section],
  );
  const items = useReorderable(
    section.items.length,
    moveWithin,
    `Item in ${section.title || 'this section'}`,
  );

  function patchItem(itemIndex: number, patch: Partial<DraftItem>) {
    const next = [...section.items];
    const current = next[itemIndex];
    if (!current) return;
    next[itemIndex] = { ...current, ...patch };
    onChange({ ...section, items: next });
  }

  return (
    <Card
      data-testid="section"
      className={dragging ? 'ring-brand-400 space-y-4 ring-2' : 'space-y-4'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          {...handleProps}
          className="cursor-grab touch-none rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <span aria-hidden>⠿</span>
        </button>
        <Badge>
          Section {index + 1} of {total}
        </Badge>
        <span className="text-xs text-slate-500">
          {section.items.length} {section.items.length === 1 ? 'item' : 'items'}
        </span>
        <button
          type="button"
          className="ml-auto rounded-md px-2 py-1 text-sm text-slate-500 hover:text-red-700"
          onClick={onRemove}
        >
          Delete section
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Section title</span>
        <Input
          data-testid="section-title"
          value={section.title}
          placeholder="e.g. Income"
          onChange={(event) => onChange({ ...section, title: event.target.value })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Section description (optional)
        </span>
        <Textarea
          rows={2}
          value={section.description}
          onChange={(event) => onChange({ ...section, description: event.target.value })}
        />
      </label>

      {section.items.length > 0 ? (
        <div className="space-y-3">
          {section.items.map((item, itemIndex) => (
            <div key={item.key} data-testid="item" ref={items.setRowRef(itemIndex)}>
              <ItemEditor
                item={item}
                index={itemIndex}
                onChange={(patch) => patchItem(itemIndex, patch)}
                onRemove={() =>
                  onChange({ ...section, items: section.items.filter((_, i) => i !== itemIndex) })
                }
                handleProps={items.handleProps(itemIndex)}
              />
            </div>
          ))}
        </div>
      ) : null}

      <ItemTypePicker
        onAdd={(type: ItemType) =>
          onChange({ ...section, items: [...section.items, newItem(type)] })
        }
      />
    </Card>
  );
}

export function RequestBuilder({
  requestId,
  initialBody,
}: {
  requestId: string;
  initialBody: TemplateBody;
}) {
  const [sections, setSections] = useState<DraftSection[]>(() => toDraft(initialBody));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'preview'>('build');
  const [pending, startTransition] = useTransition();

  const update = useCallback((next: DraftSection[]) => {
    setSections(next);
    setDirty(true);
  }, []);

  // Losing twenty minutes of checklist to a stray tab close is the kind of thing that
  // makes someone go back to email.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const moveSection = useCallback(
    (from: number, to: number) => update(moveItem(sections, from, to)),
    [sections, update],
  );
  const sectionDrag = useReorderable(sections.length, moveSection, 'Section');

  const problems = draftProblems(sections);
  const parsed = templateBodySchema.safeParse(toBody(sections));

  function save() {
    if (problems.length > 0) {
      setError(problems.join('\n'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveRequestStructureAction(requestId, toBody(sections));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSections(toDraft(result.body));
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    });
  }

  const itemCount = sections.reduce((total, section) => total + section.items.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md ring-1 ring-slate-300">
          <button
            type="button"
            onClick={() => setTab('build')}
            aria-pressed={tab === 'build'}
            className={`rounded-l-md px-3 py-1.5 text-sm ${
              tab === 'build' ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'
            }`}
          >
            Build
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            aria-pressed={tab === 'preview'}
            className={`rounded-r-md px-3 py-1.5 text-sm ${
              tab === 'preview' ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'
            }`}
          >
            Client preview
          </button>
        </div>
        <Badge>
          {sections.length} sections · {itemCount} items
        </Badge>
      </div>

      {error ? (
        <Alert tone="error" title="Nothing was saved">
          <ul className="list-inside list-disc">
            {error.split('\n').map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {tab === 'build' ? (
        <div className="space-y-4">
          {sections.map((section, index) => (
            <div key={section.key} ref={sectionDrag.setRowRef(index)}>
              <SectionEditor
                section={section}
                index={index}
                total={sections.length}
                dragging={sectionDrag.draggingIndex === index}
                handleProps={sectionDrag.handleProps(index)}
                onChange={(next) =>
                  update(sections.map((entry, i) => (i === index ? next : entry)))
                }
                onRemove={() => update(sections.filter((_, i) => i !== index))}
              />
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            data-testid="add-section"
            onClick={() => update([...sections, newSection()])}
          >
            Add section
          </Button>
        </div>
      ) : (
        <Card>
          <Alert tone="info" title="This is what your client sees">
            Nothing here is interactive — the working portal is a separate page with its own link
            and session, and arrives in the next release.
          </Alert>
          <div className="mt-6">
            {parsed.success ? (
              <ClientPreview body={parsed.data} />
            ) : (
              <div className="space-y-2 text-sm text-slate-700">
                <p>Finish these before previewing:</p>
                <ul className="list-inside list-disc">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur">
        <Button type="button" onClick={save} disabled={pending} data-testid="save">
          {pending ? 'Saving…' : 'Save checklist'}
        </Button>
        <span data-testid="save-status" className="text-sm text-slate-600">
          {dirty
            ? 'Unsaved changes'
            : savedAt
              ? `Saved at ${savedAt}`
              : 'No changes since it was last saved'}
        </span>
      </div>
    </div>
  );
}
