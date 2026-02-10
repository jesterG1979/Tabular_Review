import '@testing-library/jest-dom/vitest';

// Mock URL.createObjectURL and URL.revokeObjectURL for jsdom
const blobUrlMap = new Map<string, Blob>();
let blobCounter = 0;

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:http://localhost/${++blobCounter}`;
    blobUrlMap.set(url, blob);
    return url;
  };
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = (url: string) => {
    blobUrlMap.delete(url);
  };
}

// Export for test assertions
export { blobUrlMap };
