import { NextResponse } from 'next/server';

const API_KEY = () => process.env.AIRTABLE_API_KEY!;
const BASE_ID = () => process.env.AIRTABLE_BASE_ID!;
const CONFIG_TABLE = 'Batch Config';

async function airtableFetch(path: string, options?: RequestInit) {
  const url = `https://api.airtable.com/v0/${BASE_ID()}/${encodeURIComponent(CONFIG_TABLE)}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY()}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    cache: 'no-store',
  });
}

// GET: Read current batch config
export async function GET() {
  try {
    const res = await airtableFetch('?maxRecords=1&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc');
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }
    const data = await res.json();
    const record = data.records?.[0];
    if (!record) {
      return NextResponse.json({ config: null });
    }
    return NextResponse.json({
      config: {
        id: record.id,
        expectedCount: record.fields['Expected Count'] || 0,
        status: record.fields['Status'] || 'pending',
        batchId: record.fields['Batch ID'] || '',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST: Create or update batch config
export async function POST(request: Request) {
  try {
    const { expectedCount, batchId, status } = await request.json();

    // Find existing record to update
    const getRes = await airtableFetch('?maxRecords=1&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc');
    const getData = await getRes.json();
    const existing = getData.records?.[0];

    const fields: Record<string, unknown> = {};
    if (expectedCount !== undefined) fields['Expected Count'] = expectedCount;
    if (batchId !== undefined) fields['Batch ID'] = batchId;
    if (status !== undefined) fields['Status'] = status;

    let result;
    if (existing) {
      const res = await airtableFetch(`/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      });
      result = await res.json();
    } else {
      const res = await airtableFetch('', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
      result = await res.json();
    }

    return NextResponse.json({ success: true, record: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
