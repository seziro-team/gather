import { describe, expect, it } from 'vitest';
import {
  checkSeats,
  checkStorage,
  effectivePlan,
  FEATURES,
  PLAN_DEFINITIONS,
  PLANS,
  planIncludes,
} from './plans.js';

/**
 * The boundary rule, as a test.
 *
 * plan.md §7.2: every paid item is hosting, a per-message cost, a third-party integration
 * or a compliance convenience — and **nothing in the self-hosted product is crippled to
 * create a paid one**. That is a promise a company makes and then quietly breaks one
 * feature at a time, so it is checked here rather than written in a README.
 */

describe('the boundary between free and paid', () => {
  it('gives self-hosted no limits at all', () => {
    const free = PLAN_DEFINITIONS.self_hosted;
    // `null`, not a large number: there is no meter to turn down later.
    expect(free.seats).toBeNull();
    expect(free.storageBytes).toBeNull();
  });

  it('never puts a core capability behind a plan', () => {
    // Everything a firm can run on its own server is theirs. A paid feature has to cost
    // us money per use, or need an account we hold — if one ever appears here that does
    // not, this test is where the argument happens.
    const paidOnly = new Set(FEATURES.filter((feature) => !planIncludes('self_hosted', feature)));

    expect([...paidOnly].sort()).toEqual(['managed-hosting', 'managed-retention']);
  });

  it('charges nothing for requests, clients or the audit trail on any plan', () => {
    // These are not features in the list, which is the point — there is no code path that
    // could gate them, because they were never modelled as gateable.
    for (const plan of PLANS) {
      expect(PLAN_DEFINITIONS[plan].features).not.toContain('requests');
      expect(PLAN_DEFINITIONS[plan].features).not.toContain('audit');
    }
  });
});

describe('seats', () => {
  it('never refuses a seat on self-hosted', () => {
    expect(checkSeats('self_hosted', 500)).toMatchObject({ allowed: true, limit: null });
  });

  it('counts invitations, not just members', () => {
    // Cloud includes three. Two members and one pending invite fills it, and the fourth
    // person is told when they are invited rather than when they try to accept.
    expect(checkSeats('cloud', 2).allowed).toBe(true);
    expect(checkSeats('cloud', 3).allowed).toBe(false);
    expect(checkSeats('cloud', 3).reason).toMatch(/includes 3 seats/);
  });

  it('gives Pro more room', () => {
    expect(checkSeats('cloud_pro', 9).allowed).toBe(true);
    expect(checkSeats('cloud_pro', 10).allowed).toBe(false);
  });
});

describe('storage', () => {
  const GB = 1024 * 1024 * 1024;

  it('never refuses an upload on self-hosted', () => {
    expect(checkStorage('self_hosted', 900 * GB, 50 * GB).allowed).toBe(true);
  });

  it('refuses the upload that would cross the line, not the one after it', () => {
    expect(checkStorage('cloud', 24 * GB, 1 * GB).allowed).toBe(true);
    expect(checkStorage('cloud', 24 * GB, 2 * GB).allowed).toBe(false);
    expect(checkStorage('cloud', 24 * GB, 2 * GB).reason).toMatch(/includes 25 GB/);
  });
});

describe('what happens when a subscription lapses', () => {
  it('keeps the plan while Stripe is still retrying', () => {
    // `past_due` is a card that failed and is being retried. Nothing changes while
    // somebody updates it.
    expect(effectivePlan('cloud_pro', 'past_due')).toBe('cloud_pro');
    expect(effectivePlan('cloud', 'trialing')).toBe('cloud');
    expect(effectivePlan('cloud', 'active')).toBe('cloud');
  });

  it('falls back to self-hosted rather than to nothing', () => {
    // The firm keeps its documents, its clients and its account, and loses only the
    // hosted extras. Locking a firm out of its clients' tax records over a failed card is
    // not a thing this product will do.
    expect(effectivePlan('cloud_pro', 'canceled')).toBe('self_hosted');
    expect(effectivePlan('cloud', 'unpaid')).toBe('self_hosted');
    expect(effectivePlan('cloud', 'none')).toBe('self_hosted');
  });

  it('leaves a lapsed firm with no limits, not with tighter ones', () => {
    const lapsed = effectivePlan('cloud', 'canceled');
    expect(checkSeats(lapsed, 50).allowed).toBe(true);
    expect(checkStorage(lapsed, 500 * 1024 ** 3, 1024 ** 3).allowed).toBe(true);
  });
});
