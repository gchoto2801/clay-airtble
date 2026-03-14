import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;

  if (!apiKey || !baseId || !tableId) {
    return NextResponse.json({ error: 'Airtable not configured' }, { status: 500 });
  }

  try {
    const allRecords: Record<string, unknown>[] = [];
    let offset: string | undefined;

    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: `Airtable error: ${err}` }, { status: res.status });
      }

      const data = await res.json();
      allRecords.push(...data.records);
      offset = data.offset;
    } while (offset);

    // Flatten fields
    const records = allRecords.map((r: Record<string, unknown>) => {
      const fields = r.fields as Record<string, unknown>;
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        const key = k.replace(/ /g, '_').replace(/[()]/g, '');
        if (Array.isArray(v)) {
          flat[key] = v.join(', ');
        } else {
          flat[key] = String(v || '');
        }
      }
      return flat;
    });

    return NextResponse.json({ records, count: records.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
