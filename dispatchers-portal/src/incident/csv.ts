import { validateRider, type RiderImport } from "../../../shared/incident";
export type CsvPreview = { riders: RiderImport[]; errors: string[] };

// RFC 4180 fields, including quoted commas, escaped quotes and embedded newlines.
function records(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const push = () => { row.push(field); field = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("A quote must begin a field");
      quoted = true;
    } else if (c === ',') push();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push(); if (row.some(v => v.trim())) rows.push(row); row = [];
    } else {
      if (closed && c.trim()) throw new Error("Unexpected text after a closing quote");
      if (!closed) field += c;
    }
  }
  if (quoted) throw new Error("A quoted field is not closed");
  push(); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

export function previewRidersCsv(text: string): CsvPreview {
  try {
    if (new TextEncoder().encode(text).length > 1_000_000) throw new Error("CSV limit is 1 MB");
    const [header, ...data] = records(text.replace(/^\uFEFF/, ""));
    if (!header || !data.length) throw new Error("Include a header and at least one rider");
    if (data.length > 2000) throw new Error("Import at most 2,000 riders at a time");
    const keys = header.map(h => h.trim().toLowerCase().replace(/[ _-]/g, ""));
    if (new Set(keys).size !== keys.length) throw new Error("CSV headers must be unique");
    for (const required of ["riderid", "name", "address", "lat", "lng", "phone"]) if (!keys.includes(required)) throw new Error(`Missing column: ${required}`);
    const riders: RiderImport[] = [], errors: string[] = [], ids = new Set<string>();
    for (const [index, columns] of data.entries()) {
      try {
        if (columns.length !== keys.length) throw new Error("Column count does not match the header");
        const get = (key: string) => columns[keys.indexOf(key)]?.trim() ?? "";
        const number = (key: string) => { if (!get(key)) throw new Error(`${key} is required`); return Number(get(key)); };
        const oxygen = get("oxygen").toLowerCase();
        if (oxygen && !["true", "false", "yes", "no", "1", "0"].includes(oxygen)) throw new Error("Oxygen must be true/false, yes/no or 1/0");
        const row: RiderImport = { riderId: get("riderid"), name: get("name"), address: get("address"), lat: number("lat"), lng: number("lng"), phone: get("phone"),
          language: get("language") || "en", mobility: get("mobility") || "walks", assistance: get("assistance") || "none",
          people: get("people") ? Number(get("people")) : undefined, oxygen: oxygen ? ["true", "yes", "1"].includes(oxygen) : undefined,
          needProbability: get("needprobability") ? Number(get("needprobability")) : undefined };
        validateRider(row);
        if (ids.has(row.riderId)) throw new Error(`Duplicate rider ID: ${row.riderId}`);
        ids.add(row.riderId); riders.push(row);
      } catch (error) { errors.push(`Row ${index + 2}: ${(error as Error).message}`); }
    }
    return { riders, errors };
  } catch (error) { return { riders: [], errors: [(error as Error).message] }; }
}

export const RIDER_CSV_EXAMPLE = 'rider_id,name,address,lat,lng,phone,language,mobility,assistance,people,oxygen\nincident-demo-1,Demo resident,"502 Montrose, Houston TX 77019",29.76123664,-95.39271099,+18325550100,en,wheelchair,one_person,2,false\n';
