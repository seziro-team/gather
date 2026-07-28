import { ITEM_TYPE_LABELS, type TemplateBody, type TemplateItem } from '@gather/core';
import { Badge } from './ui';

/**
 * Read-only renderings of a request structure.
 *
 * `StructureOutline` is the firm's view — what the checklist contains. `ClientPreview` is
 * the client's view, rendered from the same data with the real controls so a firm can see
 * what it is about to ask for. The preview is inert on purpose: the working portal is a
 * separate surface with its own session, and a half-live form here would be a lie.
 */

export function StructureOutline({
  body,
  showSources = false,
}: {
  body: TemplateBody;
  showSources?: boolean;
}) {
  if (body.sections.length === 0) {
    return <p className="text-sm text-slate-600">This request has no sections yet.</p>;
  }

  return (
    <div className="space-y-6">
      {body.sections.map((section, sectionIndex) => (
        <section key={section.id ?? sectionIndex}>
          <h3 className="text-base font-semibold text-slate-900">
            {sectionIndex + 1}. {section.title}
          </h3>
          {section.description ? (
            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
          ) : null}

          {section.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No items in this section.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {section.items.map((item, itemIndex) => (
                <li key={item.id ?? itemIndex} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-slate-400">
                      {sectionIndex + 1}.{itemIndex + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{item.label}</span>
                    <Badge>{ITEM_TYPE_LABELS[item.type]}</Badge>
                    {item.required ? <Badge tone="brand">Required</Badge> : null}
                  </div>
                  {item.helpText ? (
                    <p className="mt-1 text-sm text-slate-600">{item.helpText}</p>
                  ) : null}
                  {showSources && item.sources.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {item.sources.map((source) => (
                        <li key={`${source.url}${source.quote ?? ''}`} className="text-xs">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-brand-700 underline"
                          >
                            {source.label}
                          </a>
                          {source.quote ? (
                            <span className="mt-0.5 block border-l-2 border-slate-200 pl-2 text-slate-500 italic">
                              “{source.quote}”
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function PreviewControl({ item }: { item: TemplateItem }) {
  const inputClasses =
    'block w-full rounded-md border-0 bg-white px-3 py-2.5 text-slate-900 ring-1 ring-slate-300 ring-inset';

  switch (item.type) {
    case 'file': {
      const limits = [
        item.config.accept && item.config.accept.length > 0
          ? `Accepts ${item.config.accept.join(', ')}`
          : null,
        item.config.maxFiles ? `Up to ${item.config.maxFiles} files` : null,
      ].filter(Boolean);
      return (
        <div className="rounded-md border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Drop a file here, or take a photo
          {limits.length > 0 ? (
            <span className="mt-1 block text-xs">{limits.join(' · ')}</span>
          ) : null}
        </div>
      );
    }
    case 'text':
      return <input className={inputClasses} placeholder={item.config.placeholder} readOnly />;
    case 'longtext':
      return (
        <textarea
          className={inputClasses}
          rows={3}
          placeholder={item.config.placeholder}
          readOnly
        />
      );
    case 'yesno':
      return (
        <div className="flex gap-4 text-sm text-slate-700">
          {['Yes', 'No'].map((option) => (
            <span key={option} className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded-full ring-1 ring-slate-400" />
              {option}
            </span>
          ))}
        </div>
      );
    case 'date':
      return (
        <div>
          <input type="date" className={inputClasses} readOnly />
          {item.config.min || item.config.max ? (
            <p className="mt-1 text-xs text-slate-500">
              {item.config.min ? `From ${item.config.min}` : null}
              {item.config.min && item.config.max ? ' · ' : null}
              {item.config.max ? `To ${item.config.max}` : null}
            </p>
          ) : null}
        </div>
      );
    case 'choice':
      return (
        <div className="space-y-1.5 text-sm text-slate-700">
          {item.config.options.map((option) => (
            <span key={option} className="flex items-center gap-2">
              <span
                className={`h-4 w-4 ring-1 ring-slate-400 ${
                  item.config.multiple ? 'rounded-sm' : 'rounded-full'
                }`}
              />
              {option}
            </span>
          ))}
        </div>
      );
    case 'number':
      return (
        <div>
          <div className="flex items-center gap-2">
            <input type="number" className={inputClasses} readOnly />
            {item.config.unit ? (
              <span className="text-sm text-slate-500">{item.config.unit}</span>
            ) : null}
          </div>
          {item.config.min !== undefined || item.config.max !== undefined ? (
            <p className="mt-1 text-xs text-slate-500">
              {item.config.min !== undefined ? `Minimum ${item.config.min}` : null}
              {item.config.min !== undefined && item.config.max !== undefined ? ' · ' : null}
              {item.config.max !== undefined ? `Maximum ${item.config.max}` : null}
            </p>
          ) : null}
        </div>
      );
  }
}

export function ClientPreview({ body }: { body: TemplateBody }) {
  const total = body.sections.reduce((sum, section) => sum + section.items.length, 0);

  if (total === 0) {
    return (
      <p className="text-sm text-slate-600">
        Add an item and it will appear here exactly as your client will see it.
      </p>
    );
  }

  return (
    <fieldset disabled className="space-y-8">
      {body.sections.map((section, sectionIndex) => (
        <div key={section.id ?? sectionIndex}>
          <h3 className="text-lg font-semibold text-slate-900">{section.title}</h3>
          {section.description ? (
            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
          ) : null}
          <div className="mt-4 space-y-5">
            {section.items.map((item, itemIndex) => (
              <div key={item.id ?? itemIndex}>
                <p className="text-sm font-medium text-slate-800">
                  {item.label}
                  {item.required ? <span className="ml-1 text-red-600">*</span> : null}
                </p>
                {item.helpText ? (
                  <p className="mt-0.5 mb-2 text-sm text-slate-500">{item.helpText}</p>
                ) : (
                  <div className="mb-2" />
                )}
                <PreviewControl item={item} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
