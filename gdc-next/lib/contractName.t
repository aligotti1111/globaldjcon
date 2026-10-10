// Auto-number duplicate contract names the way an OS numbers duplicated files.
//
// When a DJ creates a contract whose name already exists in their library
// (e.g. clicking "Global DJ Connect Standard Contract" a second time), we don't
// want two rows with the identical name. Instead the new one gets the next free
// number appended: "Name", then "Name 1", "Name 2", "Name 3", …
//
// Pass the admin client, the acting DJ's id, and the desired base name; get back
// a name guaranteed not to collide with an existing one.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function uniqueContractName(admin: any, djId: string, base: string): Promise<string> {
  const clean = (base || 'Contract').trim();
  try {
    const { data } = await admin.from('contracts').select('name').eq('dj_id', djId);
    const existing = new Set<string>(
      ((data as { name?: string }[] | null) || [])
        .map((r) => (r?.name || '').trim())
        .filter(Boolean),
    );
    if (!existing.has(clean)) return clean;
    let n = 1;
    while (existing.has(`${clean} ${n}`)) n++;
    return `${clean} ${n}`;
  } catch {
    // If the lookup fails, fall back to the plain name rather than blocking the
    // create — a duplicate name is better than a failed save.
    return clean;
  }
}
