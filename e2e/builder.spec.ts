import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { addClient, itemLabels, newRequest, saveChecklist, signUpOwner } from './session';

/**
 * The published checklist, read from `templates/SOURCES.md` rather than from the code.
 *
 * plan.md §9 asks that a request built from each built-in match the counts and labels in
 * that document. Parsing the document is what makes this a check rather than a restatement:
 * if the two ever disagree, this test is where it shows.
 */
interface PublishedTemplate {
  name: string;
  key: string;
  sections: number;
  items: number;
  labels: string[];
}

function publishedTemplates(): PublishedTemplate[] {
  const doc = readFileSync(new URL('../templates/SOURCES.md', import.meta.url), 'utf8');
  const summary = [...doc.matchAll(/^\| (.+?) \| `([a-z0-9-]+)` \| (\d+) \| (\d+) \| .+ \|$/gm)];
  expect(summary).toHaveLength(4);

  return summary.map(([, name, key, sections, items]) => {
    const section = doc.slice(doc.indexOf(`\`${key}\` ·`));
    const end = section.indexOf('\n---\n');
    const rows = [
      ...section
        .slice(0, end)
        .matchAll(/^\| \d+\.\d+ \| (.+?) \| .+? \| (?:Required|Optional) \| .+ \|$/gm),
    ];
    const labels = rows.map(([, label]) => label!.replace(/\\\|/g, '|'));
    expect(labels).toHaveLength(Number(items));
    return { name: name!, key: key!, sections: Number(sections), items: Number(items), labels };
  });
}

const ITEM_TYPES = [
  'File upload',
  'Short text',
  'Long text',
  'Yes / no',
  'Date',
  'Choice',
  'Number',
] as const;

