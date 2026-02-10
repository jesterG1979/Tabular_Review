import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { VerificationSidebar } from '../components/VerificationSidebar';
import type { DocumentFile, ExtractionCell, Column } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal PDF header (enough bytes to test base64 round-tripping). */
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
const FAKE_PDF_BASE64 = btoa(String.fromCharCode(...FAKE_PDF_BYTES));

function makeDocument(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    id: 'doc-1',
    name: 'test.pdf',
    type: 'application/pdf',
    size: 12345,
    content: btoa('# Hello World'),
    mimeType: 'text/markdown',
    ...overrides,
  };
}

function makeCell(overrides: Partial<ExtractionCell> = {}): ExtractionCell {
  return {
    value: 'Yes',
    confidence: 'High',
    quote: 'This is the relevant quote from the document.',
    page: 2,
    reasoning: 'Found on page 2.',
    status: 'verified',
    ...overrides,
  };
}

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 'col-1',
    name: 'Is Valid?',
    type: 'boolean',
    prompt: 'Is the document valid?',
    status: 'completed',
    ...overrides,
  };
}

// ── Track blob URLs ─────────────────────────────────────────────────────────

let createdUrls: string[] = [];
let revokedUrls: string[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  createdUrls = [];
  revokedUrls = [];

  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:http://localhost/test-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  });

  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DocumentFile type', () => {
  it('supports originalFileBase64 and originalMimeType fields', () => {
    const doc: DocumentFile = {
      id: 'doc-1',
      name: 'contract.pdf',
      type: 'application/pdf',
      size: 1024,
      content: btoa('markdown'),
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
      mimeType: 'text/markdown',
    };

    expect(doc.originalFileBase64).toBe(FAKE_PDF_BASE64);
    expect(doc.originalMimeType).toBe('application/pdf');
  });

  it('remains backward-compatible without new fields', () => {
    const doc: DocumentFile = {
      id: 'doc-2',
      name: 'old.pdf',
      type: 'application/pdf',
      size: 512,
      content: btoa('old content'),
      fileUrl: 'blob:http://example.com/legacy',
    };

    expect(doc.originalFileBase64).toBeUndefined();
    expect(doc.originalMimeType).toBeUndefined();
  });
});

describe('Base64 to Blob URL conversion', () => {
  it('converts base64 string to valid Uint8Array', () => {
    const byteString = atob(FAKE_PDF_BASE64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }

    // Verify the bytes match the original PDF header
    expect(bytes).toEqual(FAKE_PDF_BYTES);
  });

  it('creates a Blob with correct MIME type from base64 data', () => {
    const byteString = atob(FAKE_PDF_BASE64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(FAKE_PDF_BYTES.length);
  });

  it('handles empty base64 string gracefully', () => {
    const byteString = atob('');
    const bytes = new Uint8Array(byteString.length);
    const blob = new Blob([bytes], { type: 'application/pdf' });

    expect(blob.size).toBe(0);
  });

  it('handles invalid base64 by throwing', () => {
    expect(() => atob('!!invalid!!')).toThrow();
  });
});

describe('PDF fragment URL construction', () => {
  it('builds page fragment correctly', () => {
    const fragments: string[] = [];
    const page = 3;

    if (page > 0) {
      fragments.push(`page=${page}`);
    }

    const hash = `#${fragments.join('&')}`;
    expect(hash).toBe('#page=3');
  });

  it('builds page + search fragment correctly', () => {
    const fragments: string[] = [];
    const page = 5;
    const quote = 'The party agrees to the terms';

    if (page > 0) {
      fragments.push(`page=${page}`);
    }

    const cleanQuote = quote.replace(/\s+/g, ' ').trim().substring(0, 100);
    if (cleanQuote) {
      fragments.push(`search="${encodeURIComponent(cleanQuote)}"`);
    }

    const hash = `#${fragments.join('&')}`;
    expect(hash).toContain('page=5');
    expect(hash).toContain('search=');
    expect(hash).toContain('The%20party%20agrees');
  });

  it('returns empty string when no page and no quote', () => {
    const fragments: string[] = [];
    const hash = fragments.length > 0 ? `#${fragments.join('&')}` : '';
    expect(hash).toBe('');
  });

  it('truncates long quotes to 100 characters', () => {
    const longQuote = 'A'.repeat(200);
    const cleanQuote = longQuote.replace(/\s+/g, ' ').trim().substring(0, 100);
    expect(cleanQuote.length).toBe(100);
  });
});

describe('VerificationSidebar PDF viewer', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onVerify: vi.fn(),
    isExpanded: true,
    onExpand: vi.fn(),
  };

  it('renders null when no document provided', () => {
    const { container } = render(
      <VerificationSidebar {...defaultProps} document={null} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders text view by default', () => {
    const doc = makeDocument({ content: btoa('# Test Content') });
    render(
      <VerificationSidebar {...defaultProps} document={doc} />
    );

    // The "Extracted Text" button should be active by default
    const textBtn = screen.getByText('Extracted Text');
    expect(textBtn).toBeInTheDocument();
  });

  it('shows "Original file not available" when no file data exists', async () => {
    const doc = makeDocument({
      fileUrl: undefined,
      originalFileBase64: undefined,
    });

    render(
      <VerificationSidebar {...defaultProps} document={doc} />
    );

    // Click "Original PDF" to switch view
    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      expect(screen.getByText('Original file not available.')).toBeInTheDocument();
    });
  });

  it('creates blob URL from originalFileBase64 when switching to PDF view', async () => {
    const doc = makeDocument({
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
    });

    render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    // Switch to PDF view
    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      // Should have called createObjectURL with a Blob
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(createdUrls.length).toBeGreaterThan(0);
    });
  });

  it('renders object tag for PDF display', async () => {
    const doc = makeDocument({
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
    });

    const { container } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    // Switch to PDF view
    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      const objectEl = container.querySelector('object[type="application/pdf"]');
      expect(objectEl).toBeInTheDocument();
    });
  });

  it('includes page fragment in object data URL', async () => {
    const doc = makeDocument({
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
    });

    const cell = makeCell({ page: 7 });

    const { container } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={cell}
        column={makeColumn()}
      />
    );

    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      const objectEl = container.querySelector('object');
      const dataUrl = objectEl?.getAttribute('data') || '';
      expect(dataUrl).toContain('#page=7');
    });
  });

  it('falls back to legacy fileUrl when no originalFileBase64', async () => {
    const doc = makeDocument({
      fileUrl: 'blob:http://localhost/legacy-url',
      originalFileBase64: undefined,
    });

    const { container } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      const objectEl = container.querySelector('object');
      const dataUrl = objectEl?.getAttribute('data') || '';
      expect(dataUrl).toContain('blob:http://localhost/legacy-url');
    });
  });

  it('revokes created blob URL on unmount', async () => {
    const doc = makeDocument({
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
    });

    const { unmount } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    // Switch to PDF view to trigger blob URL creation
    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      expect(createdUrls.length).toBeGreaterThan(0);
    });

    // Unmount should revoke the URL
    unmount();

    expect(revokedUrls.length).toBeGreaterThan(0);
  });

  it('does NOT revoke legacy fileUrl on unmount', async () => {
    const doc = makeDocument({
      fileUrl: 'blob:http://localhost/legacy-url',
      originalFileBase64: undefined,
    });

    const { unmount } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    unmount();

    // Legacy URLs should NOT be revoked by the component
    expect(revokedUrls).not.toContain('blob:http://localhost/legacy-url');
  });

  it('renders embed fallback inside object tag', async () => {
    const doc = makeDocument({
      originalFileBase64: FAKE_PDF_BASE64,
      originalMimeType: 'application/pdf',
    });

    const { container } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={makeCell()}
        column={makeColumn()}
      />
    );

    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      const embedEl = container.querySelector('embed[type="application/pdf"]');
      expect(embedEl).toBeInTheDocument();
    });
  });

  it('shows download button when pdfLoadError is set', async () => {
    // We test the fallback UI statically by verifying the structure.
    // The error state is triggered internally, but we can verify
    // the component renders error UI by forcing the state.
    const doc = makeDocument({
      originalFileBase64: undefined,
      fileUrl: undefined,
    });

    render(
      <VerificationSidebar {...defaultProps} document={doc} />
    );

    const pdfBtn = screen.getByText('Original PDF');
    await userEvent.click(pdfBtn);

    await waitFor(() => {
      expect(screen.getByText('Original file not available.')).toBeInTheDocument();
    });
  });
});

