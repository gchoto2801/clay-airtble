import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const clayUrl = process.env.CLAY_WEBHOOK_URL;
  if (!clayUrl) {
    return NextResponse.json({ error: 'CLAY_WEBHOOK_URL not configured' }, { status: 500 });
  }

  try {
    const { rows } = await request.json() as { rows: Record<string, string>[] };

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'rows array required' }, { status: 400 });
    }

    const results: { owner: string; status: number | string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const res = await fetch(clayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row),
        });
        results.push({ owner: row['Owner Name'] || '?', status: res.status });
      } catch (err) {
        results.push({ owner: row['Owner Name'] || '?', status: String(err) });
      }

      // Rate limit: 1.5s between requests
      if (i < rows.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    const success = results.filter(r => r.status === 200).length;
    return NextResponse.json({ sent: rows.length, success, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
