/**
 * Audit actions, in the words a firm uses.
 *
 * One map rather than one per page. The dashboard and the request page each had a copy,
 * and they had already drifted — the request page knew about portal events and the
 * dashboard did not, so the same event read differently depending on where you looked at
 * it. In an audit trail that is not a cosmetic problem.
 *
 * An action with no entry here falls through to its raw name, which is ugly and correct:
 * a new event type showing up as `reminder.complained` is better than one silently
 * displayed as something it is not.
 */
export const ACTION_LABELS: Record<string, string> = {
  // Accounts
  'auth.sign_up': 'Account created',
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.two_factor.enable_requested': 'Two-factor setup started',
  'auth.two_factor.verified': 'Two-factor code verified',
  'auth.two_factor.disabled': 'Two-factor turned off',
  'auth.two_factor.backup_code_used': 'Backup code used',
  'firm.created': 'Firm created',
  'firm.member_added': 'Member added',

  // Clients and templates
  'client.created': 'Client added',
  'client.updated': 'Client updated',
  'client.archived': 'Client archived',
  'client.restored': 'Client restored',
  'template.builtin_installed': 'Built-in template installed',
  'template.created': 'Template saved',
  'template.deleted': 'Template deleted',

  // Requests
  'request.created': 'Request created',
  'request.updated': 'Request details changed',
  'request.structure_updated': 'Checklist changed',
  'request.deleted': 'Request deleted',
  'request.completed': 'Request completed',
  'request.link_issued': 'Portal link created',
  'request.link_revoked': 'Portal link revoked',
  'request.downloaded': 'Files downloaded',

  // The client's side
  'portal.opened': 'Client opened the link',
  'portal.file_uploaded': 'Client uploaded a file',
  'portal.file_removed': 'Client removed a file',
  'portal.submitted': 'Client sent it back',
  'portal.link_rejected': 'A dead link was tried',

  // Review
  'response.approved': 'Item approved',
  'response.rejected': 'Item sent back',

  // Reminders
  'reminder.schedule_set': 'Reminders turned on',
  'reminder.schedule_paused': 'Reminders paused',
  'reminder.sent_manually': 'Reminder sent by hand',
  'reminder.stopped': 'Reminders stopped',
  'reminder.bounced': 'A reminder bounced',
  'reminder.complained': 'A client marked a reminder as spam',
  'reminder.failed': 'A reminder could not be sent',

  // Evidence
  'audit.exported': 'Audit trail exported',
};