test('a request from each built-in template matches every count and label in SOURCES.md', async ({
  page,
}) => {
  const published = publishedTemplates();
  await signUpOwner(page, 'builtin');
  await addClient(page, 'Marta Alvarez');

  // The template page is where the "nothing was invented" claim has to hold up.
  await page.goto('/templates');
  await page.getByRole('link', { name: 'US individual tax return — year-end documents' }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole('link', { name: 'IRS — Checklist for free tax return preparation' }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Original photo identification for you and your spouse'),
  ).toBeVisible();

  for (const template of published) {
    const id = await newRequest(page, `Built from ${template.key}`, template.name);
    await page.goto(`/requests/${id}`);

    await expect(
      page.getByText(`${template.sections} sections · ${template.items} items`),
    ).toBeVisible();

    const shown = await page.locator('main').innerText();
    const missing = template.labels.filter((label) => !shown.includes(label));
    expect(missing, `labels missing from a request built from ${template.key}`).toEqual([]);

    // A copy, not a link: the request carries no citations, because a firm may edit it.
    expect(shown).not.toContain('IRS — Checklist for free tax return preparation');
  }

  // Acceptance ④ — every mutation left a hash-chained trace.
  await page.goto('/dashboard');
  await expect(page.getByText('Client added')).toBeVisible();
  await expect(page.getByText('Request created').first()).toBeVisible();
});

// A tall window so several item cards are on screen at once — the drag below is a real
// pointer drag, and a pointer cannot reach a row the browser has not laid out yet.
test.use({ viewport: { width: 1280, height: 1400 } });

test('adds one of every item type, reorders by drag, and the order survives a reload', async ({
  page,
}) => {
  await signUpOwner(page, 'types');
  await addClient(page, 'Devon Wright');
  const id = await newRequest(page, 'One of everything');

  await page.getByTestId('add-section').click();
  await page.getByTestId('section-title').fill('Everything');

  for (const type of ITEM_TYPES) {
    await page.getByRole('button', { name: `+ ${type}` }).click();
  }
  await expect(page.getByTestId('item')).toHaveCount(7);

  const labelFields = page.getByLabel('What are you asking for?');
  for (const [index, type] of ITEM_TYPES.entries()) {
    await labelFields.nth(index).fill(`${index + 1}. ${type} item`);
  }
  // Choice items need real options before they can be saved.
  // `exact` matters: "Option 1" is also a substring of the "Remove option 1" button.
  await page.getByLabel('Option 1', { exact: true }).fill('Yes, and here is why');
  await page.getByLabel('Option 2', { exact: true }).fill('No');

  await saveChecklist(page);
  const original = await itemLabels(page);
  expect(original).toEqual(ITEM_TYPES.map((type, index) => `${index + 1}. ${type} item`));

  // Drag the first item down onto the third. Pointer events, so this is the same path a
  // mouse or a finger takes — not a synthetic reorder call.
  const handles = page.getByTestId('item').getByRole('button', { name: /Drag to reorder/ });
  await handles.nth(0).scrollIntoViewIfNeeded();
  const from = await handles.nth(0).boundingBox();
  const to = await page.getByTestId('item').nth(2).boundingBox();
  if (!from || !to) throw new Error('Could not measure the rows to drag between');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();

  const dragged = await itemLabels(page);
  expect(dragged).not.toEqual(original);
  expect([...dragged].sort()).toEqual([...original].sort());
  expect(dragged[0]).not.toBe(original[0]);

  await saveChecklist(page);
  await page.reload();
  expect(await itemLabels(page)).toEqual(dragged);

  // The same reorder without a pointer at all: focus a handle and use the arrow keys.
  const beforeKeyboard = await itemLabels(page);
  await handles.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  const afterKeyboard = await itemLabels(page);
  expect(afterKeyboard[0]).toBe(beforeKeyboard[1]);
  expect(afterKeyboard[1]).toBe(beforeKeyboard[0]);

  await saveChecklist(page);
  await page.reload();
  expect(await itemLabels(page)).toEqual(afterKeyboard);

  // All seven types round-tripped through the database and back into the builder.
  await page.goto(`/requests/${id}`);
  for (const type of ITEM_TYPES) {
    await expect(page.getByText(type, { exact: true }).first()).toBeVisible();
  }
});

test('every mutation lands in the audit trail', async ({ page }) => {
  await signUpOwner(page, 'audit');
  await addClient(page, 'Casey Rowe');

  await page.getByRole('link', { name: 'Casey Rowe' }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = page.url();
  await page.getByLabel('Company (optional)').fill('Rowe Holdings LLC');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/clients$/);

  const requestId = await newRequest(page, 'Onboarding pack', 'New business client onboarding');
  await page.getByTestId('item').first().getByRole('button', { name: 'Delete' }).click();
  await saveChecklist(page);

  await page.goto(`/requests/${requestId}`);
  await page.getByLabel('Title').fill('Onboarding pack — revised');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('heading', { name: 'Onboarding pack — revised' })).toBeVisible();

  await page.getByLabel('Template name').fill('Our onboarding pack');
  await page.getByRole('button', { name: 'Save as template' }).click();
  await expect(page).toHaveURL(/\/templates$/);

  await page.getByRole('link', { name: 'Our onboarding pack' }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Delete template' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole('link', { name: 'Our onboarding pack' })).toHaveCount(0);

  await page.goto(`/requests/${requestId}`);
  await page.getByRole('button', { name: 'Delete request' }).click();
  await expect(page).toHaveURL(/\/requests$/);

  await page.goto(clientUrl);
  await page.getByRole('button', { name: 'Archive client' }).click();
  await expect(page).toHaveURL(/\/clients$/);

  await page.goto('/dashboard');
  for (const entry of [
    'Client added',
    'Client updated',
    'Request created',
    'Checklist changed',
    'Request details changed',
    'Template saved',
    'Template deleted',
    'Request deleted',
    'Client archived',
  ]) {
    await expect(page.getByText(entry, { exact: true })).toBeVisible();
  }
});

test('a request saved as a template produces an independent copy', async ({ page }) => {
  await signUpOwner(page, 'template');
  await addClient(page, 'Priya Nair');
  const sourceId = await newRequest(
    page,
    'Monthly close — our version',
    'Monthly bookkeeping close',
  );

  await page.goto(`/requests/${sourceId}`);
  await page.getByLabel('Template name').fill('Our monthly close');
  await page.getByRole('button', { name: 'Save as template' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole('link', { name: 'Our monthly close' })).toBeVisible();

  await page.getByRole('link', { name: 'Our monthly close' }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
  const templateUrl = page.url();
  await expect(page.getByText('4 sections · 14 items')).toBeVisible();
  await expect(page.getByText('Bank statement for every business account')).toBeVisible();

  // Build a request from the saved template, then rewrite it completely.
  const copyId = await newRequest(page, 'February close', 'Our monthly close');
  const firstLabel = page.getByLabel('What are you asking for?').first();
  await expect(firstLabel).toHaveValue('Which month is this for?');
  await firstLabel.fill('Rewritten by the firm');
  await page.getByTestId('item').first().getByRole('button', { name: 'Delete' }).click();
  await saveChecklist(page);

  // The template is untouched — and so is the request it was made from.
  await page.goto(templateUrl);
  await expect(page.getByText('4 sections · 14 items')).toBeVisible();
  await expect(page.getByText('Which month is this for?')).toBeVisible();
  await expect(page.getByText('Rewritten by the firm')).toHaveCount(0);

  await page.goto(`/requests/${sourceId}`);
  await expect(page.getByText('Which month is this for?')).toBeVisible();

  await page.goto(`/requests/${copyId}`);
  await expect(page.getByText('Which month is this for?')).toHaveCount(0);

  await page.goto('/dashboard');
  await expect(page.getByText('Template saved')).toBeVisible();
  await expect(page.getByText('Checklist changed')).toBeVisible();
});
