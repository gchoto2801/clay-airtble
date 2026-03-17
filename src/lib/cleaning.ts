// Data cleaning utilities for the skip trace pipeline

export function stripLinks(s: string): string {
  if (!s) return '';
  return s
    .replace(/<tel:[^|]*\|([^>]*)>/g, '$1')
    .replace(/<mailto:[^|]*\|([^>]*)>/g, '$1')
    .replace(/<https?:[^|]*\|([^>]*)>/g, '$1')
    .replace(/<[^>]+>/g, '');
}

export function cleanPhone(raw: string): string {
  if (!raw) return '';
  raw = stripLinks(raw);
  const phones: string[] = [];
  for (const p of raw.split(/[,;\/&]+|\band\b/i)) {
    const digits = p.replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      const clean = (digits.length === 11 && digits[0] === '1')
        ? '+' + digits
        : '+1' + digits.slice(-10);
      if (!phones.includes(clean)) phones.push(clean);
    }
  }
  return phones[0] || '';
}

export function extractAllPhones(...fields: string[]): string[] {
  const phones: string[] = [];
  for (const raw of fields) {
    if (!raw) continue;
    const cleaned = stripLinks(raw);
    for (const p of cleaned.split(/[,;\/&]+|\band\b/i)) {
      const digits = p.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        const clean = (digits.length === 11 && digits[0] === '1')
          ? '+' + digits
          : '+1' + digits.slice(-10);
        if (!phones.includes(clean)) phones.push(clean);
      }
    }
  }
  return phones;
}

export function extractAllEmails(...fields: string[]): string[] {
  const emails: string[] = [];
  for (const raw of fields) {
    if (!raw) continue;
    const cleaned = stripLinks(raw);
    for (const p of cleaned.split(/[,;\s|]+/)) {
      const e = p.trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        if (!emails.includes(e)) emails.push(e);
      }
    }
  }
  return emails;
}

export function extractNames(raw: string): string[] {
  if (!raw) return [];
  const clean = raw.replace(/\([^)]*\)/g, '').trim();
  const parts = clean.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const suffixes = ['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'esq'];
  const names: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (suffixes.includes(part.toLowerCase().replace(/\./g, ''))) {
      cur += ', ' + part;
    } else {
      if (cur) names.push(cur);
      cur = part;
    }
  }
  if (cur) names.push(cur);
  return names;
}

function pick(record: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = (record[k] || '').toString().trim();
    if (v && v !== 'Response') return stripLinks(v);
  }
  return '';
}

export interface CleanedRecord {
  ownerName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  mailingAddress: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  county: string;
  apn: string;
  primaryContact: string;
  contactName2: string;
  contactName3: string;
  agentName: string;
  phone1: string;
  phone2: string;
  phone3: string;
  email1: string;
  email2: string;
  email3: string;
  entityStatus: string;
  filingNumber: string;
  formationDate: string;
  allNames: string;
  classification: 'found' | 'reiskip';
}

export function cleanRecord(raw: Record<string, string>): CleanedRecord {
  const allPhones = extractAllPhones(
    pick(raw, 'Contact_Phone', 'Contact Phone'),
    pick(raw, 'Contact_Phone_2', 'Contact Phone 2', 'Contact Phone (2)'),
    pick(raw, 'Skip_Trace_Results_contact_Phone', 'Skip Trace Results contact Phone')
  );

  const allEmails = extractAllEmails(
    pick(raw, 'Contact_Email', 'Contact Email'),
    pick(raw, 'Contact_Email_2', 'Contact Email 2', 'Contact Email (2)'),
    pick(raw, 'Skip_Trace_Results_contact_Email', 'Skip Trace Results contact Email')
  );

  const officerNames = extractNames(
    pick(raw, 'SOS_Business_Entity_Data_officer_Names', 'SOS Business Entity Data officer Names') +
    '; ' +
    pick(raw, 'Skip_Trace_Results_officer_Names', 'Skip Trace Results officer Names')
  );

  const agentName = pick(
    raw,
    'SOS_Business_Entity_Data_agent_Name', 'SOS Business Entity Data agent Name',
    'Skip_Trace_Results_agent_Name', 'Skip Trace Results agent Name'
  );

  const extras = [
    pick(raw, 'Extra_0', '0'),
    pick(raw, 'Extra_1', '1'),
    pick(raw, 'Extra_2', '2')
  ].filter(Boolean);

  const allNames = [...new Set([...officerNames, agentName, ...extras].filter(Boolean))];
  // "Found" = has at least 1 phone OR 1 email (just having names isn't enough for skip trace)
  const found = !!(allPhones.length || allEmails.length);

  return {
    ownerName: pick(raw, 'Owner_Name', 'Owner Name', 'OWNER_NAME_1'),
    propertyAddress: pick(raw, 'Property_Address', 'Property Address', 'PROP_ADDRESS', 'SITE_ADDR'),
    propertyCity: pick(raw, 'Property_City', 'Property City', 'PROP_CITY', 'SITE_CITY'),
    propertyState: pick(raw, 'Property_State', 'Property State', 'PROP_STATE', 'SITE_STATE'),
    propertyZip: pick(raw, 'Property_Zip', 'Property Zip', 'PROP_ZIP', 'SITE_ZIP'),
    mailingAddress: pick(raw, 'Mailing_Address', 'Mailing Address', 'MAIL_ADDR'),
    mailingCity: pick(raw, 'Mailing_City', 'Mailing City', 'MAIL_CITY'),
    mailingState: pick(raw, 'Mailing_State', 'Mailing State', 'MAIL_STATE'),
    mailingZip: pick(raw, 'Mailing_Zip', 'Mailing Zip', 'MAIL_ZIP'),
    county: pick(raw, 'County', 'COUNTY'),
    apn: pick(raw, 'Apn', 'APN'),
    primaryContact: allNames[0] || '',
    contactName2: allNames[1] || '',
    contactName3: allNames[2] || '',
    agentName,
    phone1: allPhones[0] || '',
    phone2: allPhones[1] || '',
    phone3: allPhones[2] || '',
    email1: allEmails[0] || '',
    email2: allEmails[1] || '',
    email3: allEmails[2] || '',
    entityStatus: pick(raw, 'Skip_Trace_Results_entity_Status', 'Skip Trace Results entity Status'),
    filingNumber: pick(raw, 'Skip_Trace_Results_filing_Number', 'Skip Trace Results filing Number'),
    formationDate: pick(raw, 'Skip_Trace_Results_formation_Date', 'Skip Trace Results formation Date'),
    allNames: allNames.join('; '),
    classification: found ? 'found' : 'reiskip',
  };
}
