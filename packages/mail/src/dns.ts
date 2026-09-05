import { promises as dns } from 'node:dns';

/**
 * The deliverability preflight behind `pnpm check:email`.
 *
 * plan.md §10 rates email deliverability as the single most likely real-world failure of a
 * self-hosted Gather, and it is the one failure that is completely invisible: reminders are
 * "sent", the firm sees green ticks, and every one of them is in a spam folder. A firm
 * finds out when a client says "you never asked me for that".
 *
 * So Gather checks the three DNS records that decide it, says what it found in words, and
 * tells the operator exactly what to add. It does not — and cannot — guarantee inbox
 * placement; it catches the misconfigurations that guarantee the opposite.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** What was actually found, quoted, so the operator can see it rather than trust us. */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

async function txt(name: string): Promise<string[]> {
  try {
    // A TXT record arrives as chunks of <=255 bytes that have to be rejoined.
    return (await dns.resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

/**
 * SPF — which servers may send as this domain.
 *
 * The failure that matters is the absence of a record at all. After that, `?all` and `+all`
 * are worth flagging: they tell receivers to accept mail from anywhere, which is the same
 * as having no policy while looking like you have one.
 */
export async function checkSpf(domain: string): Promise<CheckResult> {
  const records = (await txt(domain)).filter((record) => /^v=spf1\b/i.test(record));

  if (records.length === 0) {
    return {
      name: 'SPF',
      status: 'fail',
      detail: `No v=spf1 TXT record on ${domain}.`,
      fix:
        `Add a TXT record on ${domain} listing whoever sends your mail. For Resend that is ` +
        `"v=spf1 include:amazonses.com ~all"; for your own server, "v=spf1 ip4:<your ip> ~all". ` +
        `Resend's dashboard gives you the exact value when you verify a domain.`,
    };
  }

  if (records.length > 1) {
    return {
      name: 'SPF',
      status: 'fail',
      detail: `${records.length} SPF records on ${domain}: ${records.map((r) => `"${r}"`).join(', ')}.`,
      fix:
        'A domain may have only one SPF record — receivers treat more than one as a permanent ' +
        'error and the check fails outright. Merge them into a single record with multiple ' +
        '"include:" terms.',
    };
  }

  const record = records[0]!;
  if (/[?+]all\b/i.test(record)) {
    return {
      name: 'SPF',
      status: 'warn',
      detail: `"${record}"`,
      fix:
        'This record ends in ?all or +all, which tells receivers to accept mail claiming to be ' +
        'from your domain no matter where it came from. Use "~all" (softfail) or "-all" (fail).',
    };
  }

  return { name: 'SPF', status: 'pass', detail: `"${record}"` };
}

/**
 * DKIM — the signature that proves the message was not altered in transit.
 *
 * The selector is not discoverable from DNS: it is chosen by whoever signs. Resend's is
 * `resend`; a self-hosted server picks its own. So the caller passes the selectors to try,
 * and Gather reports which ones answered.
 */
export async function checkDkim(domain: string, selectors: string[]): Promise<CheckResult> {
  const found: string[] = [];
  for (const selector of selectors) {
    const records = await txt(`${selector}._domainkey.${domain}`);
    if (records.some((record) => /v=DKIM1|p=/i.test(record))) found.push(selector);
  }

  if (found.length > 0) {
    return {
      name: 'DKIM',
      status: 'pass',
      detail: `Signing key published for selector${found.length > 1 ? 's' : ''} ${found.map((s) => `"${s}"`).join(', ')} on ${domain}.`,
    };
  }

  return {
    name: 'DKIM',
    status: 'fail',
    detail: `No DKIM key found at ${selectors.map((s) => `${s}._domainkey.${domain}`).join(' or ')}.`,
    fix:
      'Publish the DKIM record your sending provider gives you. Resend shows it when you verify ' +
      'a domain (selector "resend"). If you run your own server, its DKIM signer prints the ' +
      'record to publish, and you can point Gather at that selector with MAIL_DKIM_SELECTOR.',
  };
}

/**
 * DMARC — what a receiver should do when SPF and DKIM disagree with the From address.
 *
 * `p=none` is the honest default and is reported as a pass with a note rather than a
 * warning: it is the correct first step, and telling a firm their working setup is broken
 * is how a check gets ignored.
 */
export async function checkDmarc(domain: string): Promise<CheckResult> {
  const records = (await txt(`_dmarc.${domain}`)).filter((record) => /^v=DMARC1\b/i.test(record));

  if (records.length === 0) {
    return {
      name: 'DMARC',
      status: 'fail',
      detail: `No v=DMARC1 TXT record on _dmarc.${domain}.`,
      fix:
        `Add a TXT record at _dmarc.${domain}. Start with ` +
        `"v=DMARC1; p=none; rua=mailto:postmaster@${domain}" — that publishes a policy and asks ` +
        `for reports without changing how anything is delivered. Gmail and Yahoo have required ` +
        `bulk senders to have one since February 2024.`,
    };
  }

  const record = records[0]!;
  const policy = /\bp=(none|quarantine|reject)\b/i.exec(record)?.[1]?.toLowerCase();

  return {
    name: 'DMARC',
    status: 'pass',
    detail: `"${record}"`,
    fix:
      policy === 'none'
        ? 'p=none publishes a policy without enforcing it, which is the right place to start. ' +
          'Once your reports show only your own servers signing, move to p=quarantine.'
        : undefined,
  };
}

/** Does the domain accept mail at all? A missing MX makes replies bounce. */
export async function checkMx(domain: string): Promise<CheckResult> {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length === 0) throw new Error('none');
    const best = [...records].sort((a, b) => a.priority - b.priority)[0]!;
    return {
      name: 'MX',
      status: 'pass',
      detail: `${records.length} mail exchanger${records.length > 1 ? 's' : ''}, lowest priority ${best.exchange}.`,
    };
  } catch {
    return {
      name: 'MX',
      status: 'warn',
      detail: `No MX record on ${domain}.`,
      fix:
        'Gather can still send, but nothing can reply. Every reminder invites the client to ' +
        'reply to the firm, so a domain that cannot receive mail loses those replies silently.',
    };
  }
}

export interface DeliverabilityReport {
  domain: string;
  checks: CheckResult[];
  /** The worst status found, which is what the CLI exits on. */
  status: CheckStatus;
}

export async function checkDeliverability(
  domain: string,
  dkimSelectors: string[],
): Promise<DeliverabilityReport> {
  const checks = await Promise.all([
    checkSpf(domain),
    checkDkim(domain, dkimSelectors),
    checkDmarc(domain),
    checkMx(domain),
  ]);

  const status: CheckStatus = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';

  return { domain, checks, status };
}
