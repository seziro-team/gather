/**
 * The emails Gather sends.
 *
 * Written as a client reads them, not as a marketer writes them. Every one of these lands
 * in the inbox of somebody who did not choose Gather, is busy, and is being asked for
 * paperwork — so they are short, they say who is asking and what is missing, and the link
 * is the only thing to do.
 *
 * Deliberately no template engine and no MJML. These are four emails with the same frame;
 * a dependency that renders them would be larger than they are, and inlined CSS in a table
 * is what actually survives Outlook.
 */

export interface Brand {
  firmName: string;
  /** A hex colour from the firm's brand snapshot, or the default. */
  color: string;
  logoUrl?: string | null;
}

export interface ReminderContent {
  brand: Brand;
  clientName: string;
  requestTitle: string;
  portalUrl: string;
  /** Item labels still outstanding. Shown in full up to a limit, then counted. */
  outstanding: string[];
  totalItems: number;
  dueAt?: Date | null;
  /** Which reminder this is; the first one is the request itself, and reads differently. */
  reminderNumber: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const MAX_LISTED = 8;
const DEFAULT_COLOR = '#0f766e';

const HEX = /^#[0-9a-f]{3,8}$/i;

function safeColor(color: string): string {
  return HEX.test(color) ? color : DEFAULT_COLOR;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A due date is a calendar date, not an instant.
 *
 * It is stored as 23:59:59.999 UTC on the chosen day, so it has to be read back in UTC:
 * formatted in a local zone, 2026-04-10T23:59:59Z reads as 10 April in New York and 11
 * April in Sydney — and the deadline in the client's email would not match the one on the
 * firm's screen.
 */
function formatDue(due: Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(due);
}

/**
 * The frame every message shares.
 *
 * Tables and inlined styles, because that is what renders in Outlook, which a meaningful
 * share of accountants' clients still use. `role="presentation"` keeps a screen reader
 * from announcing the layout as a data table.
 */
function frame(brand: Brand, bodyHtml: string, preheader: string): string {
  const color = safeColor(brand.color);
  const name = escapeHtml(brand.firmName);

  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="32" style="height:32px;width:auto;border:0;display:block" />`
    : `<span style="font-size:16px;font-weight:600;color:#ffffff">${name}</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${name}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<!-- The line inbox lists show under the subject. Hidden in the message itself. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:${color};padding:20px 24px">${header}</td></tr>
      <tr><td style="padding:24px">${bodyHtml}</td></tr>
      <tr><td style="padding:0 24px 24px">
        <p style="margin:0;font-size:12px;line-height:18px;color:#64748b">
          This link is yours — anyone who has it can see the checklist, so please do not
          forward it. Replying to this email reaches ${name} directly.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function button(url: string, label: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0">
  <tr><td style="border-radius:8px;background:${color}">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function outstandingHtml(items: string[], total: number): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_LISTED);
  const rest = items.length - shown.length;

  const list = shown
    .map(
      (label) =>
        `<li style="margin:0 0 6px;font-size:15px;line-height:22px">${escapeHtml(label)}</li>`,
    )
    .join('');

  const more =
    rest > 0 ? `<p style="margin:8px 0 0;font-size:14px;color:#475569">…and ${rest} more.</p>` : '';

  return `<p style="margin:16px 0 8px;font-size:15px;line-height:22px"><strong>Still needed (${items.length} of ${total}):</strong></p>
<ul style="margin:0;padding-left:20px;color:#0f172a">${list}</ul>${more}`;
}

function outstandingText(items: string[], total: number): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, MAX_LISTED);
  const rest = items.length - shown.length;
  const lines = shown.map((label) => `  - ${label}`).join('\n');
  return `\nStill needed (${items.length} of ${total}):\n${lines}${rest > 0 ? `\n  …and ${rest} more.` : ''}\n`;
}

/**
 * The first email: the request itself.
 *
 * Not called a reminder, because nobody has forgotten anything yet.
 */
