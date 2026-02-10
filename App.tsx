import React, { useState, useRef, useEffect } from 'react';
import { DataGrid } from './components/DataGrid';
import { VerificationSidebar } from './components/VerificationSidebar';
import { ChatInterface } from './components/ChatInterface';
import { AddColumnMenu } from './components/AddColumnMenu';
import { extractColumnData } from './services/geminiService';
import { extractColumnDataWithClaude } from './services/claudeService';
import { runConsensusExtraction } from './services/consensusService';
import { processDocumentToMarkdown } from './services/documentProcessor';
import { DocumentFile, Column, ExtractionResult, SidebarMode, ColumnType, ConsensusDetail, ExtractionCell } from './types';
import { validateDocument, DEFAULT_CONTRACT_RULES } from './services/formalLogic';
import { validateWithSMT, DEFAULT_SMT_CONSTRAINTS, convertColumnRulesToConstraints } from './services/smtValidation';
import { MessageSquare, Table, Square, FilePlus, LayoutTemplate, Trash2, Play, Download, WrapText, Loader2 } from './components/Icons';
import { SAMPLE_COLUMNS } from './utils/sampleData';

import { MODELS } from './constants/models';

const App: React.FC = () => {
  // State
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [projectName, setProjectName] = useState('Lionel DD');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

  // Start with empty columns for a clean slate
  const [columns, setColumns] = useState<Column[]>([]);
  const [results, setResults] = useState<ExtractionResult>({});

  // Sidebar State
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none');
  const [selectedCell, setSelectedCell] = useState<{ docId: string; colId: string } | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null); // For document preview without cell selection

  // Resizable Sidebar State
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Verification Sidebar Expansion State
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

  // Model State (kept for chat interface only)
  const [selectedModel] = useState<string>(MODELS[0].id);

  // Add/Edit Column Menu State
  const [addColumnAnchor, setAddColumnAnchor] = useState<DOMRect | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);

  // Extraction Control
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sims-style loading messages
  const loadingMessages = [
    'Reticulating splines...',
    'Adding hidden agendas...',
    'Adjusting bell curves...',
    'Aiming for the sun...',
    'Aligning covariance matrices...',
    'Applying feng shui shaders...',
    'Asserting packed exemplars...',
    'Attempting to lock back-buffer...',
    'Binding sapling root system...',
    'Breeding pool chairs...',
    'Building data trees...',
    'Calculating llama expectoration trajectory...',
    'Calibrating blue skies...',
    'Charging ozone layer...',
    'Coalescing cloud formations...',
    'Collecting meteor particles...',
    'Compounding inert tessellations...',
    'Computing optimal bin packing...',
    'Concatenating sub-contractors...',
    'Containing existential dread...',
    'Decomposing singular values...',
    'Destabilizing economic indicators...',
    'Determining width of Pluto...',
    'Diluting mathematics...',
    'Downloading satellite terrain data...',
    'Exposing flash variables to Javascript...',
    'Extracting resources...',
    'Filtering morale...',
    'Generating witty dialog...',
    'Graphing whale migration...',
    'Initializing robotic click-paths...',
    'Inserting sublimated messages...',
    'Integrating curves...',
    'Iterating cellular automata...',
    'Lecturing errant subsystems...',
    'Mixing genetic pool...',
    'Modeling object components...',
    'Mopping up stray texels...',
    'Normalizing power...',
    'Obfuscating Quigley matrix...',
    'Partitioning city grid singularities...',
    'Perturbing matrices...',
    'Pixelating terrain details...',
    'Polishing water highlights...',
    'Populating lot table...',
    'Preparing vectors...',
    'Prioritizing tasks...',
    'Reading legal disclaimers...',
    'Reconfiguring user mental processes...',
    'Resolving GUID conflict...',
    'Reversing time-skip unit...',
    'Routing neural network infanstructure...',
    'Scrubbing terrain...',
    'Searching for llamas...',
    'Seeding architecture simulation parameters...',
    'Sequencing particles...',
    'Setting universal constants...',
    'Sonically enhancing landscapes...',
    'Speculating Stock Market...',
    'Splatting transforms...',
    'Stratifying ground layers...',
    'Sub-sampling water data...',
    'Synthesizing gravity...',
    'Tessellating bulldozers...',
    'Time-compressing simulator clock...',
    'Unable to reveal hidden mysteries...',
    'Weathering buildings...',
    'Zeroing crime statistics...'
  ];

  // Text Wrap State
  const [isTextWrapEnabled, setIsTextWrapEnabled] = useState(false);

  // Cycle through loading messages every 3 seconds (for both converting and processing)
  useEffect(() => {
    if (isConverting || isProcessing) {
      const interval = setInterval(() => {
        const randomMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
        setLoadingMessage(randomMessage);
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [isConverting, isProcessing, loadingMessages]);

  // Handlers
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const fileList: File[] = Array.from(event.target.files);
      processUploadedFiles(fileList);
      // Reset input
      event.target.value = '';
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data URL prefix (e.g. "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const processUploadedFiles = async (fileList: File[]) => {
    // Set a random Sims-style loading message
    const randomMessage = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
    setLoadingMessage(randomMessage);
    setIsConverting(true);
    try {
      const processedFiles: DocumentFile[] = [];

      for (const file of fileList) {
        // Read original file bytes as base64 for reliable PDF viewing later
        const originalFileBase64 = await readFileAsBase64(file);

        // Use local deterministic processor (markitdown style)
        const markdownContent = await processDocumentToMarkdown(file);

        // Encode to Base64 to match our storage format (mimicking the sample data structure)
        // This keeps the rest of the app (which expects base64 strings for "content") happy
        const contentBase64 = btoa(unescape(encodeURIComponent(markdownContent)));

        // Create Blob URL for PDF viewing (legacy fallback)
        const fileUrl = URL.createObjectURL(file);

        const docId = Math.random().toString(36).substring(2, 9);
        processedFiles.push({
          id: docId,
          name: file.name,
          type: file.type,
          size: file.size,
          content: contentBase64,
          fileUrl: fileUrl,
          originalFileBase64: originalFileBase64,
          originalMimeType: file.type || 'application/pdf',
          mimeType: 'text/markdown' // Force to markdown so the viewer treats it as text
        });
      }

      setDocuments(prev => [...prev, ...processedFiles]);
    } catch (error) {
      console.error("Failed to process files:", error);
      alert("Error processing some files. Please check if they are valid PDF or DOCX documents.");
    } finally {
      setIsConverting(false);
    }
  };

  const handleLoadSample = () => {
    const sampleCols = SAMPLE_COLUMNS;

    // setDocuments([]); // Keep existing documents
    setColumns(sampleCols);
    setResults({}); // Reset results as columns have changed
    setSidebarMode('none');
    setProjectName('Lionel DD');
    setPreviewDocId(null);
    setSelectedCell(null);
  };

  const handleClearAll = () => {
    console.log('[CLEAR] Clear button clicked');

    // Only confirm if actual analysis work (results) exists.
    // If just documents are loaded, clear immediately for better UX.
    const hasWork = Object.keys(results).length > 0;
    console.log('[CLEAR] Has work:', hasWork, 'Results count:', Object.keys(results).length);

    if (hasWork && !window.confirm("Are you sure you want to clear the project? Analysis results will be lost.")) {
      console.log('[CLEAR] User cancelled');
      return;
    }

    console.log('[CLEAR] Proceeding with clear');

    // Abort processing
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);

    // Clean up file URLs
    documents.forEach((doc: DocumentFile) => {
      if (doc.fileUrl) {
        URL.revokeObjectURL(doc.fileUrl);
      }
    });

    // Reset State completely
    setDocuments([]);
    setColumns([]);
    setResults({});
    setSidebarMode('none');
    setSelectedCell(null);
    setPreviewDocId(null);
    setProjectName('Lionel DD');
    setAddColumnAnchor(null);
    setEditingColumnId(null);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    console.log('[CLEAR] Clear completed');
  };

  const handleRemoveDoc = (docId: string) => {
    const docToRemove = documents.find(d => d.id === docId);
    if (docToRemove?.fileUrl) {
      URL.revokeObjectURL(docToRemove.fileUrl);
    }

    setDocuments(prev => prev.filter(d => d.id !== docId));
    setResults(prev => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
    if (selectedCell?.docId === docId) {
      setSidebarMode('none');
      setSelectedCell(null);
    }
    if (previewDocId === docId) {
      setPreviewDocId(null);
      setSidebarMode('none');
    }
  };

  const handleCellClick = (docId: string, colId: string) => {
    // If the same cell is clicked, deselect it
    if (selectedCell?.docId === docId && selectedCell?.colId === colId) {
      setSelectedCell(null);
      setSidebarMode('none');
    } else {
      setSelectedCell({ docId, colId });
      setPreviewDocId(docId); // Always preview the document of the selected cell
      setSidebarMode('verify');
      // Auto-expand/collapse based on previous preference could go here,
      // but for now we reset or keep current?
      // Let's ensure reasonable width if we aren't expanded
      if (!isSidebarExpanded && sidebarWidth < 400) setSidebarWidth(400);
    }
  };

  const handleDocumentClick = (docId: string) => {
    // If we click the same doc, toggle off? Or maybe just keep it.
    // Let's toggle off if same, open if diff
    const next = previewDocId === docId ? null : docId;
    setPreviewDocId(next);

    if (next) {
      setSidebarMode('verify');
      setSelectedCell(null);
      if (!isSidebarExpanded && sidebarWidth < 400) setSidebarWidth(400);
    } else {
      if (selectedCell?.docId === docId) {
        setSidebarMode('none');
        setSelectedCell(null);
      }
      if (previewDocId === docId) {
        setPreviewDocId(null);
        setSidebarMode('none');
      }
    }
  };

  // Sync sidebar width with expansion state
  useEffect(() => {
    if (isSidebarExpanded) {
      if (sidebarWidth < 800) setSidebarWidth(900);
    } else {
      // When collapsing, return to narrower width if currently huge
      if (sidebarWidth > 600) setSidebarWidth(400);
    }
  }, [isSidebarExpanded, sidebarWidth]);

  // Sidebar Resize Handlers
  const startResizingSidebar = (e: React.MouseEvent) => {
    setIsSidebarResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isSidebarResizing) return;

      const newWidth = window.innerWidth - e.clientX;
      // Min width 300, Max width 80% of screen
      if (newWidth >= 300 && newWidth <= window.innerWidth * 0.8) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsSidebarResizing(false);
    };

    if (isSidebarResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarResizing, sidebarWidth]);

  const handleSaveColumn = (colDef: { name: string; type: ColumnType; prompt: string; modelConfig?: { provider: 'consensus' | 'specific'; modelId?: string }; smtRules?: any[] }) => {
    if (editingColumnId) {
      // Update existing column
      setColumns(prev => prev.map(c => c.id === editingColumnId ? { ...c, ...colDef } : c));
      setEditingColumnId(null);
    } else {
      // Create new column
      const newCol: Column = {
        id: `col_${Date.now()}`,
        name: colDef.name,
        type: colDef.type,
        prompt: colDef.prompt,
        modelConfig: colDef.modelConfig,
        smtRules: colDef.smtRules as any,
        status: 'idle',
        width: 250 // Default width
      };
      setColumns(prev => [...prev, newCol]);
    }
    setAddColumnAnchor(null);
  };

  const handleDeleteColumn = () => {
    if (editingColumnId) {
      setColumns(prev => prev.filter(c => c.id !== editingColumnId));
      // Clean up results for this column
      setResults(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(docId => {
          if (next[docId] && next[docId][editingColumnId]) {
            // We create a copy of the doc results to avoid mutation
            const docResults = { ...next[docId] };
            delete docResults[editingColumnId];
            next[docId] = docResults;
          }
        });
        return next;
      });

      if (selectedCell?.colId === editingColumnId) {
        setSelectedCell(null);
        setSidebarMode('none');
      }

      setEditingColumnId(null);
      setAddColumnAnchor(null);
    }
  };

  const handleEditColumn = (colId: string, rect: DOMRect) => {
    setEditingColumnId(colId);
    setAddColumnAnchor(rect);
  };

  const handleColumnResize = (colId: string, newWidth: number) => {
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, width: newWidth } : c));
  };

  const handleColumnReorder = (fromIndex: number, toIndex: number) => {
    setColumns(prev => {
      const newColumns = [...prev];
      const [movedColumn] = newColumns.splice(fromIndex, 1);
      newColumns.splice(toIndex, 0, movedColumn);
      return newColumns;
    });
  };

  const handleCloseMenu = () => {
    setAddColumnAnchor(null);
    setEditingColumnId(null);
  };

  const handleStopExtraction = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsProcessing(false);
    }
  };

  const handleRunAnalysis = () => {
    console.log(`[APP] Run Analysis clicked. Documents: ${documents.length}, Columns: ${columns.length}`);
    if (documents.length === 0) {
      alert('Please upload at least one document before running analysis.');
      return;
    }
    if (columns.length === 0) {
      alert('Please add at least one column before running analysis.');
      return;
    }
    processExtraction(documents, columns);
  };

  const handleExportCSV = () => {
    if (documents.length === 0) return;

    // Headers
    const headerRow = ['Document Name', ...columns.map(c => c.name)];

    // Rows
    const rows = documents.map(doc => {
      const rowData = [doc.name];
      columns.forEach(col => {
        const cell = results[doc.id]?.[col.id];
        // Escape double quotes with two double quotes
        const val = cell ? cell.value.replace(/"/g, '""') : "";
        rowData.push(`"${val}"`);
      });
      return rowData.join(",");
    });

    const csvContent = [headerRow.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${projectName.replace(/\s+/g, '_').toLowerCase()}_export.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processExtraction = async (docsToProcess: DocumentFile[], colsToProcess: Column[]) => {
    // Cancel any previous run
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Start new run
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);

    try {
      // Mark all target columns as extracting initially
      setColumns(prev => prev.map(c => colsToProcess.some(target => target.id === c.id) ? { ...c, status: 'extracting' } : c));

      // 1. Flatten all tasks: Create a list of {doc, col} pairs for every cell that needs processing
      const tasks: { doc: DocumentFile; col: Column }[] = [];

      for (const doc of docsToProcess) {
        for (const col of colsToProcess) {
          // Only add task if result doesn't exist or we want to force overwrite
          if (!results[doc.id]?.[col.id]) {
            tasks.push({ doc, col });
          }
        }
      }

      // 2. Load balance across all available models to avoid rate limits
      // Distribute tasks round-robin across all models automatically
      const availableModels = MODELS.filter(m => {
        // Only include models that have API keys configured
        if (m.provider === 'anthropic') {
          return import.meta.env.VITE_ANTHROPIC_API_KEY && import.meta.env.VITE_ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';
        } else {
          return import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.VITE_GEMINI_API_KEY !== 'your_google_api_key_here';
        }
      });

      console.log(`[APP] Load balancing across ${availableModels.length} models`);

      if (availableModels.length === 0) {
        alert("No AI models are configured! Please check your .env.local file and add VITE_ANTHROPIC_API_KEY or VITE_GEMINI_API_KEY.");
        setIsProcessing(false);
        abortControllerRef.current = null;
        setColumns(prev => prev.map(c => c.status === 'extracting' ? { ...c, status: 'idle' } : c));
        return;
      }

      const promises = tasks.map(async ({ doc, col }, index) => {
        if (controller.signal.aborted) return;

        // Stagger requests by 500ms to spread load
        if (index > 0) {
          await new Promise(resolve => setTimeout(resolve, index * 500));
        }

        if (controller.signal.aborted) return;

        try {
          // DETERMINE STRATEGY
          const useConsensus = col.modelConfig?.provider === 'consensus' || (!col.modelConfig && col.type === 'boolean');
          const specificModelId = col.modelConfig?.provider === 'specific' ? col.modelConfig.modelId : undefined;

          if (useConsensus && availableModels.length >= 1) {
            // CONSENSUS MODE
            const modelIds = availableModels.map(m => m.id);
            const mergedCell = await runConsensusExtraction(doc, col, modelIds);

            setResults(prev => ({
              ...prev,
              [doc.id]: {
                ...(prev[doc.id] || {}),
                [col.id]: mergedCell
              }
            }));

          } else {
            // SINGLE AGENT MODE
            // Determine model to use: Specific Config OR Round-Robin Default
            let modelIdToUse = specificModelId;
            if (!modelIdToUse) {
              const modelToUse = availableModels[index % availableModels.length];
              modelIdToUse = modelToUse.id;
            }

            // Find provider for the selected model ID
            const selectedModelDesc = MODELS.find(m => m.id === modelIdToUse);
            const isClaude = selectedModelDesc ? selectedModelDesc.provider === 'anthropic' : (modelIdToUse?.includes('claude') || false);

            let cell: ExtractionCell;
            try {
              if (isClaude && modelIdToUse) {
                cell = await extractColumnDataWithClaude(doc, col, modelIdToUse);
              } else if (modelIdToUse) {
                cell = await extractColumnData(doc, col, modelIdToUse);
              } else {
                throw new Error("No model selected");
              }

              // Enforce status
              cell.status = 'verified';
              if (cell.confidence === 'Low') cell.status = 'needs_review';

              setResults(prev => ({
                ...prev,
                [doc.id]: {
                  ...(prev[doc.id] || {}),
                  [col.id]: cell
                }
              }));
            } catch (error: any) {
              console.error(`Error processing ${doc.name} - ${col.name}:`, error);
              const errorMsg = error.message || String(error);
              setResults(prev => ({
                ...prev,
                [doc.id]: {
                  ...(prev[doc.id] || {}),
                  [col.id]: {
                    value: `Error: ${errorMsg.substring(0, 50)}`,
                    confidence: 'Low' as const,
                    quote: '',
                    reasoning: `Extraction failed: ${errorMsg}`,
                    status: 'error',
                    page: 0
                  }
                }
              }));
            }
          }
        } catch (e) {
          console.error(`[APP ERROR] Failed to extract ${col.name} for ${doc.name}`, e);
          // Only show alert for rate limit errors on first occurrence
          const isRateLimit = e instanceof Error && (e.message.includes('429') || e.message.includes('rate limit'));
          if (isRateLimit && index === 0) {
            alert(`Rate limit hit! The system is automatically load-balancing across multiple models and will retry.\n\nCheck console for details.`);
          }
        }
      });

      await Promise.all(promises);

      // Mark all columns as completed if finished successfully without abort
      if (!controller.signal.aborted) {
        setColumns(prev => prev.map(c => colsToProcess.some(target => target.id === c.id) ? { ...c, status: 'completed' } : c));
      }

      // Run formal logic validation on all documents
      if (!controller.signal.aborted) {
        console.log('[VALIDATION] Running formal logic validation...');

        for (const doc of docsToProcess) {
          const validationResults = validateDocument(doc.id, results, DEFAULT_CONTRACT_RULES);
          const violations = validationResults.filter(r => !r.satisfied);

          if (violations.length > 0) {
            console.log(`[VALIDATION] Document ${doc.name} has ${violations.length} violations:`, violations);

            // Mark cells with validation errors
            setResults(prev => {
              const updated = { ...prev };
              violations.forEach(violation => {
                violation.affectedColumns.forEach(colId => {
                  if (updated[doc.id]?.[colId]) {
                    updated[doc.id][colId] = {
                      ...updated[doc.id][colId]!,
                      status: violation.severity === 'error' ? 'validation_failed' : 'needs_review',
                      validationErrors: [
                        ...(updated[doc.id][colId]!.validationErrors || []),
                        violation.message
                      ]
                    };
                  }
                });
              });
              return updated;
            });
          } else {
            console.log(`[VALIDATION] Document ${doc.name} passed all validation rules ✓`);
          }
        }
      }

      // Run SMT validation on all documents (Z3 solver)
      if (!controller.signal.aborted) {
        console.log('[SMT VALIDATION] Running SMT constraint validation with Z3...');

        for (const doc of docsToProcess) {
          try {
            // Convert dynamic column rules to constraints
            const dynamicConstraints = convertColumnRulesToConstraints(columns);
            const allConstraints = [...DEFAULT_SMT_CONSTRAINTS, ...dynamicConstraints];

            const smtResults = await validateWithSMT(doc.id, results, allConstraints);
            const smtViolations = smtResults.filter(r => !r.satisfied);

            if (smtViolations.length > 0) {
              console.log(`[SMT VALIDATION] Document ${doc.name} has ${smtViolations.length} SMT violations:`, smtViolations);

              // Mark cells with SMT validation errors
              setResults(prev => {
                const updated = { ...prev };
                smtViolations.forEach(violation => {
                  violation.affectedColumns.forEach(colId => {
                    if (updated[doc.id]?.[colId]) {
                      const errorMsg = violation.explanation
                        ? `${violation.message} (${violation.explanation})`
                        : violation.message;

                      updated[doc.id][colId] = {
                        ...updated[doc.id][colId]!,
                        status: violation.severity === 'error' ? 'validation_failed' : 'needs_review',
                        validationErrors: [
                          ...(updated[doc.id][colId]!.validationErrors || []),
                          `[SMT] ${errorMsg}`
                        ]
                      };
                    }
                  });
                });
                return updated;
              });
            } else {
              console.log(`[SMT VALIDATION] Document ${doc.name} passed all SMT constraints ✓`);
            }
          } catch (error) {
            console.error(`[SMT VALIDATION] Error validating document ${doc.name}:`, error);
          }
        }
      }

    } finally {
      // If we are still the active controller (cleanup)
      if (abortControllerRef.current === controller) {
        setIsProcessing(false);
        abortControllerRef.current = null;

        // Reset extracting status if stopped early (aborted)
        setColumns(prev => prev.map(c => c.status === 'extracting' ? { ...c, status: 'idle' } : c));
      }
    }
  };



  const handleVerifyCell = () => {
    if (!selectedCell) return;
    const { docId, colId } = selectedCell;

    setResults(prev => ({
      ...prev,
      [docId]: {
        ...prev[docId],
        [colId]: {
          ...prev[docId][colId]!,
          status: 'verified'
        }
      }
    }));
  };

  const toggleChat = () => {
    if (sidebarMode === 'chat') {
      setSidebarMode('none');
    } else {
      setSidebarMode('chat');
      setSelectedCell(null);
      setPreviewDocId(null);
      setIsSidebarExpanded(false); // Chat usually is standard width
    }
  };

  // Render Helpers
  const getSidebarData = () => {
    // Priority 1: Selected Cell (Inspecting result)
    if (selectedCell) {
      return {
        cell: results[selectedCell.docId]?.[selectedCell.colId] || null,
        document: documents.find(d => d.id === selectedCell.docId) || null,
        column: columns.find(c => c.id === selectedCell.colId) || null
      };
    }
    // Priority 2: Previewed Document (Reading mode)
    if (previewDocId) {
      return {
        cell: null,
        document: documents.find(d => d.id === previewDocId) || null,
        column: null
      };
    }
    return null;
  };

  const sidebarData = getSidebarData();

  // Calculate Sidebar Width
  const getSidebarWidthClass = () => {
    if (sidebarMode === 'none') return 'w-0 translate-x-10 opacity-0 overflow-hidden';

    // Chat is fixed width
    if (sidebarMode === 'chat') return 'w-[400px] translate-x-0';

    // Verify Mode depends on expansion
    // Dynamic width now handled by state + style
    // if (isSidebarExpanded) return 'w-[900px] translate-x-0'; 
    // return 'w-[400px] translate-x-0';
    return '';
  };

  const getSidebarVisibilityClass = () => {
    if (sidebarMode === 'none') return 'translate-x-full opacity-0 pointer-events-none';
    return 'translate-x-0 opacity-100';
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        className="fixed top-0 left-0 w-0 h-0 opacity-0 pointer-events-none"
        accept=".pdf,.txt,.md,.json,.docx"
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="relative z-50 bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-lg font-bold text-slate-800 tracking-tight whitespace-nowrap">Lionel DD</h1>
            <div className="h-4 w-px bg-slate-300 mx-2 flex-shrink-0"></div>
            {isEditingProjectName ? (
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => setIsEditingProjectName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setIsEditingProjectName(false);
                }}
                className="text-sm font-medium text-slate-800 border-b border-indigo-500 outline-none bg-transparent min-w-[150px]"
                autoFocus
              />
            ) : (
              <p
                className="text-sm text-slate-500 font-medium cursor-text hover:text-slate-800 hover:bg-slate-50 px-2 py-1 rounded transition-all select-none truncate max-w-[200px] sm:max-w-[300px]"
                onDoubleClick={() => setIsEditingProjectName(true)}
                title="Double click to rename"
              >
                {projectName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Chat Button */}
            <button
              onClick={toggleChat}
              className={`flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-md transition-all active:scale-95 ${sidebarMode === 'chat'
                ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                : 'bg-white hover:bg-slate-50 text-slate-600'
                }`}
              title="AI Analyst"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
            </button>

            {/* Clear Button */}
            <button
              onClick={handleClearAll}
              className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 text-xs font-semibold rounded-md transition-all active:scale-95"
              title="Clear Project"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>

            {/* Load Sample Button */}
            <button
              onClick={handleLoadSample}
              className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-xs font-semibold rounded-md transition-all active:scale-95"
              title="Load Sample Columns"
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
              Load Sample
            </button>

            {/* Export Button */}
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-xs font-semibold rounded-md transition-all active:scale-95"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>

            {/* Text Wrap Button */}
            <button
              onClick={() => setIsTextWrapEnabled(!isTextWrapEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-md transition-all active:scale-95 ${isTextWrapEnabled
                ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                : 'bg-white hover:bg-slate-50 text-slate-600'
                }`}
              title="Toggle Text Wrap"
            >
              <WrapText className={`w-3.5 h-3.5`} />
              Wrap
            </button>

            {/* Add Document Button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                console.log("Add Doc Debug:", { isConverting, ref: fileInputRef.current });
                if (isConverting) {
                  console.warn("Conversion in progress, ignoring click");
                  return;
                }
                if (!fileInputRef.current) {
                  alert("Critical Error: File input reference is missing. Please reload.");
                  return;
                }
                try {
                  fileInputRef.current.click();
                } catch (err) {
                  alert("Error triggering file input: " + err);
                }
              }}
              disabled={isConverting}
              className={`flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-xs font-semibold rounded-md transition-all active:scale-95 ${isConverting ? 'opacity-70 cursor-wait' : ''}`}
              title="Add Documents"
            >
              {isConverting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  <span>Converting...</span>
                </>
              ) : (
                <>
                  <FilePlus className="w-3.5 h-3.5" />
                  <span>Add Document</span>
                </>
              )}
            </button>

            {/* Run / Stop Button */}
            {isProcessing ? (
              <button
                onClick={handleStopExtraction}
                className="flex items-center gap-2 px-4 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold rounded-md transition-all active:scale-95"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleRunAnalysis}
                disabled={documents.length === 0 || columns.length === 0}
                className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 text-xs font-bold rounded-md transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Run Analysis
              </button>
            )}
          </div>
        </header>

        {/* Workspace */}
        <main className="flex-1 flex overflow-hidden relative">
          {/* Conversion Overlay */}
          {isConverting && (
            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
              <div className="bg-white p-8 rounded-2xl shadow-2xl border border-indigo-100 flex flex-col items-center max-w-md text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-75"></div>
                  <div className="relative bg-indigo-50 p-4 rounded-full">
                    <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Converting Documents</h3>
                <p className="text-slate-500 mb-4">Using local Docling engine to preserve formatting and structure...</p>
                <p className="text-sm text-indigo-600 font-mono italic">{loadingMessage}</p>
              </div>
            </div>
          )}

          {/* Processing Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
              <div className="bg-white p-8 rounded-2xl shadow-2xl border border-emerald-100 flex flex-col items-center max-w-md text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-emerald-100 rounded-full animate-ping opacity-75"></div>
                  <div className="relative bg-emerald-50 p-4 rounded-full">
                    <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Running LLM Analysis</h3>
                <p className="text-slate-500 mb-4">Extracting data from documents using AI models...</p>
                <p className="text-sm text-emerald-600 font-mono italic">{loadingMessage}</p>
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0 bg-white">
            <DataGrid
              documents={documents}
              columns={columns}
              results={results}
              onAddColumn={(rect) => setAddColumnAnchor(rect)}
              onEditColumn={handleEditColumn}
              onColumnResize={handleColumnResize}
              onColumnReorder={handleColumnReorder}
              onCellClick={handleCellClick}
              onDocClick={handleDocumentClick}
              onRemoveDoc={handleRemoveDoc}
              selectedCell={selectedCell}
              isTextWrapEnabled={isTextWrapEnabled}
              onDropFiles={(files) => processUploadedFiles(files)}
            />
          </div>

          {/* Add/Edit Column Menu */}
          {addColumnAnchor && (
            <AddColumnMenu
              triggerRect={addColumnAnchor}
              onClose={handleCloseMenu}
              onSave={handleSaveColumn}
              onDelete={handleDeleteColumn}
              modelId={selectedModel}
              initialData={editingColumnId ? columns.find(c => c.id === editingColumnId) : undefined}
            />
          )}

          {/* Right Sidebar Container (Resizable) */}
          <div
            className={`flex-shrink-0 border-l border-slate-200 bg-white shadow-xl z-30 relative ${isSidebarResizing ? '' : 'transition-all duration-300 ease-in-out'} ${getSidebarVisibilityClass()}`}
            style={{ width: sidebarMode === 'none' ? 0 : sidebarWidth }}
          >
            {/* Drag Handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-indigo-300 transition-colors z-40 group"
              onMouseDown={startResizingSidebar}
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-16 w-1 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity mx-auto right-0" />
            </div>

            <div className="w-full h-full absolute right-0 top-0 flex flex-col overflow-hidden">
              {sidebarMode === 'verify' && sidebarData && (
                <VerificationSidebar
                  cell={sidebarData.cell}
                  document={sidebarData.document}
                  column={sidebarData.column}
                  onClose={() => { setSidebarMode('none'); setSelectedCell(null); setPreviewDocId(null); }}
                  onVerify={handleVerifyCell}
                  isExpanded={isSidebarExpanded}
                  onExpand={setIsSidebarExpanded}
                />
              )}
              {sidebarMode === 'chat' && (
                <ChatInterface
                  documents={documents}
                  columns={columns}
                  results={results}
                  onClose={() => setSidebarMode('none')}
                  modelId={selectedModel}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;