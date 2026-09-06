import { expect, test } from '@playwright/test';
import { sql } from './mailbox';
import { signUpOwner } from './session';

/**
 * The first line of a psql result.
 *
 * `psql` prints its command tag ("INSERT 0 1") after the rows even with `-t`, so a
 * RETURNING clause read whole picks it up and the next query gets a uuid with a newline
 * in it.
 */
function one(statement: string): string {
  return sql(statement).split('\n')[0]!.trim();
}

/**
 * The firm this account belongs to.
 *
 * Matched on the exact address rather than a `like` and "the newest row": `firm_user.id` is
 * a uuid, so ordering by it is ordering by nothing, and a previous run of this file would
 * be picked instead — which is how these tests seeded one firm and looked at another.
 */
function firmOf(email: string): string {
  const firmId = one(
    `select fu.firm_id from firm_user fu join "user" u on u.id = fu.user_id
      where u.email = '${email}'`,
  );
  expect(firmId, `no firm for ${email}`).toMatch(/^[0-9a-f-]{36}$/);
  return firmId;
}

/**
 * Behaviour at a size a real practice reaches.
 *
 * Every list page used to run `select …` with no limit and render every row. That is fine
 * for the dozen requests a demo has, and it does not fail loudly at four thousand — it just
 * gets slower, until one January it is unusable. So this seeds more rows than fit on a page
 * and asserts the things that were previously untrue: the query is bounded, the pager is
 * honest about the total, search narrows it, and a crafted URL cannot ask for everything.
 *
 * Rows are inserted directly. Driving 60 clients through the UI would test the form 60
 * times and paging once; the subject here is the list.
 */

const SEEDED = 60;

test('① a firm with more clients than fit on a page can still use the page', async ({ page }) => {
  const { email } = await signUpOwner(page, 'scale-clients');
  const firmId = firmOf(email);

  // 60 clients, plus one with a name nothing else shares, to search for later.
  sql(`insert into client (firm_id, name, email)
       select '${firmId}', 'Client ' || lpad(i::text, 3, '0'),
              'client' || i || '@scale.test'
         from generate_series(1, ${SEEDED}) as i`);
  sql(`insert into client (firm_id, name, email)
       values ('${firmId}', 'Zebulon Singular Ltd', 'zebulon@scale.test')`);

  await page.goto('/clients');

  // The page renders a page, not the table. 25 is the default; the summary is what tells
  // the person there is more.
  const rows = page.locator('main li');
  await expect(rows).toHaveCount(25);
  await expect(page.getByTestId('pager-summary')).toContainText(`of ${SEEDED + 1} clients`);
  await expect(page.getByTestId('pager-summary')).toContainText('page 1 of 3');

  // Paging is a link, so it is bookmarkable and works without JavaScript.
  await page.getByTestId('pager-next').click();
  await expect(page).toHaveURL(/\/clients\?page=2/);
  await expect(page.getByTestId('pager-summary')).toContainText('26–50');
  await expect(page.getByRole('link', { name: 'Client 026' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Client 001' })).toHaveCount(0);

  // Search narrows the whole set, not the current page — the one on page 3 is found.
  await page.goto('/clients');
  await page.getByTestId('search').fill('Zebulon');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: 'Zebulon Singular Ltd' })).toBeVisible();
  await expect(page.getByTestId('pager-summary')).toContainText('1 client');
});

test('② a crafted URL cannot ask for the whole table, or break the page', async ({ page }) => {
  await signUpOwner(page, 'scale-urls');

  // Every one of these used to be a way to get an unbounded query or a 500. They now all
  // resolve to a sensible page, because a list page reachable from a shared link has to
  // survive whatever is in that link.
  for (const query of [
    '?page=0',
    '?page=-1',
    '?page=abc',
    '?page=99999',
    '?page=1&size=100000',
    '?q=' + 'x'.repeat(5000),
    "?q=%'--",
  ]) {
    const response = await page.request.get(`/clients${query}`);
    expect(response.status(), `/clients${query} answered ${response.status()}`).toBe(200);
  }
});

test('③ the dashboard and the requests list are bounded too', async ({ page }) => {
  const { email } = await signUpOwner(page, 'scale-requests');
  const firmId = firmOf(email);
  const clientId = one(
    `insert into client (firm_id, name, email)
     values ('${firmId}', 'Bulk Client', 'bulk@scale.test') returning id`,
  );

  sql(`insert into request (firm_id, client_id, title, status)
       select '${firmId}', '${clientId}', 'Request ' || lpad(i::text, 3, '0'), 'draft'
         from generate_series(1, 40) as i`);

  await page.goto('/requests');
  await expect(page.locator('main li')).toHaveCount(25);
  await expect(page.getByTestId('pager-summary')).toContainText('of 40 requests');

  await page.getByTestId('search').fill('Request 007');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('pager-summary')).toContainText('1 request');

  // The dashboard's own list is paged on the same rules — it is the page a firm opens first
  // and the one that used to render every row a firm had.
  await page.goto('/dashboard?filter=all');
  await expect(page.getByTestId('pager-summary')).toContainText('of 40 requests');
  await expect(page.getByTestId('request-list').locator('li')).toHaveCount(25);
});

test('④ metrics are off without a token, and refuse a wrong one', async ({ page }) => {
  // This stack sets no GATHER_METRICS_TOKEN. An install that does not export metrics should
  // not advertise that it could, so the endpoint is absent rather than unauthorised.
  const anonymous = await page.request.get('/api/metrics');
  expect(anonymous.status()).toBe(404);

  const guessed = await page.request.get('/api/metrics', {
    headers: { authorization: 'Bearer not-the-token' },
  });
  expect(guessed.status()).toBe(404);
});

test('⑤ liveness answers without touching the database; readiness says more', async ({ page }) => {
  const live = await page.request.get('/api/live');
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain('alive');

  // Readiness is the one that means "send it traffic": the schema has to be current.
  const ready = await page.request.get('/api/health');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({
    status: 'ok',
    db: 'ok',
    migrations: 'applied',
  });
});
