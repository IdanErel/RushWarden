export function listFiles(dir: string): [string, string][];
export function zipEntries(entries: [string, Buffer][]): Buffer;
export function zipDirectory(dir: string): Buffer;
export function readZip(zip: Buffer): [string, Buffer][];
