export interface DocumentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // Base64 string for PDF/Images, or raw text for TXT
  fileUrl?: string; // Blob URL for PDF viewing (legacy, may be invalid)
  originalFileBase64?: string; // Base64 of original file bytes for reliable PDF rendering
  originalMimeType?: string; // MIME type of the original file (e.g. 'application/pdf')
  mimeType?: string;
}

export type ColumnType = 'text' | 'number' | 'date' | 'boolean' | 'list';

export interface SmtRule {
  id: string;
  operator: 'gt' | 'lt' | 'eq' | 'neq' | 'ge' | 'le';
  value: string | number;
  description?: string;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  prompt: string;
  status: 'idle' | 'extracting' | 'completed' | 'error';
  width?: number;
  modelConfig?: {
    provider: 'consensus' | 'specific';
    modelId?: string;
  };
  smtRules?: SmtRule[];
}

export interface ExtractionCell {
  value: string;
  confidence: 'High' | 'Medium' | 'Low';
  quote: string;
  page: number;
  reasoning: string;
  // UI State for review workflow
  status?: 'verified' | 'needs_review' | 'edited' | 'disagreement' | 'validation_failed';
  consensus?: ConsensusDetail[];
  validationErrors?: string[]; // Formal logic violations
}

export interface ConsensusDetail {
  value: string;
  confidence: 'High' | 'Medium' | 'Low';
  quote: string;
  reasoning: string;
  modelId: string;
  vote: 'yes' | 'no' | 'unknown';
  page?: number;
}

export interface ExtractionResult {
  [docId: string]: {
    [colId: string]: ExtractionCell | null;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export type ViewMode = 'grid' | 'chat';
export type SidebarMode = 'none' | 'verify' | 'chat';