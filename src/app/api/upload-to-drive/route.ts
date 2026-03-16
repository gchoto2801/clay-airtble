import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_UPLOAD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: 'N8N_UPLOAD_WEBHOOK_URL not configured' },
      { status: 500 }
    );
  }

  try {
    const { csv, filename } = await request.json() as { csv: string; filename: string };

    if (!csv) {
      return NextResponse.json({ error: 'csv content required' }, { status: 400 });
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, filename: filename || 'upload.csv' }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `n8n webhook error: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      fileId: data.fileId,
      fileName: data.fileName,
      folderId: data.folderId,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
