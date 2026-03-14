import { NextResponse } from 'next/server';
import { cleanRecord, type CleanedRecord } from '@/lib/cleaning';

export async function POST(request: Request) {
  try {
    const { records } = await request.json() as { records: Record<string, string>[] };

    if (!records || !Array.isArray(records)) {
      return NextResponse.json({ error: 'records array required' }, { status: 400 });
    }

    const found: CleanedRecord[] = [];
    const reiskip: CleanedRecord[] = [];

    for (const raw of records) {
      const cleaned = cleanRecord(raw);
      if (cleaned.classification === 'found') {
        found.push(cleaned);
      } else {
        reiskip.push(cleaned);
      }
    }

    const stats = {
      total: records.length,
      foundCount: found.length,
      reiskipCount: reiskip.length,
      phoneCoverage: found.length > 0
        ? Math.round((found.filter(r => r.phone1).length / found.length) * 100)
        : 0,
      emailCoverage: found.length > 0
        ? Math.round((found.filter(r => r.email1).length / found.length) * 100)
        : 0,
      byState: {} as Record<string, number>,
    };

    for (const r of [...found, ...reiskip]) {
      const state = r.propertyState || 'Unknown';
      stats.byState[state] = (stats.byState[state] || 0) + 1;
    }

    return NextResponse.json({ found, reiskip, stats });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
