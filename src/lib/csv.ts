// CSV parsing and generation utilities

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h.trim()] = (values[idx] || '').trim();
    });
    records.push(record);
  }

  return records;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

export function generateCSV(records: Record<string, string>[], columns: string[]): string {
  const header = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
  const rows = records.map(r =>
    columns.map(c => `"${(r[c] || '').replace(/"/g, '""')}"`).join(',')
  );
  return [header, ...rows].join('\n');
}

// Map original CSV fields to Clay webhook format
export function mapToClayFormat(record: Record<string, string>): Record<string, string> {
  return {
    'Owner Name': record['OWNER_NAME_1'] || record['Owner Name'] || record['Owner_Name'] || '',
    'Property Address': record['PROP_ADDRESS'] || record['SITE_ADDR'] || record['Property Address'] || '',
    'Property City': record['PROP_CITY'] || record['SITE_CITY'] || record['Property City'] || '',
    'Property State': record['PROP_STATE'] || record['SITE_STATE'] || record['Property State'] || '',
    'Property Zip': record['PROP_ZIP'] || record['SITE_ZIP'] || record['Property Zip'] || '',
    'Mailing Address': record['MAIL_ADDR'] || record['Mailing Address'] || '',
    'Mailing City': record['MAIL_CITY'] || record['Mailing City'] || '',
    'Mailing State': record['MAIL_STATE'] || record['Mailing State'] || '',
    'Mailing Zip': record['MAIL_ZIP'] || record['Mailing Zip'] || '',
    'County': record['COUNTY'] || record['County'] || '',
    'Apn': record['APN'] || record['Apn'] || '',
  };
}

// Classify if owner name is entity or person
export function classifyOwner(name: string): 'ENTITY' | 'PERSON' {
  const upper = name.toUpperCase();
  const entityPatterns = [
    /\bLLC\b/, /\bINC\b/, /\bCORP\b/, /\bLTD\b/, /\bLP\b/, /\bLLP\b/,
    /\bTRUST\b/, /\bESTATE\b/, /\bFOUNDATION\b/, /\bASSOC\b/,
    /\bPARTNERS\b/, /\bPARTNERSHIP\b/, /\bVENTURE\b/, /\bHOLDINGS\b/,
    /\bENTERPRISES?\b/, /\bPROPERTIES\b/, /\bDEVELOPMENT\b/,
    /\bBUILDERS\b/, /\bGROUP\b/, /\bCOMPANY\b/, /\bCO\b/,
    /\bP\/S\b/, /\bPS\b/, /\bL\.?L\.?C\.?\b/, /\bL\.?P\.?\b/,
  ];
  return entityPatterns.some(p => p.test(upper)) ? 'ENTITY' : 'PERSON';
}
