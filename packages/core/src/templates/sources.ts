import type { TemplateSource } from '../template.js';

/**
 * Every published document the built-in templates are transcribed from.
 *
 * Read live on 2026-07-28; each URL returned HTTP 200 on that date. Quotes are verbatim
 * from the page named. Nothing in a built-in template exists without an entry here — that
 * rule is enforced by `template.test.ts`, not by good intentions.
 *
 * When one of these pages changes, the corresponding item changes with it. Tax forms and
 * lender requirements move; a checklist that silently goes stale is worse than no
 * checklist, because a firm will trust it.
 */

function source(label: string, url: string, quote?: string): TemplateSource {
  return quote === undefined ? { label, url } : { label, url, quote };
}

export const SOURCES = {
  // ---- Individual tax ----------------------------------------------------------------
  vitaChecklist: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
  ),
  vitaPhotoId: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Original photo identification for you and your spouse (if married filing jointly)',
  ),
  vitaSsnCards: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Social Security cards for you, your spouse and dependents',
  ),
  vitaBirthDates: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Birth dates for you, your spouse and dependents on the tax return',
  ),
  vitaPriorReturn: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    "A copy of last year's federal and state returns, if available",
  ),
  vitaWageStatements: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Wage and earning statements (Form W-2, W-2G, 1099-R, 1099-MISC) from all employers',
  ),
  vitaInterestDividends: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Interest and dividend statements from banks (Forms 1099)',
  ),
  vitaSsa1099: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Social Security Benefit Statements (SSA-1099), if applicable',
  ),
  vitaMarketplace: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Forms 1095-A, Health Insurance Marketplace Statement',
  ),
  vitaDaycare: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    "Total paid for daycare provider and the daycare provider's tax identifying number",
  ),
  vitaDirectDeposit: source(
    'IRS — Checklist for free tax return preparation',
    'https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation',
    'Proof of bank account routing and account numbers for direct deposit, such as a blank check',
  ),
  getReady: source(
    'IRS — Get ready to file your taxes',
    'https://www.irs.gov/individuals/get-ready-to-file-your-taxes',
  ),
  formW2: source('IRS — About Form W-2', 'https://www.irs.gov/forms-pubs/about-form-w-2'),
  form1099Nec: source(
    'IRS — About Form 1099-NEC',
    'https://www.irs.gov/forms-pubs/about-form-1099-nec',
  ),
  form1099K: source('IRS — About Form 1099-K', 'https://www.irs.gov/forms-pubs/about-form-1099-k'),
  form1099Int: source(
    'IRS — About Form 1099-INT',
    'https://www.irs.gov/forms-pubs/about-form-1099-int',
  ),
  form1099Div: source(
    'IRS — About Form 1099-DIV',
    'https://www.irs.gov/forms-pubs/about-form-1099-div',
  ),
  form1099B: source('IRS — About Form 1099-B', 'https://www.irs.gov/forms-pubs/about-form-1099-b'),
  form1099R: source('IRS — About Form 1099-R', 'https://www.irs.gov/forms-pubs/about-form-1099-r'),
  form1099G: source('IRS — About Form 1099-G', 'https://www.irs.gov/forms-pubs/about-form-1099-g'),
  form1098: source('IRS — About Form 1098', 'https://www.irs.gov/forms-pubs/about-form-1098'),
  form1098T: source('IRS — About Form 1098-T', 'https://www.irs.gov/forms-pubs/about-form-1098-t'),
  form1098E: source('IRS — About Form 1098-E', 'https://www.irs.gov/forms-pubs/about-form-1098-e'),
  form1095A: source('IRS — About Form 1095-A', 'https://www.irs.gov/forms-pubs/about-form-1095-a'),
  form5498: source('IRS — About Form 5498', 'https://www.irs.gov/forms-pubs/about-form-5498'),
  form2441: source('IRS — About Form 2441', 'https://www.irs.gov/forms-pubs/about-form-2441'),
  form1040Es: source(
    'IRS — About Form 1040-ES',
    'https://www.irs.gov/forms-pubs/about-form-1040-es',
  ),
  scheduleA: source(
    'IRS — About Schedule A (Form 1040)',
    'https://www.irs.gov/forms-pubs/about-schedule-a-form-1040',
  ),
  scheduleE: source(
    'IRS — About Schedule E (Form 1040)',
    'https://www.irs.gov/forms-pubs/about-schedule-e-form-1040',
  ),
  scheduleK1_1065: source(
    "IRS — Partner's Instructions for Schedule K-1 (Form 1065)",
    'https://www.irs.gov/instructions/i1065sk1',
  ),
  scheduleK1_1120s: source(
    'IRS — About Schedule K-1 (Form 1120-S)',
    'https://www.irs.gov/forms-pubs/about-schedule-k-1-form-1120-s',
  ),
  pub526: source(
    'IRS — Publication 526, Charitable Contributions',
    'https://www.irs.gov/publications/p526',
  ),
  pub502: source(
    'IRS — Publication 502, Medical and Dental Expenses',
    'https://www.irs.gov/publications/p502',
  ),
  digitalAssets: source('IRS — Digital assets', 'https://www.irs.gov/filing/digital-assets'),
  ipPin: source(
    'IRS — Get an identity protection PIN',
    'https://www.irs.gov/identity-theft-fraud-scams/get-an-identity-protection-pin',
  ),

  // ---- Business ----------------------------------------------------------------------
  businessStructures: source(
    'IRS — Business structures',
    'https://www.irs.gov/businesses/small-businesses-self-employed/business-structures',
  ),
  startingABusiness: source(
    'IRS — Starting a business',
    'https://www.irs.gov/businesses/small-businesses-self-employed/starting-a-business',
  ),
  formSs4: source('IRS — About Form SS-4', 'https://www.irs.gov/forms-pubs/about-form-ss-4'),
  form2553: source('IRS — About Form 2553', 'https://www.irs.gov/forms-pubs/about-form-2553'),
  form2848: source('IRS — About Form 2848', 'https://www.irs.gov/forms-pubs/about-form-2848'),
  form8821: source('IRS — About Form 8821', 'https://www.irs.gov/forms-pubs/about-form-8821'),
  formW9: source('IRS — About Form W-9', 'https://www.irs.gov/forms-pubs/about-form-w-9'),
  form8822B: source('IRS — About Form 8822-B', 'https://www.irs.gov/forms-pubs/about-form-8822-b'),
  form4562: source('IRS — About Form 4562', 'https://www.irs.gov/forms-pubs/about-form-4562'),
  form1065: source('IRS — About Form 1065', 'https://www.irs.gov/forms-pubs/about-form-1065'),
  form1120: source('IRS — About Form 1120', 'https://www.irs.gov/forms-pubs/about-form-1120'),
  form1120S: source('IRS — About Form 1120-S', 'https://www.irs.gov/forms-pubs/about-form-1120-s'),
  scheduleC: source(
    'IRS — About Schedule C (Form 1040)',
    'https://www.irs.gov/forms-pubs/about-schedule-c-form-1040',
  ),
  form941: source('IRS — About Form 941', 'https://www.irs.gov/forms-pubs/about-form-941'),
  employmentTaxes: source(
    'IRS — Employment taxes',
    'https://www.irs.gov/businesses/small-businesses-self-employed/employment-taxes',
  ),
  pub15I9: source(
    'IRS — Publication 15 (Circular E)',
    'https://www.irs.gov/publications/p15',
    'You must verify that each new employee is legally eligible to work in the United States … completing the U.S. Citizenship and Immigration Services (USCIS) Form I-9, Employment Eligibility Verification.',
  ),
  pub15W4: source(
    'IRS — Publication 15 (Circular E)',
    'https://www.irs.gov/publications/p15',
    'Ask each new employee to complete the 2026 Form W-4.',
  ),
  sbaRegister: source(
    'SBA — Register your business',
    'https://www.sba.gov/business-guide/launch-your-business/register-your-business',
  ),

  // ---- Recordkeeping (monthly close) -------------------------------------------------
  pub583Receipts: source(
    'IRS — Publication 583, Starting a Business and Keeping Records',
    'https://www.irs.gov/publications/p583',
    'Cash register tapes. Bank deposit slips. Receipt books. Invoices. Credit card charge slips. Forms 1099-MISC. Forms 1099-NEC.',
  ),
  pub583Expenses: source(
    'IRS — Publication 583, Starting a Business and Keeping Records',
    'https://www.irs.gov/publications/p583',
    'Canceled checks. Cash register tapes. Account statements. Credit card sales slips. Invoices. Petty cash slips for small cash payments.',
  ),
  pub583Assets: source(
    'IRS — Publication 583, Starting a Business and Keeping Records',
    'https://www.irs.gov/publications/p583',
    'Purchase and sales invoices. Real estate closing statements. Canceled checks.',
  ),
  pub583Reconcile: source(
    'IRS — Publication 583, Starting a Business and Keeping Records',
    'https://www.irs.gov/publications/p583',
    'When you receive your bank statement, make sure the statement, your checkbook, and your books agree. … You should reconcile your checking account each month.',
  ),
  pub583Books: source(
    'IRS — Publication 583, Starting a Business and Keeping Records',
    'https://www.irs.gov/publications/p583',
    'Your recordkeeping system should include a summary of your business transactions ordinarily made in your books (for example, accounting journals and ledgers).',
  ),
  recordsExpenses: source(
    'IRS — What kind of records should I keep',
    'https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep',
    'Canceled checks or other documents reflecting proof of payment/electronic funds transferred',
  ),
  recordsPurpose: source(
    'IRS — What kind of records should I keep',
    'https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep',
    'Your supporting documents should show the amount paid and that the amount was for a business expense.',
  ),
  recordsInventory: source(
    'IRS — What kind of records should I keep',
    'https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep',
    'Your supporting documents should show the amount paid and that the amount was for inventory.',
  ),
  recordsEmployment: source(
    'IRS — What kind of records should I keep',
    'https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep',
    'Keep all records of employment for at least four years.',
  ),
  pub463Log: source(
    'IRS — Publication 463, Travel, Gift, and Car Expenses',
    'https://www.irs.gov/publications/p463',
    'use a log, diary, notebook, or any other written record to keep track of your expenses',
  ),
  pub463Purpose: source(
    'IRS — Publication 463, Travel, Gift, and Car Expenses',
    'https://www.irs.gov/publications/p463',
    'the time, place, and business purpose of your travel',
  ),

  // ---- Mortgage ----------------------------------------------------------------------
  cfpbPacketPayStub: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Pay stub for the last 30 days',
  ),
  cfpbPacketW2: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'W-2 forms for the last two years',
  ),
  cfpbPacketReturns: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Signed federal tax return for the last two years',
  ),
  cfpbPacketOtherIncome: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Documentation of other sources of income',
  ),
  cfpbPacketBankStatements: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Bank statements, two most recent',
  ),
  cfpbPacketDownPayment: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    "at least two months' history of ownership",
  ),
  cfpbPacketNameChange: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Documentation of name change, if recent',
  ),
  cfpbPacketIdentity: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    "Proof of your identity (typically a drivers' license or non-driver ID)",
  ),
  cfpbPacketCounseling: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'Certificate of housing counseling or home buyer education, if you have one',
  ),
  cfpbPacketVa: source(
    'CFPB — Create a loan application packet',
    'https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/',
    'a certificate of eligibility from the VA',
  ),
  cfpbGatherPaperwork: source(
    'CFPB — Gather and update your paperwork',
    'https://www.consumerfinance.gov/owning-a-home/explore/gather-and-update-your-paperwork/',
  ),
  cfpbSubmitDocuments: source(
    'CFPB — Submit documents and answer requests from the lender',
    'https://www.consumerfinance.gov/owning-a-home/close/submit-documents-and-answer-requests-from-the-lender/',
    'large deposits into your bank account',
  ),
  fannieePaystub: source(
    'Fannie Mae Selling Guide B3-3.2-01, Standards for Employment and Income Documentation',
    'https://selling-guide.fanniemae.com/sel/b3-3.2-01/standards-employment-and-income-documentation',
    'The most recent paystub must be dated no earlier than 30 days prior to the initial loan application date and it must include all year-to-date earnings.',
  ),
  fannieW2: source(
    'Fannie Mae Selling Guide B3-3.2-01, Standards for Employment and Income Documentation',
    'https://selling-guide.fanniemae.com/sel/b3-3.2-01/standards-employment-and-income-documentation',
    'IRS W-2 forms must cover the most recent one- or two-year period, based on the documentation requirements for the particular income type, and must clearly identify the borrower as the employee.',
  ),
  fannieReturns: source(
    'Fannie Mae Selling Guide B3-3.1-02, Tax Return and Transcript Documentation Requirements',
    'https://selling-guide.fanniemae.com/sel/b3-3.1-02/tax-return-and-transcript-documentation-requirements',
    'When required, personal federal income tax returns must be copies of the original returns that were filed with the IRS. All supporting schedules must be included.',
  ),
  fannieSelfEmployed: source(
    'Fannie Mae Selling Guide B3-3.1-02, Tax Return and Transcript Documentation Requirements',
    'https://selling-guide.fanniemae.com/sel/b3-3.1-02/tax-return-and-transcript-documentation-requirements',
    'For self-employed borrowers with two years of business returns … one IRS Form 4506-C to request transcript of the personal tax returns, and a separate IRS Form 4506-C to request transcripts of the business returns.',
  ),
  fannieAssets: source(
    'Fannie Mae Selling Guide B3-4.2-01, Verification of Deposits and Assets',
    'https://selling-guide.fanniemae.com/sel/b3-4.2-01/verification-deposits-and-assets',
    'most recent full two-month period of account activity (60 days, or, if account information is reported on a quarterly basis, the most recent quarter)',
  ),
  fannieAssetsAge: source(
    'Fannie Mae Selling Guide B3-4.2-01, Verification of Deposits and Assets',
    'https://selling-guide.fanniemae.com/sel/b3-4.2-01/verification-deposits-and-assets',
    'If the latest bank statement is more than 45 days earlier than the date of the loan application, the lender should ask the borrower to provide a more recent, supplemental, bank-generated form.',
  ),
  vaCoe: source(
    'VA — How to request a Certificate of Eligibility',
    'https://www.va.gov/housing-assistance/home-loans/how-to-request-coe/',
  ),
} as const satisfies Record<string, TemplateSource>;

export type SourceKey = keyof typeof SOURCES;
