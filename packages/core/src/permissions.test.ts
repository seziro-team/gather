import { describe, expect, it } from 'vitest';
import {
  assertCan,
  can,
  canAssignRole,
  FIRM_ROLES,
  Forbidden,
  matchesAdminList,
  PERMISSIONS,
  permissionsFor,
  type FirmRole,
} from './permissions.js';

/**
 * Roles were in the schema from Phase 1 and enforced nowhere until Phase 7, so these tests
 * are the specification: what each role may do, stated once, checked here, and enforced by
 * `assertCan` at every entry point.
 */

describe('what each role may do', () => {
  it('gives a member the work and nothing else', () => {
    expect(can('member', 'requests:write')).toBe(true);
    expect(can('member', 'requests:review')).toBe(true);
    expect(can('member', 'files:read')).toBe(true);

    expect(can('member', 'team:manage')).toBe(false);
    expect(can('member', 'firm:settings')).toBe(false);
    expect(can('member', 'billing:manage')).toBe(false);
  });

  it('gives an admin the practice but not the chequebook', () => {
    expect(can('admin', 'team:manage')).toBe(true);
    expect(can('admin', 'firm:settings')).toBe(true);

    expect(can('admin', 'billing:manage')).toBe(false);
    expect(can('admin', 'team:manage-owners')).toBe(false);
  });

  it('gives an owner everything', () => {
    for (const permission of PERMISSIONS) {
      expect(can('owner', permission), permission).toBe(true);
    }
  });

  it('never lets a lower role do more than a higher one', () => {
    const member = new Set(permissionsFor('member'));
    const admin = new Set(permissionsFor('admin'));
    const owner = new Set(permissionsFor('owner'));

    for (const permission of member) expect(admin.has(permission), permission).toBe(true);
    for (const permission of admin) expect(owner.has(permission), permission).toBe(true);
  });

  it('has an answer for every permission and every role', () => {
    // A permission added without a role mapping would silently deny everybody, and a role
    // added without one would throw.
    for (const role of FIRM_ROLES) {
      for (const permission of PERMISSIONS) {
        expect(typeof can(role, permission), `${role}/${permission}`).toBe('boolean');
      }
    }
  });
});

describe('refusals', () => {
  it('explains who can do it instead', () => {
    try {
      assertCan('member', 'team:manage');
      throw new Error('assertCan did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Forbidden);
      // Not "missing permission team:manage" — the person reading this needs to know what
      // to do next, which is ask somebody.
      expect((error as Forbidden).message).toMatch(/Ask one of them/);
      expect((error as Forbidden).role).toBe('member');
      expect((error as Forbidden).permission).toBe('team:manage');
    }
  });

  it('does not throw for something the role may do', () => {
    expect(() => assertCan('member', 'requests:review')).not.toThrow();
  });
});

describe('changing somebody’s role', () => {
  it('lets an owner do anything', () => {
    const roles: FirmRole[] = ['owner', 'admin', 'member'];
    for (const subject of roles) {
      for (const next of roles) {
        expect(canAssignRole('owner', subject, next), `${subject}→${next}`).toBe(true);
      }
    }
  });

  it('stops an admin promoting anybody to owner — including themselves', () => {
    expect(canAssignRole('admin', 'member', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'member', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'admin', 'owner')).toBe(false);
  });

  it('stops an admin demoting an owner and taking the firm', () => {
    expect(canAssignRole('admin', 'owner', 'member')).toBe(false);
    expect(canAssignRole('admin', 'owner', 'admin')).toBe(false);
  });

  it('stops a member changing anybody', () => {
    expect(canAssignRole('member', 'member', 'admin')).toBe(false);
    expect(canAssignRole('member', 'member', 'member')).toBe(false);
  });
});

describe('the platform-admin list', () => {
  it('matches an exact address, case and whitespace aside', () => {
    expect(matchesAdminList('ops@seziro.com', 'ops@seziro.com')).toBe(true);
    expect(matchesAdminList('OPS@Seziro.com', ' ops@seziro.com , other@x.com')).toBe(true);
    expect(matchesAdminList('someone@seziro.com', 'ops@seziro.com')).toBe(false);
  });

  it('matches a whole domain when the entry starts with @', () => {
    expect(matchesAdminList('anyone@seziro.com', '@seziro.com')).toBe(true);
    expect(matchesAdminList('anyone@seziro.com.evil.test', '@seziro.com')).toBe(false);
    expect(matchesAdminList('anyone@notseziro.com', '@seziro.com')).toBe(false);
  });

  it('lets nobody in when the list is empty', () => {
    // The self-hosted default. There is no operator, because there is nobody above the
    // firm running the install — and that has to be the behaviour, not a promise.
    for (const list of [undefined, null, '', '   ', ',,']) {
      expect(matchesAdminList('ops@seziro.com', list)).toBe(false);
    }
  });

  it('refuses anything that is not an address', () => {
    expect(matchesAdminList('seziro.com', '@seziro.com')).toBe(false);
    expect(matchesAdminList('', '@seziro.com')).toBe(false);
  });
});
