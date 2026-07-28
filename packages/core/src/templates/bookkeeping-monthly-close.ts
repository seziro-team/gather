import type { TemplateBodyInput } from '../template.js';
import { SOURCES } from './sources.js';

/**
 * The monthly chase, which is the same list every month and is exactly why it is worth
 * automating.
 *
 * Every item is a document the IRS names as a supporting record for a category it expects
 * a business to be able to evidence — receipts, expenses, travel, assets, payroll — plus
 * the bank statement, because Publication 583 is explicit that the account should be
 * reconciled monthly.
 */
export const BOOKKEEPING_MONTHLY_CLOSE: TemplateBodyInput = {
  sections: [
    {
      title: 'Statements',
      description: 'Nothing can be reconciled until these are in. They are the whole month.',
      items: [
        {
          type: 'date',
          label: 'Which month is this for?',
          helpText: 'Use the last day of the month you are sending.',
          required: true,
          sources: [SOURCES.pub583Reconcile],
        },
        {
          type: 'file',
          label: 'Bank statement for every business account',
          helpText: 'The full PDF from the bank, not a screenshot of the balance.',
          required: true,
          sources: [SOURCES.pub583Reconcile],
        },
        {
          type: 'file',
          label: 'Credit card statements for every business card',
          required: true,
          sources: [SOURCES.recordsExpenses, SOURCES.pub583Expenses],
        },
        {
          type: 'file',
          label: 'Loan and line-of-credit statements',
          helpText: 'These carry the interest split we need to post the payment correctly.',
          required: false,
          sources: [SOURCES.pub583Expenses],
        },
      ],
    },
    {
      title: 'Money in',
      items: [
        {
          type: 'file',
          label: 'Merchant processor or payment app settlement reports',
          helpText:
            'Stripe, Square, PayPal, a card terminal. The settlement report, which shows the fees — not just the deposit.',
          required: false,
          sources: [SOURCES.pub583Receipts, SOURCES.form1099K],
        },
        {
          type: 'file',
          label: 'Sales invoices raised this month, if they are not already in the books',
          required: false,
          sources: [SOURCES.pub583Receipts],
        },
        {
          type: 'file',
          label: 'Cash register tapes or daily takings sheets',
          required: false,
          sources: [SOURCES.pub583Receipts],
        },
      ],
    },
    {
      title: 'Money out',
      items: [
        {
          type: 'file',
          label: 'Receipts for the transactions we have queried',
          helpText:
            'We will list them when we send this. A card statement line on its own is not enough to claim a deduction.',
          required: true,
          sources: [SOURCES.recordsExpenses, SOURCES.recordsPurpose],
        },
        {
          type: 'longtext',
          label: 'What was each queried transaction for, and who was it with?',
          helpText:
            'The business purpose, in your words. One line each is plenty — this is what makes the receipt usable.',
          required: false,
          sources: [SOURCES.recordsPurpose, SOURCES.pub463Purpose],
        },
        {
          type: 'file',
          label: 'Mileage log for the month',
          helpText:
            'A log, diary, notebook or app export showing date, miles and the business purpose of each trip.',
          required: false,
          sources: [SOURCES.pub463Log, SOURCES.pub463Purpose],
        },
        {
          type: 'file',
          label: 'Petty cash slips',
          required: false,
          sources: [SOURCES.pub583Expenses],
        },
      ],
    },
    {
      title: 'Payroll, assets and stock',
      items: [
        {
          type: 'file',
          label: 'Payroll reports for the month',
          helpText: 'The provider’s summary showing gross pay, taxes withheld and employer taxes.',
          required: false,
          sources: [SOURCES.recordsEmployment],
        },
        {
          type: 'file',
          label: 'Invoices for anything bought that will last more than a year',
          helpText:
            'Equipment, vehicles, computers, property. These are capitalised rather than expensed, so they need their own paperwork.',
          required: false,
          sources: [SOURCES.pub583Assets],
        },
        {
          type: 'number',
          label: 'Closing stock value, if you hold inventory',
          helpText: 'At cost. Leave blank if the business does not carry stock.',
          required: false,
          config: { min: 0, unit: 'USD' },
          sources: [SOURCES.recordsInventory],
        },
      ],
    },
  ],
};
