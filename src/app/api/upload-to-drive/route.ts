import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1uWdDrNYd8yhfiP75Qo0YWOoFN5hqZdRL';

function getDriveClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');

  const creds = JSON.parse(credJson);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function POST(request: Request) {
  try {
    const { csv, filename } = (await request.json()) as { csv: string; filename: string };

    if (!csv) {
      return NextResponse.json({ error: 'csv content required' }, { status: 400 });
    }

    const drive = getDriveClient();
    const safeName = filename || `upload-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

    // First verify we can access the folder
    try {
      await drive.files.get({ fileId: FOLDER_ID, supportsAllDrives: true });
    } catch (accessErr) {
      const msg = accessErr instanceof Error ? accessErr.message : String(accessErr);
      return NextResponse.json({ 
        error: `Cannot access Drive folder: ${msg}. Make sure the folder is shared with the service account email.`,
        folderIdUsed: FOLDER_ID,
      }, { status: 403 });
    }

    // Upload CSV to the watched Drive folder
    const res = await drive.files.create({
      requestBody: {
        name: safeName,
        mimeType: 'text/csv',
        parents: [FOLDER_ID],
      },
      media: {
        mimeType: 'text/csv',
        body: Readable.from(Buffer.from(csv, 'utf-8')),
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });

    return NextResponse.json({
      success: true,
      fileId: res.data.id,
      fileName: res.data.name,
      link: res.data.webViewLink,
    });
  } catch (err) {
    console.error('Drive upload error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
