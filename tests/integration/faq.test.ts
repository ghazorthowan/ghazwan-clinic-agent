/**
 * M4 integration tests — FAQ retrieval and clinical guard.
 *
 * Tests:
 *  - searchFaq returns seeded results for Arabic + English queries
 *  - Full-text search is language-neutral (finds both scripts)
 *  - No results for nonsense queries (graceful empty return)
 *  - Clinical/diagnostic keywords are NOT in the FAQ (stays administrative)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDb } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;
let searchFaqFn: (query: string, limit?: number) => Promise<unknown[]>;

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('faq_m4'));
  process.env.DATABASE_URL = pool.options.connectionString as string;

  const faqModule = await import('../../lib/faq');
  searchFaqFn = faqModule.searchFaq;
}, 30_000);

afterAll(async () => {
  await teardown();
}, 15_000);

describe('searchFaq()', () => {
  it('finds Arabic clinic hours FAQ', async () => {
    const results = await searchFaqFn('مواعيد العيادة');
    expect(results.length).toBeGreaterThan(0);
    const first = results[0] as { answer: string; language: string };
    expect(first.language).toBe('ar');
    expect(first.answer).toMatch(/السبت|الأحد/);
  });

  it('finds English clinic hours FAQ', async () => {
    const results = await searchFaqFn('opening hours');
    expect(results.length).toBeGreaterThan(0);
    const first = results[0] as { answer: string; language: string };
    expect(first.language).toBe('en');
    expect(first.answer).toMatch(/Saturday|Sunday/i);
  });

  it('finds booking FAQ in Arabic', async () => {
    const results = await searchFaqFn('حجز موعد');
    expect(results.length).toBeGreaterThan(0);
    const item = results[0] as { answer: string };
    expect(item.answer).toMatch(/حجز|تأكيد/);
  });

  it('finds cancellation FAQ in English', async () => {
    const results = await searchFaqFn('cancel appointment');
    expect(results.length).toBeGreaterThan(0);
    const item = results[0] as { answer: string };
    expect(item.answer).toMatch(/cancel/i);
  });

  it('finds payment / fees FAQ', async () => {
    const results = await searchFaqFn('fees payment');
    expect(results.length).toBeGreaterThan(0);
    const item = results[0] as { answer: string };
    expect(item.answer).toMatch(/fee|pay|رسوم/i);
  });

  it('returns empty array for a nonsense query (no match)', async () => {
    const results = await searchFaqFn('xyznonexistentterm99999');
    expect(results).toEqual([]);
  });

  it('returns empty array for an empty query string', async () => {
    const results = await searchFaqFn('');
    expect(results).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const results = await searchFaqFn('clinic', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('FAQ results have required fields', async () => {
    const results = await searchFaqFn('booking') as Array<{
      id: string; question: string; answer: string; language: string; tags: string[];
    }>;
    expect(results.length).toBeGreaterThan(0);
    const item = results[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('question');
    expect(item).toHaveProperty('answer');
    expect(item).toHaveProperty('language');
    expect(Array.isArray(item.tags)).toBe(true);
  });

  it('no FAQ entry contains clinical/diagnostic content', async () => {
    // Verify the seed data respects CLAUDE.md rule 5
    const rows = await pool.query<{ answer: string }>(
      `SELECT answer FROM clinic_faqs WHERE is_active = true`,
    );
    const clinicalTerms = /diagnos|prescription|surgery|operation|x-?ray|mri|تشخيص|وصفة|عملية جراحية/i;
    for (const row of rows.rows) {
      expect(row.answer).not.toMatch(clinicalTerms);
    }
  });
});

describe('clinic_faqs table', () => {
  it('all seed FAQs are active', async () => {
    const r = await pool.query(`SELECT count(*) FROM clinic_faqs WHERE is_active = false`);
    expect(parseInt(r.rows[0].count, 10)).toBe(0);
  });

  it('every FAQ has a non-empty question and answer', async () => {
    const r = await pool.query(
      `SELECT id FROM clinic_faqs WHERE trim(question) = '' OR trim(answer) = ''`,
    );
    expect(r.rowCount).toBe(0);
  });

  it('language values are only ar or en', async () => {
    const r = await pool.query(
      `SELECT id FROM clinic_faqs WHERE language NOT IN ('ar', 'en')`,
    );
    expect(r.rowCount).toBe(0);
  });
});
