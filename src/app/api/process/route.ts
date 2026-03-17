import { NextResponse } from 'next/server';
import { cleanRecord, type CleanedRecord } from '@/lib/cleaning';

function dedupByAPN(records: Record<string, string>[]): Record<string, string>[] {
  const map = new Map<string, Record<string, string>>();

  for (const raw of records) {
    const apn = (raw['Apn'] || raw['APN'] || raw['apn'] || '').trim();
    const owner = (raw['Owner_Name'] || raw['Owner Name'] || raw['OWNER_NAME_1'] || '').trim();
    const key = apn ? apn : owner;

    if (!key) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, raw);
    } else {
      // Keep the record with more enrichment data
      const countFields = (r: Record<string, string>) => {
        const enrichmentKeys = [
          'SOS_Business_Entity_Data_agent_Name', 'SOS Business Entity Data agent Name',
          'SOS_Business_Entity_Data_officer_Names', 'SOS Business Entity Data officer Names',
          'Contact_Phone', 'Contact Phone',
          'Contact_Email', 'Contact Email',
          'Skip_Trace_Results_agent_Name', 'Skip Trace Results agent Name',
          'Skip_Trace_Results_officer_Names', 'Skip Trace Results officer Names',
          'Skip_Trace_Results_contact_Phone', 'Skip Trace Results contact Phone',
          'Skip_Trace_Results_contact_Email', 'Skip Trace Results contact Email',
          'Contact_Phone_2', 'Contact Phone (2)',
          'Contact_Email_2', 'Contact Email (2)',
        ];
        return enrichmentKeys.filter(k => {
          const v = (r[k] || '').trim();
          return v && v !== 'Response';
        }).length;
      };

      if (countFields(raw) > countFields(existing)) {
        map.set(key, raw);
      }
    }
  }

  return Array.from(map.values());
}

export async function POST(request: Request) {
  try {
    const { records } = await request.json() as { records: Record<string, string>[] };

    if (!records || !Array.isArray(records)) {
      return NextResponse.json({ error: 'records array required' }, { status: 400 });
    }

    // Dedup by APN first
    const deduped = dedupByAPN(records);

    const found: CleanedRecord[] = [];
    const reiskip: CleanedRecord[] = [];

    for (const raw of deduped) {
      const cleaned = cleanRecord(raw);
      if (cleaned.classification === 'found') {
        found.push(cleaned);
      } else {
        reiskip.push(cleaned);
      }
    }

    const stats = {
      total: records.length,
      dedupedTotal: deduped.length,
      duplicatesRemoved: records.length - deduped.length,
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
