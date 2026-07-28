import type { TemplateBodyInput } from '../template.js';
import { SOURCES } from './sources.js';

/**
 * What a US accounting or bookkeeping firm needs before it can take on a new business
 * client — entity paperwork, the authorisations that let the firm act, the books, and
 * payroll if there is any.
 *
 * Every item maps to a document the IRS or SBA names. Deliberately not included: an
 * engagement letter or fee agreement. Those are the firm's own paperwork, they differ in
 * every jurisdiction and practice, and there is no published source to transcribe them
 * from — so Gather does not invent one. Add your own item for it.
 */
export const NEW_BUSINESS_ONBOARDING: TemplateBodyInput = {
  sections: [
    {
      title: 'The entity',
      description: 'How the business is set up decides which returns it files.',
      items: [
        {
          type: 'choice',
          label: 'How is the business set up?',
          helpText:
            'If you are not sure, send us the formation documents below and we will tell you.',
          required: true,
          config: {
            options: [
              'Sole proprietorship',
              'Partnership',
              'C corporation',
              'S corporation',
              'Limited liability company (LLC)',
              'Not sure',
            ],
          },
          sources: [SOURCES.businessStructures],
        },
        {
          type: 'file',
          label: 'EIN confirmation letter (IRS Notice CP 575), or your filed Form SS-4',
          helpText:
            'The letter the IRS sent when the EIN was issued. If it is lost, we can request a replacement letter.',
          required: true,
          sources: [SOURCES.formSs4],
        },
        {
          type: 'file',
          label:
            'Formation documents — articles of incorporation or organisation, and the operating or partnership agreement',
          required: true,
          sources: [SOURCES.sbaRegister],
        },
        {
          type: 'file',
          label: 'Form 2553 S corporation election, if the business made one',
          helpText: 'Include the IRS acceptance letter if you received one.',
          required: false,
          sources: [SOURCES.form2553],
        },
        {
          type: 'date',
          label: 'Date the business started trading',
          helpText:
            'The first day it took money or incurred costs — not the date it was registered.',
          required: true,
          sources: [SOURCES.startingABusiness],
        },
        {
          type: 'text',
          label: 'Which state or states is the business registered in?',
          required: true,
          config: { placeholder: 'e.g. Delaware, plus foreign registration in New York' },
          sources: [SOURCES.sbaRegister],
        },
      ],
    },
    {
      title: 'Tax filings and authorisations',
      description: 'Without these we cannot see your account or speak to the IRS on your behalf.',
      items: [
        {
          type: 'file',
          label: 'The last two filed business tax returns',
          helpText:
            'Form 1065, 1120, 1120-S, or the Schedule C from your personal return — whichever applies.',
          required: false,
          sources: [SOURCES.form1065, SOURCES.form1120, SOURCES.form1120S, SOURCES.scheduleC],
        },
        {
          type: 'file',
          label: 'Signed Form 2848 or Form 8821',
          helpText:
            'Form 2848 lets us represent you before the IRS; Form 8821 only lets us see your information. We will tell you which one we sent.',
          required: true,
          sources: [SOURCES.form2848, SOURCES.form8821],
        },
        {
          type: 'file',
          label: 'Completed Form W-9 for the business',
          required: true,
          sources: [SOURCES.formW9],
        },
        {
          type: 'file',
          label: 'Most recent depreciation schedule or fixed asset register',
          helpText:
            'Usually the last page of the prior year return. Without it we cannot continue depreciation correctly.',
          required: false,
          sources: [SOURCES.form4562],
        },
        {
          type: 'yesno',
          label:
            'Has the business changed its name, address or responsible party since its last filing?',
          helpText: 'If yes, we will file Form 8822-B for you.',
          required: true,
          sources: [SOURCES.form8822B],
        },
      ],
    },
    {
      title: 'Books and banking',
      items: [
        {
          type: 'text',
          label: 'Where are the books kept?',
          helpText:
            'The accounting software you use, or tell us it is a spreadsheet or a paper ledger. Any of those is fine.',
          required: true,
          config: { placeholder: 'e.g. QuickBooks Online, Xero, a spreadsheet' },
          sources: [SOURCES.pub583Books],
        },
        {
          type: 'file',
          label: 'Accounting file, trial balance or year-to-date profit and loss',
          required: true,
          sources: [SOURCES.pub583Books],
        },
        {
          type: 'file',
          label: 'Bank statements for every business account, year to date',
          required: true,
          sources: [SOURCES.pub583Reconcile],
        },
        {
          type: 'file',
          label: 'Merchant processor, loan and line-of-credit statements',
          required: false,
          sources: [SOURCES.pub583Receipts, SOURCES.pub583Expenses],
        },
      ],
    },
    {
      title: 'Payroll',
      description: 'Skip this section entirely if the business has never had an employee.',
      items: [
        {
          type: 'yesno',
          label: 'Does the business have employees?',
          helpText: 'Contractors paid on a 1099 do not count as employees here.',
          required: true,
          sources: [SOURCES.employmentTaxes],
        },
        {
          type: 'file',
          label: 'The four most recent Forms 941 and your state payroll filings',
          required: false,
          sources: [SOURCES.form941],
        },
        {
          type: 'file',
          label: 'Form W-4 and Form I-9 for each employee',
          helpText:
            'Every employer must hold a completed I-9 for each employee and a W-4 for withholding.',
          required: false,
          sources: [SOURCES.pub15W4, SOURCES.pub15I9],
        },
      ],
    },
  ],
};
