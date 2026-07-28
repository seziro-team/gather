# Where the built-in templates come from

Gather ships four request templates. Every item in all four is transcribed from published
guidance — an IRS page, a CFPB checklist, the Fannie Mae Selling Guide. **None of them is
invented.** This file is the receipt.

Each item below links to the document it came from, and quotes the sentence that puts it
there wherever the source states it plainly.

> **This is not tax, legal or lending advice.** These are collection checklists: they tell
> you what to ask a client for, not what to do with it. Requirements change, and they
> change for a specific client's facts. Check the linked source before you rely on an item,
> and edit the template — that is what it is for.

**Jurisdiction:** all four are United States. UK and Australian variants are not shipped
because nobody has transcribed them from primary sources yet; see `plan.md` §10.

**Every URL in this file was fetched on 2026-07-28.** All but three returned HTTP 200 to
a scripted request; the three `consumerfinance.gov` pages refuse those outright, and were
read through a browser-equivalent fetch instead.

## The four templates

| Template | Key | Sections | Items | Guidance |
| --- | --- | --- | --- | --- |
| US individual tax return — year-end documents | `us-individual-tax-year-end` | 4 | 25 | United States — IRS |
| New business client onboarding | `new-business-onboarding` | 4 | 18 | United States — IRS and SBA |
| Mortgage application documents | `mortgage-application` | 4 | 17 | United States — CFPB and Fannie Mae Selling Guide |
| Monthly bookkeeping close | `bookkeeping-monthly-close` | 4 | 14 | United States — IRS recordkeeping guidance |

---

## US individual tax return — year-end documents

`us-individual-tax-year-end` · 4 sections · 25 items · United States — IRS

Everything needed to prepare a Form 1040: identity, income statements, deduction records and payment details.

### 1. Who is on the return

