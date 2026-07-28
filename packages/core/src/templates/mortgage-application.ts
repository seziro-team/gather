import type { TemplateBodyInput } from '../template.js';
import { SOURCES } from './sources.js';

/**
 * The borrower-supplied half of a conforming US mortgage file.
 *
 * Built from the CFPB's own loan application packet checklist, with the counts and dating
 * rules taken from the Fannie Mae Selling Guide, which is what the underwriter will
 * actually apply.
 *
 * One deliberate departure from the CFPB list: it names "Social Security number" as
 * something to gather, and this template does not ask the borrower to type one into a
 * text box. Gather encrypts uploaded files at rest; a typed answer is a jsonb value.
 * Asking for the card as a document is the same information with the better handling —
 * and a broker who wants the digits typed can add the item in ten seconds.
 */
export const MORTGAGE_APPLICATION: TemplateBodyInput = {
  sections: [
    {
      title: 'Who you are',
      items: [
        {
          type: 'file',
          label: 'Photo ID for every borrower on the loan',
          helpText: 'A driver’s licence or non-driver state ID. Both sides if the back is used.',
          required: true,
          sources: [SOURCES.cfpbPacketIdentity],
        },
        {
          type: 'file',
          label: 'Social Security card for every borrower',
          required: true,
          sources: [SOURCES.cfpbPacketIdentity],
        },
        {
          type: 'file',
          label: 'Documentation of a recent name change',
          helpText: 'A marriage certificate or court order — only if your name changed recently.',
          required: false,
          sources: [SOURCES.cfpbPacketNameChange],
        },
        {
          type: 'file',
          label: 'Certificate of housing counselling or home buyer education, if you have one',
          required: false,
          sources: [SOURCES.cfpbPacketCounseling],
        },
      ],
    },
    {
      title: 'Income and employment',
      description:
        'Underwriting is dated: statements go stale, so send the most recent ones and expect to refresh them if the file takes a while.',
      items: [
        {
          type: 'file',
          label: 'Pay stubs covering the last 30 days, for every borrower',
          helpText:
            'The most recent stub must be no more than 30 days old at application and must show year-to-date earnings.',
          required: true,
          sources: [SOURCES.cfpbPacketPayStub, SOURCES.fannieePaystub],
        },
        {
          type: 'file',
          label: 'W-2 forms for the last two years',
          helpText: 'A year-end pay stub showing the full year is accepted in place of a W-2.',
          required: true,
          sources: [SOURCES.cfpbPacketW2, SOURCES.fannieW2],
        },
        {
          type: 'file',
          label: 'Signed federal tax returns for the last two years, with every schedule',
          helpText:
            'Copies of the returns actually filed with the IRS. All supporting schedules must be included.',
          required: true,
          sources: [SOURCES.cfpbPacketReturns, SOURCES.fannieReturns],
        },
        {
          type: 'yesno',
          label: 'Is any borrower self-employed or an owner of a business?',
          helpText:
            'If yes, the lender will also need two years of business returns and a separate transcript authorisation.',
          required: true,
          sources: [SOURCES.fannieSelfEmployed],
        },
        {
          type: 'longtext',
          label: 'Any other income you want counted — and what evidences it',
          helpText:
            'Child support, alimony, a pension, rental income, benefits. Tell us what it is and we will tell you what proof the lender needs.',
          required: false,
          sources: [SOURCES.cfpbPacketOtherIncome, SOURCES.cfpbGatherPaperwork],
        },
      ],
    },
    {
      title: 'Assets and the down payment',
      items: [
        {
          type: 'file',
          label: 'The two most recent statements for every bank and investment account',
          helpText:
            'All pages, including the blank ones. Statements must show the institution, your name and at least the last four digits of the account number.',
          required: true,
          sources: [SOURCES.cfpbPacketBankStatements, SOURCES.fannieAssets],
        },
        {
          type: 'yesno',
          label: 'Is your most recent statement more than 45 days old?',
          helpText:
            'If it is, the lender will ask for a fresher one printed by the bank before it can use the account.',
          required: true,
          sources: [SOURCES.fannieAssetsAge],
        },
        {
          type: 'longtext',
          label: 'Where is your down payment coming from?',
          helpText:
            'The lender needs to see at least two months of ownership history for the money, so name every account it will come from.',
          required: true,
          sources: [SOURCES.cfpbPacketDownPayment],
        },
        {
          type: 'file',
          label: 'Gift letter and proof of transfer, if any of the down payment is a gift',
          required: false,
          sources: [SOURCES.cfpbPacketDownPayment],
        },
        {
          type: 'longtext',
          label: 'Explain any deposit on your statements that is not your regular pay',
          helpText:
            'Large or unusual deposits get queried by the underwriter. Getting ahead of them here saves a week later.',
          required: false,
          sources: [SOURCES.cfpbSubmitDocuments],
        },
      ],
    },
    {
      title: 'If it applies to you',
      description: 'Most borrowers can leave this section empty.',
      items: [
        {
          type: 'file',
          label: 'VA Certificate of Eligibility, for a VA loan',
          required: false,
          sources: [SOURCES.cfpbPacketVa, SOURCES.vaCoe],
        },
        {
          type: 'file',
          label: 'Court order and payment record for child support or alimony you receive',
          required: false,
          sources: [SOURCES.cfpbGatherPaperwork],
        },
        {
          type: 'file',
          label: 'Lease agreements and the Schedule E for any rental property you own',
          required: false,
          sources: [SOURCES.cfpbGatherPaperwork, SOURCES.scheduleE],
        },
      ],
    },
  ],
};
