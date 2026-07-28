import type { TemplateBodyInput } from '../template.js';
import { SOURCES } from './sources.js';

/**
 * The documents a US firm needs to prepare an individual Form 1040.
 *
 * Transcribed from the IRS's own taxpayer-facing checklists plus the "About Form …" page
 * for each information return named. Optional items are optional because they only apply
 * to some taxpayers — not because they matter less.
 */
export const US_INDIVIDUAL_TAX_YEAR_END: TemplateBodyInput = {
  sections: [
    {
      title: 'Who is on the return',
      description:
        'We need these before anything else — a return cannot be filed without matching names, numbers and dates of birth.',
      items: [
        {
          type: 'file',
          label: 'Photo ID for you, and for your spouse if you file jointly',
          helpText: 'A driver’s licence, state ID, passport or military ID. A clear photo is fine.',
          required: true,
          sources: [SOURCES.vitaPhotoId],
        },
        {
          type: 'file',
          label: 'Social Security cards for everyone on the return',
          helpText:
            'You, your spouse and every dependent. An ITIN notice CP-01A works in place of a card.',
          required: true,
          sources: [SOURCES.vitaSsnCards],
        },
        {
          type: 'longtext',
          label: 'Full name and date of birth for each dependent',
          helpText: 'One per line, exactly as written on their Social Security card.',
          required: false,
          config: { placeholder: 'Jane Q. Doe — 2014-03-11' },
          sources: [SOURCES.vitaBirthDates],
        },
        {
          type: 'file',
          label: 'Last year’s federal and state tax returns',
          helpText: 'Skip this if we prepared them for you — we already have them.',
          required: false,
          sources: [SOURCES.vitaPriorReturn],
        },
        {
          type: 'text',
          label: 'Identity Protection PIN, if the IRS issued you one',
          helpText:
            'A six-digit number the IRS sends on Notice CP01A each year. Without it, an e-filed return is rejected.',
          required: false,
          config: { maxLength: 6, placeholder: '123456' },
          sources: [SOURCES.ipPin, SOURCES.getReady],
        },
      ],
    },
    {
      title: 'Income',
      description: 'Every statement you received, even if you think it is too small to matter.',
      items: [
        {
          type: 'file',
          label: 'Form W-2 from every employer',
          helpText: 'One from each job either of you held during the year.',
          required: true,
          sources: [SOURCES.vitaWageStatements, SOURCES.formW2],
        },
        {
          type: 'file',
          label: 'Forms 1099-NEC and 1099-MISC for contract or freelance work',
          required: false,
          sources: [SOURCES.form1099Nec, SOURCES.vitaWageStatements],
        },
        {
          type: 'file',
          label: 'Form 1099-K from payment apps, marketplaces and card processors',
          helpText:
            'Sales through platforms like eBay, Etsy or a card reader are reported to the IRS on this form.',
          required: false,
          sources: [SOURCES.form1099K],
        },
        {
          type: 'file',
          label: 'Bank and brokerage tax forms — 1099-INT, 1099-DIV and 1099-B',
          helpText:
            'Most brokers issue one consolidated statement covering all three. That is all we need.',
          required: false,
          sources: [
            SOURCES.vitaInterestDividends,
            SOURCES.form1099Int,
            SOURCES.form1099Div,
            SOURCES.form1099B,
          ],
        },
        {
          type: 'file',
          label: 'Form 1099-R for pensions, annuities, IRA or 401(k) withdrawals',
          required: false,
          sources: [SOURCES.form1099R],
        },
        {
          type: 'file',
          label: 'Form SSA-1099 Social Security benefit statement',
          required: false,
          sources: [SOURCES.vitaSsa1099],
        },
        {
          type: 'file',
          label: 'Form 1099-G for unemployment compensation or a state tax refund',
          required: false,
          sources: [SOURCES.form1099G],
        },
        {
          type: 'file',
          label: 'Schedule K-1 from any partnership, S corporation or trust',
          helpText: 'These often arrive late. Send what you have and tell us what is still coming.',
          required: false,
          sources: [SOURCES.scheduleK1_1065, SOURCES.scheduleK1_1120s],
        },
        {
          type: 'yesno',
          label:
            'Did you receive, sell, exchange or otherwise dispose of any digital assets this year?',
          helpText:
            'Form 1040 asks this question directly, and it must be answered whether or not you owe anything.',
          required: true,
          sources: [SOURCES.digitalAssets],
        },
      ],
    },
    {
      title: 'Deductions and credits',
      description:
        'Send these even if you took the standard deduction last year — the threshold moves.',
      items: [
        {
          type: 'file',
          label: 'Form 1098 mortgage interest statement',
          required: false,
          sources: [SOURCES.form1098, SOURCES.scheduleA],
        },
        {
          type: 'file',
          label: 'State and local property tax bills paid during the year',
          required: false,
          sources: [SOURCES.scheduleA],
        },
        {
          type: 'file',
          label: 'Forms 1098-T and 1098-E for tuition and student loan interest',
          required: false,
          sources: [SOURCES.form1098T, SOURCES.form1098E],
        },
        {
          type: 'file',
          label: 'Form 1095-A, if anyone on the return had Marketplace health coverage',
          helpText:
            'Required to reconcile any advance premium tax credit. A return filed without it will be held up.',
          required: false,
          sources: [SOURCES.vitaMarketplace, SOURCES.form1095A],
        },
        {
          type: 'file',
          label: 'Charitable contribution receipts and written acknowledgements',
          helpText:
            'A written acknowledgement from the charity is required for any single gift of $250 or more.',
          required: false,
          sources: [SOURCES.pub526],
        },
        {
          type: 'file',
          label: 'Medical and dental expense records',
          helpText: 'Only worth sending if the total was a large share of your income.',
          required: false,
          sources: [SOURCES.pub502],
        },
        {
          type: 'longtext',
          label: 'Childcare provider — name, address, taxpayer ID, and the total you paid',
          required: false,
          sources: [SOURCES.vitaDaycare, SOURCES.form2441],
        },
        {
          type: 'file',
          label: 'Form 5498 or year-end statements for IRA and HSA contributions',
          required: false,
          sources: [SOURCES.form5498],
        },
      ],
    },
    {
      title: 'Payments and filing',
      items: [
        {
          type: 'number',
          label: 'Total federal estimated tax payments you made for the year',
          helpText: 'Leave blank if you made none.',
          required: false,
          config: { min: 0, unit: 'USD' },
          sources: [SOURCES.form1040Es],
        },
        {
          type: 'file',
          label: 'A voided check or bank letter for direct deposit',
          helpText:
            'Only needed if your account has changed, or this is your first return with us.',
          required: false,
          sources: [SOURCES.vitaDirectDeposit],
        },
        {
          type: 'yesno',
          label: 'Has your address, marital status or number of dependents changed this year?',
          helpText: 'If yes, tell us what changed when you submit — it affects several schedules.',
          required: true,
          sources: [SOURCES.getReady],
        },
      ],
    },
  ],
};