We need these before anything else — a return cannot be filed without matching names, numbers and dates of birth.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 1.1 | Photo ID for you, and for your spouse if you file jointly | File upload | Required | [1](#source-1) |
| 1.2 | Social Security cards for everyone on the return | File upload | Required | [2](#source-2) |
| 1.3 | Full name and date of birth for each dependent | Long text | Optional | [3](#source-3) |
| 1.4 | Last year’s federal and state tax returns | File upload | Optional | [4](#source-4) |
| 1.5 | Identity Protection PIN, if the IRS issued you one | Short text | Optional | [5](#source-5) [6](#source-6) |

### 2. Income

Every statement you received, even if you think it is too small to matter.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 2.1 | Form W-2 from every employer | File upload | Required | [7](#source-7) [8](#source-8) |
| 2.2 | Forms 1099-NEC and 1099-MISC for contract or freelance work | File upload | Optional | [9](#source-9) [7](#source-7) |
| 2.3 | Form 1099-K from payment apps, marketplaces and card processors | File upload | Optional | [10](#source-10) |
| 2.4 | Bank and brokerage tax forms — 1099-INT, 1099-DIV and 1099-B | File upload | Optional | [11](#source-11) [12](#source-12) [13](#source-13) [14](#source-14) |
| 2.5 | Form 1099-R for pensions, annuities, IRA or 401(k) withdrawals | File upload | Optional | [15](#source-15) |
| 2.6 | Form SSA-1099 Social Security benefit statement | File upload | Optional | [16](#source-16) |
| 2.7 | Form 1099-G for unemployment compensation or a state tax refund | File upload | Optional | [17](#source-17) |
| 2.8 | Schedule K-1 from any partnership, S corporation or trust | File upload | Optional | [18](#source-18) [19](#source-19) |
| 2.9 | Did you receive, sell, exchange or otherwise dispose of any digital assets this year? | Yes / no | Required | [20](#source-20) |

### 3. Deductions and credits

Send these even if you took the standard deduction last year — the threshold moves.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 3.1 | Form 1098 mortgage interest statement | File upload | Optional | [21](#source-21) [22](#source-22) |
| 3.2 | State and local property tax bills paid during the year | File upload | Optional | [22](#source-22) |
| 3.3 | Forms 1098-T and 1098-E for tuition and student loan interest | File upload | Optional | [23](#source-23) [24](#source-24) |
| 3.4 | Form 1095-A, if anyone on the return had Marketplace health coverage | File upload | Optional | [25](#source-25) [26](#source-26) |
| 3.5 | Charitable contribution receipts and written acknowledgements | File upload | Optional | [27](#source-27) |
| 3.6 | Medical and dental expense records | File upload | Optional | [28](#source-28) |
| 3.7 | Childcare provider — name, address, taxpayer ID, and the total you paid | Long text | Optional | [29](#source-29) [30](#source-30) |
| 3.8 | Form 5498 or year-end statements for IRA and HSA contributions | File upload | Optional | [31](#source-31) |

### 4. Payments and filing

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 4.1 | Total federal estimated tax payments you made for the year | Number | Optional | [32](#source-32) |
| 4.2 | A voided check or bank letter for direct deposit | File upload | Optional | [33](#source-33) |
| 4.3 | Has your address, marital status or number of dependents changed this year? | Yes / no | Required | [6](#source-6) |

---

## New business client onboarding

`new-business-onboarding` · 4 sections · 18 items · United States — IRS and SBA

Entity paperwork, IRS authorisations, the books and payroll — what a firm needs before it can start work.

### 1. The entity

How the business is set up decides which returns it files.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 1.1 | How is the business set up? | Choice | Required | [34](#source-34) |
| 1.2 | EIN confirmation letter (IRS Notice CP 575), or your filed Form SS-4 | File upload | Required | [35](#source-35) |
| 1.3 | Formation documents — articles of incorporation or organisation, and the operating or partnership agreement | File upload | Required | [36](#source-36) |
| 1.4 | Form 2553 S corporation election, if the business made one | File upload | Optional | [37](#source-37) |
| 1.5 | Date the business started trading | Date | Required | [38](#source-38) |
| 1.6 | Which state or states is the business registered in? | Short text | Required | [36](#source-36) |

### 2. Tax filings and authorisations

Without these we cannot see your account or speak to the IRS on your behalf.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 2.1 | The last two filed business tax returns | File upload | Optional | [39](#source-39) [40](#source-40) [41](#source-41) [42](#source-42) |
| 2.2 | Signed Form 2848 or Form 8821 | File upload | Required | [43](#source-43) [44](#source-44) |
| 2.3 | Completed Form W-9 for the business | File upload | Required | [45](#source-45) |
| 2.4 | Most recent depreciation schedule or fixed asset register | File upload | Optional | [46](#source-46) |
| 2.5 | Has the business changed its name, address or responsible party since its last filing? | Yes / no | Required | [47](#source-47) |

### 3. Books and banking

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 3.1 | Where are the books kept? | Short text | Required | [48](#source-48) |
| 3.2 | Accounting file, trial balance or year-to-date profit and loss | File upload | Required | [48](#source-48) |
| 3.3 | Bank statements for every business account, year to date | File upload | Required | [49](#source-49) |
| 3.4 | Merchant processor, loan and line-of-credit statements | File upload | Optional | [50](#source-50) [51](#source-51) |

### 4. Payroll

Skip this section entirely if the business has never had an employee.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 4.1 | Does the business have employees? | Yes / no | Required | [52](#source-52) |
| 4.2 | The four most recent Forms 941 and your state payroll filings | File upload | Optional | [53](#source-53) |
| 4.3 | Form W-4 and Form I-9 for each employee | File upload | Optional | [54](#source-54) [55](#source-55) |

---

## Mortgage application documents

`mortgage-application` · 4 sections · 17 items · United States — CFPB and Fannie Mae Selling Guide

The borrower-supplied file for a conforming loan, with the dating rules an underwriter will actually apply.

### 1. Who you are

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 1.1 | Photo ID for every borrower on the loan | File upload | Required | [56](#source-56) |
| 1.2 | Social Security card for every borrower | File upload | Required | [56](#source-56) |
| 1.3 | Documentation of a recent name change | File upload | Optional | [57](#source-57) |
| 1.4 | Certificate of housing counselling or home buyer education, if you have one | File upload | Optional | [58](#source-58) |

### 2. Income and employment

Underwriting is dated: statements go stale, so send the most recent ones and expect to refresh them if the file takes a while.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 2.1 | Pay stubs covering the last 30 days, for every borrower | File upload | Required | [59](#source-59) [60](#source-60) |
| 2.2 | W-2 forms for the last two years | File upload | Required | [61](#source-61) [62](#source-62) |
| 2.3 | Signed federal tax returns for the last two years, with every schedule | File upload | Required | [63](#source-63) [64](#source-64) |
| 2.4 | Is any borrower self-employed or an owner of a business? | Yes / no | Required | [65](#source-65) |
| 2.5 | Any other income you want counted — and what evidences it | Long text | Optional | [66](#source-66) [67](#source-67) |

### 3. Assets and the down payment

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 3.1 | The two most recent statements for every bank and investment account | File upload | Required | [68](#source-68) [69](#source-69) |
| 3.2 | Is your most recent statement more than 45 days old? | Yes / no | Required | [70](#source-70) |
| 3.3 | Where is your down payment coming from? | Long text | Required | [71](#source-71) |
| 3.4 | Gift letter and proof of transfer, if any of the down payment is a gift | File upload | Optional | [71](#source-71) |
| 3.5 | Explain any deposit on your statements that is not your regular pay | Long text | Optional | [72](#source-72) |

### 4. If it applies to you

Most borrowers can leave this section empty.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 4.1 | VA Certificate of Eligibility, for a VA loan | File upload | Optional | [73](#source-73) [74](#source-74) |
| 4.2 | Court order and payment record for child support or alimony you receive | File upload | Optional | [67](#source-67) |
| 4.3 | Lease agreements and the Schedule E for any rental property you own | File upload | Optional | [67](#source-67) [75](#source-75) |

---

## Monthly bookkeeping close

`bookkeeping-monthly-close` · 4 sections · 14 items · United States — IRS recordkeeping guidance

The same list every month: statements, money in, money out, payroll and assets.

### 1. Statements

Nothing can be reconciled until these are in. They are the whole month.

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 1.1 | Which month is this for? | Date | Required | [49](#source-49) |
| 1.2 | Bank statement for every business account | File upload | Required | [49](#source-49) |
| 1.3 | Credit card statements for every business card | File upload | Required | [76](#source-76) [51](#source-51) |
| 1.4 | Loan and line-of-credit statements | File upload | Optional | [51](#source-51) |

### 2. Money in

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 2.1 | Merchant processor or payment app settlement reports | File upload | Optional | [50](#source-50) [10](#source-10) |
| 2.2 | Sales invoices raised this month, if they are not already in the books | File upload | Optional | [50](#source-50) |
| 2.3 | Cash register tapes or daily takings sheets | File upload | Optional | [50](#source-50) |

### 3. Money out

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 3.1 | Receipts for the transactions we have queried | File upload | Required | [76](#source-76) [77](#source-77) |
| 3.2 | What was each queried transaction for, and who was it with? | Long text | Optional | [77](#source-77) [78](#source-78) |
| 3.3 | Mileage log for the month | File upload | Optional | [79](#source-79) [78](#source-78) |
| 3.4 | Petty cash slips | File upload | Optional | [51](#source-51) |

### 4. Payroll, assets and stock

| # | Item | Type | Required | Sources |
| --- | --- | --- | --- | --- |
| 4.1 | Payroll reports for the month | File upload | Optional | [80](#source-80) |
| 4.2 | Invoices for anything bought that will last more than a year | File upload | Optional | [81](#source-81) |
| 4.3 | Closing stock value, if you hold inventory | Number | Optional | [82](#source-82) |

---

## Sources

Numbered in order of first use. A page quoted for two different items appears twice, once per quote.

<a id="source-1"></a>
**1. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Original photo identification for you and your spouse (if married filing jointly)

<a id="source-2"></a>
**2. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Social Security cards for you, your spouse and dependents

<a id="source-3"></a>
**3. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Birth dates for you, your spouse and dependents on the tax return

<a id="source-4"></a>
**4. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> A copy of last year's federal and state returns, if available

<a id="source-5"></a>
**5. IRS — Get an identity protection PIN**  
<https://www.irs.gov/identity-theft-fraud-scams/get-an-identity-protection-pin>

<a id="source-6"></a>
**6. IRS — Get ready to file your taxes**  
<https://www.irs.gov/individuals/get-ready-to-file-your-taxes>

<a id="source-7"></a>
**7. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Wage and earning statements (Form W-2, W-2G, 1099-R, 1099-MISC) from all employers

<a id="source-8"></a>
**8. IRS — About Form W-2**  
<https://www.irs.gov/forms-pubs/about-form-w-2>

<a id="source-9"></a>
**9. IRS — About Form 1099-NEC**  
<https://www.irs.gov/forms-pubs/about-form-1099-nec>

<a id="source-10"></a>
**10. IRS — About Form 1099-K**  
<https://www.irs.gov/forms-pubs/about-form-1099-k>

<a id="source-11"></a>
**11. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Interest and dividend statements from banks (Forms 1099)

<a id="source-12"></a>
**12. IRS — About Form 1099-INT**  
<https://www.irs.gov/forms-pubs/about-form-1099-int>

<a id="source-13"></a>
**13. IRS — About Form 1099-DIV**  
<https://www.irs.gov/forms-pubs/about-form-1099-div>

<a id="source-14"></a>
**14. IRS — About Form 1099-B**  
<https://www.irs.gov/forms-pubs/about-form-1099-b>

<a id="source-15"></a>
**15. IRS — About Form 1099-R**  
<https://www.irs.gov/forms-pubs/about-form-1099-r>

<a id="source-16"></a>
**16. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Social Security Benefit Statements (SSA-1099), if applicable

<a id="source-17"></a>
**17. IRS — About Form 1099-G**  
<https://www.irs.gov/forms-pubs/about-form-1099-g>

<a id="source-18"></a>
**18. IRS — Partner's Instructions for Schedule K-1 (Form 1065)**  
<https://www.irs.gov/instructions/i1065sk1>

<a id="source-19"></a>
**19. IRS — About Schedule K-1 (Form 1120-S)**  
<https://www.irs.gov/forms-pubs/about-schedule-k-1-form-1120-s>

<a id="source-20"></a>
**20. IRS — Digital assets**  
<https://www.irs.gov/filing/digital-assets>

<a id="source-21"></a>
**21. IRS — About Form 1098**  
<https://www.irs.gov/forms-pubs/about-form-1098>

<a id="source-22"></a>
**22. IRS — About Schedule A (Form 1040)**  
<https://www.irs.gov/forms-pubs/about-schedule-a-form-1040>

<a id="source-23"></a>
**23. IRS — About Form 1098-T**  
<https://www.irs.gov/forms-pubs/about-form-1098-t>

<a id="source-24"></a>
**24. IRS — About Form 1098-E**  
<https://www.irs.gov/forms-pubs/about-form-1098-e>

<a id="source-25"></a>
**25. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Forms 1095-A, Health Insurance Marketplace Statement

<a id="source-26"></a>
**26. IRS — About Form 1095-A**  
<https://www.irs.gov/forms-pubs/about-form-1095-a>

<a id="source-27"></a>
**27. IRS — Publication 526, Charitable Contributions**  
<https://www.irs.gov/publications/p526>

<a id="source-28"></a>
**28. IRS — Publication 502, Medical and Dental Expenses**  
<https://www.irs.gov/publications/p502>

<a id="source-29"></a>
**29. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Total paid for daycare provider and the daycare provider's tax identifying number

<a id="source-30"></a>
**30. IRS — About Form 2441**  
<https://www.irs.gov/forms-pubs/about-form-2441>

<a id="source-31"></a>
**31. IRS — About Form 5498**  
<https://www.irs.gov/forms-pubs/about-form-5498>

<a id="source-32"></a>
**32. IRS — About Form 1040-ES**  
<https://www.irs.gov/forms-pubs/about-form-1040-es>

<a id="source-33"></a>
**33. IRS — Checklist for free tax return preparation**  
<https://www.irs.gov/individuals/checklist-for-free-tax-return-preparation>

> Proof of bank account routing and account numbers for direct deposit, such as a blank check

<a id="source-34"></a>
**34. IRS — Business structures**  
<https://www.irs.gov/businesses/small-businesses-self-employed/business-structures>

<a id="source-35"></a>
**35. IRS — About Form SS-4**  
<https://www.irs.gov/forms-pubs/about-form-ss-4>

<a id="source-36"></a>
**36. SBA — Register your business**  
<https://www.sba.gov/business-guide/launch-your-business/register-your-business>

<a id="source-37"></a>
**37. IRS — About Form 2553**  
<https://www.irs.gov/forms-pubs/about-form-2553>

<a id="source-38"></a>
**38. IRS — Starting a business**  
<https://www.irs.gov/businesses/small-businesses-self-employed/starting-a-business>

<a id="source-39"></a>
**39. IRS — About Form 1065**  
<https://www.irs.gov/forms-pubs/about-form-1065>

<a id="source-40"></a>
**40. IRS — About Form 1120**  
<https://www.irs.gov/forms-pubs/about-form-1120>

<a id="source-41"></a>
**41. IRS — About Form 1120-S**  
<https://www.irs.gov/forms-pubs/about-form-1120-s>

<a id="source-42"></a>
**42. IRS — About Schedule C (Form 1040)**  
<https://www.irs.gov/forms-pubs/about-schedule-c-form-1040>

<a id="source-43"></a>
**43. IRS — About Form 2848**  
<https://www.irs.gov/forms-pubs/about-form-2848>

<a id="source-44"></a>
**44. IRS — About Form 8821**  
<https://www.irs.gov/forms-pubs/about-form-8821>

<a id="source-45"></a>
**45. IRS — About Form W-9**  
<https://www.irs.gov/forms-pubs/about-form-w-9>

<a id="source-46"></a>
**46. IRS — About Form 4562**  
<https://www.irs.gov/forms-pubs/about-form-4562>

<a id="source-47"></a>
**47. IRS — About Form 8822-B**  
<https://www.irs.gov/forms-pubs/about-form-8822-b>

<a id="source-48"></a>
**48. IRS — Publication 583, Starting a Business and Keeping Records**  
<https://www.irs.gov/publications/p583>

> Your recordkeeping system should include a summary of your business transactions ordinarily made in your books (for example, accounting journals and ledgers).

<a id="source-49"></a>
**49. IRS — Publication 583, Starting a Business and Keeping Records**  
<https://www.irs.gov/publications/p583>

> When you receive your bank statement, make sure the statement, your checkbook, and your books agree. … You should reconcile your checking account each month.

<a id="source-50"></a>
**50. IRS — Publication 583, Starting a Business and Keeping Records**  
<https://www.irs.gov/publications/p583>

> Cash register tapes. Bank deposit slips. Receipt books. Invoices. Credit card charge slips. Forms 1099-MISC. Forms 1099-NEC.

<a id="source-51"></a>
**51. IRS — Publication 583, Starting a Business and Keeping Records**  
<https://www.irs.gov/publications/p583>

> Canceled checks. Cash register tapes. Account statements. Credit card sales slips. Invoices. Petty cash slips for small cash payments.

<a id="source-52"></a>
**52. IRS — Employment taxes**  
<https://www.irs.gov/businesses/small-businesses-self-employed/employment-taxes>

<a id="source-53"></a>
**53. IRS — About Form 941**  
<https://www.irs.gov/forms-pubs/about-form-941>

<a id="source-54"></a>
**54. IRS — Publication 15 (Circular E)**  
<https://www.irs.gov/publications/p15>

> Ask each new employee to complete the 2026 Form W-4.

<a id="source-55"></a>
**55. IRS — Publication 15 (Circular E)**  
<https://www.irs.gov/publications/p15>

> You must verify that each new employee is legally eligible to work in the United States … completing the U.S. Citizenship and Immigration Services (USCIS) Form I-9, Employment Eligibility Verification.

<a id="source-56"></a>
**56. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Proof of your identity (typically a drivers' license or non-driver ID)

<a id="source-57"></a>
**57. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Documentation of name change, if recent

<a id="source-58"></a>
**58. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Certificate of housing counseling or home buyer education, if you have one

<a id="source-59"></a>
**59. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Pay stub for the last 30 days

<a id="source-60"></a>
**60. Fannie Mae Selling Guide B3-3.2-01, Standards for Employment and Income Documentation**  
<https://selling-guide.fanniemae.com/sel/b3-3.2-01/standards-employment-and-income-documentation>

> The most recent paystub must be dated no earlier than 30 days prior to the initial loan application date and it must include all year-to-date earnings.

<a id="source-61"></a>
**61. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> W-2 forms for the last two years

<a id="source-62"></a>
**62. Fannie Mae Selling Guide B3-3.2-01, Standards for Employment and Income Documentation**  
<https://selling-guide.fanniemae.com/sel/b3-3.2-01/standards-employment-and-income-documentation>

> IRS W-2 forms must cover the most recent one- or two-year period, based on the documentation requirements for the particular income type, and must clearly identify the borrower as the employee.

<a id="source-63"></a>
**63. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Signed federal tax return for the last two years

<a id="source-64"></a>
**64. Fannie Mae Selling Guide B3-3.1-02, Tax Return and Transcript Documentation Requirements**  
<https://selling-guide.fanniemae.com/sel/b3-3.1-02/tax-return-and-transcript-documentation-requirements>

> When required, personal federal income tax returns must be copies of the original returns that were filed with the IRS. All supporting schedules must be included.

<a id="source-65"></a>
**65. Fannie Mae Selling Guide B3-3.1-02, Tax Return and Transcript Documentation Requirements**  
<https://selling-guide.fanniemae.com/sel/b3-3.1-02/tax-return-and-transcript-documentation-requirements>

> For self-employed borrowers with two years of business returns … one IRS Form 4506-C to request transcript of the personal tax returns, and a separate IRS Form 4506-C to request transcripts of the business returns.

<a id="source-66"></a>
**66. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Documentation of other sources of income

<a id="source-67"></a>
**67. CFPB — Gather and update your paperwork**  
<https://www.consumerfinance.gov/owning-a-home/explore/gather-and-update-your-paperwork/>

<a id="source-68"></a>
**68. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> Bank statements, two most recent

<a id="source-69"></a>
**69. Fannie Mae Selling Guide B3-4.2-01, Verification of Deposits and Assets**  
<https://selling-guide.fanniemae.com/sel/b3-4.2-01/verification-deposits-and-assets>

> most recent full two-month period of account activity (60 days, or, if account information is reported on a quarterly basis, the most recent quarter)

<a id="source-70"></a>
**70. Fannie Mae Selling Guide B3-4.2-01, Verification of Deposits and Assets**  
<https://selling-guide.fanniemae.com/sel/b3-4.2-01/verification-deposits-and-assets>

> If the latest bank statement is more than 45 days earlier than the date of the loan application, the lender should ask the borrower to provide a more recent, supplemental, bank-generated form.

<a id="source-71"></a>
**71. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> at least two months' history of ownership

<a id="source-72"></a>
**72. CFPB — Submit documents and answer requests from the lender**  
<https://www.consumerfinance.gov/owning-a-home/close/submit-documents-and-answer-requests-from-the-lender/>

> large deposits into your bank account

<a id="source-73"></a>
**73. CFPB — Create a loan application packet**  
<https://www.consumerfinance.gov/owning-a-home/prepare/create-a-loan-application-packet/>

> a certificate of eligibility from the VA

<a id="source-74"></a>
**74. VA — How to request a Certificate of Eligibility**  
<https://www.va.gov/housing-assistance/home-loans/how-to-request-coe/>

<a id="source-75"></a>
**75. IRS — About Schedule E (Form 1040)**  
<https://www.irs.gov/forms-pubs/about-schedule-e-form-1040>

<a id="source-76"></a>
**76. IRS — What kind of records should I keep**  
<https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep>

> Canceled checks or other documents reflecting proof of payment/electronic funds transferred

<a id="source-77"></a>
**77. IRS — What kind of records should I keep**  
<https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep>

> Your supporting documents should show the amount paid and that the amount was for a business expense.

<a id="source-78"></a>
**78. IRS — Publication 463, Travel, Gift, and Car Expenses**  
<https://www.irs.gov/publications/p463>

> the time, place, and business purpose of your travel

<a id="source-79"></a>
**79. IRS — Publication 463, Travel, Gift, and Car Expenses**  
<https://www.irs.gov/publications/p463>

> use a log, diary, notebook, or any other written record to keep track of your expenses

<a id="source-80"></a>
**80. IRS — What kind of records should I keep**  
<https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep>

> Keep all records of employment for at least four years.

<a id="source-81"></a>
**81. IRS — Publication 583, Starting a Business and Keeping Records**  
<https://www.irs.gov/publications/p583>

> Purchase and sales invoices. Real estate closing statements. Canceled checks.

<a id="source-82"></a>
**82. IRS — What kind of records should I keep**  
<https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep>

> Your supporting documents should show the amount paid and that the amount was for inventory.

---

## Deliberately not included

Three things a reader might expect to find here, and why they are absent:

- **A typed Social Security number.** The CFPB's application packet checklist names
  "Social Security number" as something to gather, and the mortgage template asks for the
  *card* as a file instead. Uploaded files are encrypted at rest; a typed answer is a
  `jsonb` value in Postgres. It is the same information with better handling. A broker
  who wants the digits typed can add a text item in ten seconds.
- **An engagement letter or fee agreement.** Firm paperwork, not client paperwork. It
  differs by state, by practice and by service, and there is no primary source to
  transcribe. Gather will not invent one for you.
- **FinCEN beneficial ownership information (BOI) reporting.** The requirement's scope has
  been through litigation and rulemaking, and a checklist item that is confidently wrong
  about a filing obligation is worse than no item. Add it yourself if it applies to your
  clients.

## Changing a template

The definitions live in `packages/core/src/templates/`. Edit the template, then run:

```bash
pnpm build && pnpm docs:sources
```

`pnpm docs:sources:check` runs in CI and fails if this file no longer matches the code.
A test in `packages/core/src/template.test.ts` separately fails any built-in item that
carries no source at all.