export function renderRequestEmail(content: ReminderContent): RenderedEmail {
  const color = safeColor(content.brand.color);
  const due = content.dueAt ? formatDue(content.dueAt) : null;

  const subject = `${content.brand.firmName}: ${content.requestTitle}`;
  const preheader = due
    ? `${content.totalItems} things to send over by ${due}.`
    : `${content.totalItems} things to send over.`;

  const html = frame(
    content.brand,
    `<p style="margin:0 0 12px;font-size:16px;line-height:24px">Hello ${escapeHtml(content.clientName)},</p>
<p style="margin:0 0 12px;font-size:16px;line-height:24px">
  ${escapeHtml(content.brand.firmName)} needs a few things from you for
  <strong>${escapeHtml(content.requestTitle)}</strong>.${due ? ` They are needed by <strong>${escapeHtml(due)}</strong>.` : ''}
</p>
<p style="margin:0;font-size:16px;line-height:24px">
  There is no account to create and no password to remember. The link below opens your
  checklist — you can upload from your phone, and it saves as you go, so you can stop and
  come back whenever.
</p>
${button(content.portalUrl, 'Open my checklist', color)}
${outstandingHtml(content.outstanding, content.totalItems)}`,
    preheader,
  );

  const text = `Hello ${content.clientName},

${content.brand.firmName} needs a few things from you for "${content.requestTitle}".${due ? ` They are needed by ${due}.` : ''}

There is no account to create and no password to remember. Open your checklist here:

${content.portalUrl}

You can upload from your phone, and it saves as you go — stop and come back whenever.
${outstandingText(content.outstanding, content.totalItems)}
This link is yours; please do not forward it. Replying to this email reaches ${content.brand.firmName}.
`;

  return { subject, html, text };
}

/**
 * The reminders after it.
 *
 * The subject line changes with the count, because an identical subject arriving four times
 * is what Gmail collapses into a thread nobody opens. It never scolds — the r/taxpros
 * threads in plan.md §2.4 are full of firms whose clients are busy, not negligent.
 */
export function renderReminderEmail(content: ReminderContent): RenderedEmail {
  const color = safeColor(content.brand.color);
  const due = content.dueAt ? formatDue(content.dueAt) : null;
  const left = content.outstanding.length;
  const done = content.totalItems - left;

  const subject =
    left === 1
      ? `One thing left: ${content.requestTitle}`
      : `${left} things left: ${content.requestTitle}`;

  const opening =
    done > 0
      ? `Thank you — ${done} of ${content.totalItems} ${done === 1 ? 'item is' : 'items are'} in.`
      : `Just a nudge about the documents ${content.brand.firmName} asked for.`;

  const urgency = due
    ? `<p style="margin:0 0 12px;font-size:16px;line-height:24px">These are needed by <strong>${escapeHtml(due)}</strong>.</p>`
    : '';

  const html = frame(
    content.brand,
    `<p style="margin:0 0 12px;font-size:16px;line-height:24px">Hello ${escapeHtml(content.clientName)},</p>
<p style="margin:0 0 12px;font-size:16px;line-height:24px">${escapeHtml(opening)}</p>
${urgency}
${outstandingHtml(content.outstanding, content.totalItems)}
${button(content.portalUrl, left === 1 ? 'Send the last one' : 'Pick up where you left off', color)}
<p style="margin:0;font-size:14px;line-height:21px;color:#475569">
  Everything you have already sent is saved. If something on this list does not apply to
  you, open the link and say so — that clears it too.
</p>`,
    `${opening} ${left} still to go.`,
  );

  const text = `Hello ${content.clientName},

${opening}${due ? `\n\nThese are needed by ${due}.` : ''}
${outstandingText(content.outstanding, content.totalItems)}
Pick up where you left off:

${content.portalUrl}

Everything you have already sent is saved. If something on the list does not apply to you,
open the link and say so — that clears it too.

This link is yours; please do not forward it. Replying to this email reaches ${content.brand.firmName}.
`;

  return { subject, html, text };
}

/** What `pnpm check:email` sends, so an operator can prove delivery before a client does. */
export function renderTestEmail(brand: Brand, appUrl: string): RenderedEmail {
  const color = safeColor(brand.color);
  return {
    subject: `Gather test message from ${brand.firmName}`,
    html: frame(
      brand,
      `<p style="margin:0 0 12px;font-size:16px;line-height:24px">This is a test message from Gather.</p>
<p style="margin:0 0 12px;font-size:16px;line-height:24px">
  If you are reading it, ${escapeHtml(brand.firmName)} can send email — which means client
  reminders will arrive too. Check that it landed in the inbox rather than in spam, and that
  the sender name and colour above look like yours.
</p>
${button(appUrl, 'Open Gather', color)}`,
      'If you can read this, reminders will reach your clients.',
    ),
    text: `This is a test message from Gather.

If you are reading it, ${brand.firmName} can send email — which means client reminders will
arrive too. Check that it landed in the inbox rather than in spam, and that the sender name
looks like yours.

${appUrl}
`,
  };
}
