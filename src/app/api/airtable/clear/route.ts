import { NextResponse } from 'next/server';

export async function DELETE() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;

  if (!apiKey || !baseId || !tableId) {
    return NextResponse.json({ error: 'Airtable not configured' }, { status: 500 });
  }

  try {
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch up to 100 record IDs
      const listRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/${tableId}?pageSize=100&fields%5B%5D=Owner%20Name`,
        { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' }
      );
      const listData = await listRes.json();
      const records = listData.records || [];

      if (records.length === 0) {
        hasMore = false;
        break;
      }

      // Delete in batches of 10 (Airtable limit)
      for (let i = 0; i < records.length; i += 10) {
        const batch = records.slice(i, i + 10);
        const params = batch.map((r: { id: string }) => `records[]=${r.id}`).join('&');
        const delRes = await fetch(
          `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (!delRes.ok) {
          const err = await delRes.text();
          return NextResponse.json({ error: `Delete failed: ${err}`, deleted: totalDeleted }, { status: 500 });
        }
        const delData = await delRes.json();
        totalDeleted += delData.records?.length || 0;

        // Rate limit: small delay between batches
        if (i + 10 < records.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    return NextResponse.json({ success: true, deleted: totalDeleted });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
