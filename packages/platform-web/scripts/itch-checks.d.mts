export const ZIP_LIMIT: number;
export const MAX_FILES: number;
export const HOOK_MARKERS: string[];
export function checkItchFiles(files: [string, Buffer][]): string[];
export function checkZipSize(bytes: number): string[];