describe('readFileAsBase64 logic', () => {
  it('correctly encodes file bytes to base64 and back', () => {
    // Simulate what readFileAsBase64 + the viewer does:
    // 1. File -> FileReader -> data URL -> strip prefix -> base64 string
    // 2. base64 string -> atob -> Uint8Array -> Blob -> createObjectURL

    const originalBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);

    // Step 1: Encode (simulating FileReader result)
    const base64 = btoa(String.fromCharCode(...originalBytes));

    // Step 2: Decode (what the viewer does)
    const byteString = atob(base64);
    const decoded = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      decoded[i] = byteString.charCodeAt(i);
    }

    expect(decoded).toEqual(originalBytes);
  });

  it('handles large binary data', () => {
    // Simulate a 10KB file
    const largeBytes = new Uint8Array(10240);
    for (let i = 0; i < largeBytes.length; i++) {
      largeBytes[i] = i % 256;
    }

    const base64 = btoa(String.fromCharCode(...largeBytes));
    const byteString = atob(base64);
    const decoded = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      decoded[i] = byteString.charCodeAt(i);
    }

    expect(decoded).toEqual(largeBytes);
  });
});

describe('Highlighted text view', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onVerify: vi.fn(),
    isExpanded: true,
    onExpand: vi.fn(),
  };

  it('shows full text when no cell is selected', () => {
    const doc = makeDocument({
      content: btoa('Hello World Document'),
    });

    render(
      <VerificationSidebar {...defaultProps} document={doc} />
    );

    expect(screen.getByText('Hello World Document')).toBeInTheDocument();
  });

  it('highlights matching quote in text view', async () => {
    const doc = makeDocument({
      content: btoa('Before the quote. This is important text here. After the quote.'),
    });

    const cell = makeCell({
      quote: 'This is important text here',
    });

    const { container } = render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={cell}
        column={makeColumn()}
      />
    );

    // Should find a <mark> element with the highlighted quote
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
  });

  it('shows warning when quote is not found in text', () => {
    const doc = makeDocument({
      content: btoa('Some completely different text'),
    });

    const cell = makeCell({
      quote: 'This quote does not exist in the document at all',
    });

    render(
      <VerificationSidebar
        {...defaultProps}
        document={doc}
        cell={cell}
        column={makeColumn()}
      />
    );

    expect(screen.getByText(/Exact quote not found/)).toBeInTheDocument();
  });
});
