import {
  countItems,
  parseTemplateBody,
  type TemplateBody,
  type TemplateBodyInput,
} from '../template.js';
import { BOOKKEEPING_MONTHLY_CLOSE } from './bookkeeping-monthly-close.js';
import { MORTGAGE_APPLICATION } from './mortgage-application.js';
import { NEW_BUSINESS_ONBOARDING } from './new-business-onboarding.js';
import { US_INDIVIDUAL_TAX_YEAR_END } from './us-individual-tax-year-end.js';

export { SOURCES, type SourceKey } from './sources.js';

export interface BuiltinTemplate {
  /** Stable identifier. Never change one: firms' requests record it in `template_key`. */
  key: string;
  name: string;
  description: string;
  /** Whose rules the checklist follows, shown wherever the template is offered. */
  jurisdiction: string;
  body: TemplateBody;
}

/**
 * Parsing at module load is deliberate. A built-in that fails validation should stop the
 * process on import — during `pnpm test` and during boot — rather than reach a firm.
 */
function defineBuiltin(input: {
  key: string;
  name: string;
  description: string;
  jurisdiction: string;
  body: TemplateBodyInput;
}): BuiltinTemplate {
  return { ...input, body: parseTemplateBody(input.body) };
}

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  defineBuiltin({
    key: 'us-individual-tax-year-end',
    name: 'US individual tax return — year-end documents',
    description:
      'Everything needed to prepare a Form 1040: identity, income statements, deduction records and payment details.',
    jurisdiction: 'United States — IRS',
    body: US_INDIVIDUAL_TAX_YEAR_END,
  }),
  defineBuiltin({
    key: 'new-business-onboarding',
    name: 'New business client onboarding',
    description:
      'Entity paperwork, IRS authorisations, the books and payroll — what a firm needs before it can start work.',
    jurisdiction: 'United States — IRS and SBA',
    body: NEW_BUSINESS_ONBOARDING,
  }),
  defineBuiltin({
    key: 'mortgage-application',
    name: 'Mortgage application documents',
    description:
      'The borrower-supplied file for a conforming loan, with the dating rules an underwriter will actually apply.',
    jurisdiction: 'United States — CFPB and Fannie Mae Selling Guide',
    body: MORTGAGE_APPLICATION,
  }),
  defineBuiltin({
    key: 'bookkeeping-monthly-close',
    name: 'Monthly bookkeeping close',
    description: 'The same list every month: statements, money in, money out, payroll and assets.',
    jurisdiction: 'United States — IRS recordkeeping guidance',
    body: BOOKKEEPING_MONTHLY_CLOSE,
  }),
];

export function findBuiltinTemplate(key: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((template) => template.key === key);
}

/** `{ key: itemCount }`, used by the docs generator and by the tests that guard it. */
export function builtinItemCounts(): Record<string, number> {
  return Object.fromEntries(
    BUILTIN_TEMPLATES.map((template) => [template.key, countItems(template.body)]),
  );
}
