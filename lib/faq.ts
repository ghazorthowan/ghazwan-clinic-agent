/**
 * Physician-approved administrative FAQ retrieval.
 *
 * Full-text search over clinic_faqs using PostgreSQL's tsvector index.
 * Returns the top-N most relevant approved answers.
 *
 * CLAUDE.md rule 6: AI reads FAQs only through this validated function —
 * no direct SQL from the model.
 */

import { pool } from './db';

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  language: string;
  tags: string[];
}

/**
 * Search physician-approved FAQs using full-text search.
 * Returns up to `limit` results (default 3) ordered by relevance.
 * Falls back to an empty array on any error so the AI can keep running.
 */
export async function searchFaq(
  query: string,
  limit = 3,
): Promise<FaqEntry[]> {
  if (!query.trim()) return [];

  try {
    // Use pg_catalog.simple (language-neutral) so Arabic and English both work
    const result = await pool.query<FaqEntry>(`
      SELECT id, question, answer, language, tags
      FROM clinic_faqs
      WHERE is_active = true
        AND to_tsvector('simple', question || ' ' || answer)
            @@ plainto_tsquery('simple', $1)
      ORDER BY ts_rank(
        to_tsvector('simple', question || ' ' || answer),
        plainto_tsquery('simple', $1)
      ) DESC
      LIMIT $2
    `, [query, limit]);

    return result.rows;
  } catch (err) {
    console.error('[faq] search error:', err);
    return [];
  }
}
