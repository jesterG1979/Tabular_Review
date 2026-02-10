import React, { useEffect, useState, useRef } from 'react';
import { X, FileText, AlertCircle, Users, Check, ShieldAlert } from './Icons';
import { ExtractionCell, DocumentFile, Column } from '../types';

interface VerificationSidebarProps {
    cell?: ExtractionCell | null;
    document: DocumentFile | null;
    column?: Column | null;
    onClose: () => void;
    onVerify?: () => void;
    isExpanded: boolean;
    onExpand: (expanded: boolean) => void;
}

export const VerificationSidebar: React.FC<VerificationSidebarProps> = ({
    cell,
    document,
    column,
    onClose,
    isExpanded,
    onExpand,
    onVerify
}) => {
    const [decodedContent, setDecodedContent] = useState<string>('');
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (document) {
            // Decode Base64 content (which is now always Markdown/Text from App.tsx)
            try {
                const cleanContent = document.content.replace(/^data:.*;base64,/, '');
                const binaryString = atob(cleanContent);
                try {
                    // Handle UTF-8 characters properly
                    const decoded = decodeURIComponent(escape(binaryString));
                    setDecodedContent(decoded);
                } catch (e) {
                    // Fallback for simple ASCII or already decoded parts
                    setDecodedContent(binaryString);
                }
            } catch (e) {
                console.error("Decoding error", e);
                setDecodedContent("Unable to display document content.");
            }
        }
    }, [document]);

    // Auto-scroll to highlighted text when expanded or cell changes
    useEffect(() => {
        if (isExpanded && cell?.quote) {
            // Small timeout to ensure DOM is rendered
            const timer = setTimeout(() => {
                if (scrollContainerRef.current) {
                    const mark = scrollContainerRef.current.querySelector('mark');
                    if (mark) {
                        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isExpanded, cell, decodedContent]);

    const handleCitationClick = () => {
        onExpand(true);
        if (cell?.page && cell.page > 0) {
            setViewMode('pdf');
        } else {
            setViewMode('text');
        }
    };

    // Helper to render text with highlight (HTML/TXT)
    const renderHighlightedContent = () => {
        if (!cell || !cell.quote || !decodedContent) {
            return <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{decodedContent}</div>;
        }

        const quote = cell.quote.trim();
        if (!quote) return <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{decodedContent}</div>;

        // Robust Fuzzy Matcher
        // 1. Escape regex characters in the quote
        const escapedQuote = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 2. Replace whitespace with a flexible pattern that matches:
        //    - spaces
        //    - newlines
        //    - common markdown characters that might appear in source but not quote (like **, _, #)
        const loosePattern = escapedQuote.replace(/\s+/g, '[\\s\\W]*');

        // 3. Create regex with capturing group to split and keep delimiters
        const looseQuoteRegex = new RegExp(`(${loosePattern})`, 'gi');

        const parts = decodedContent.split(looseQuoteRegex);

        if (parts.length === 1) {
            return (
                <div className="relative">
                    <div className="bg-red-50 border border-red-200 rounded p-2 mb-4 text-xs text-red-700 flex items-center gap-2 sticky top-0 z-10">
                        <AlertCircle className="w-3 h-3" />
                        Exact quote not found. Showing full text.
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{decodedContent}</div>
                </div>
            );
        }

        return (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {parts.map((part, i) => {
                    // Check if this part matches the loose pattern
                    // Since we split by capturing group, matches will be at odd indices (1, 3, 5...)
                    // IF the first part is empty (match at start), then matches are 1, 3...
                    // IF the first part is text, matches are 1, 3...
                    // Basically, split(regexWithCapture) returns [pre, match, post]
                    const isMatch = looseQuoteRegex.test(part);
                    // Reset regex lastIndex because test() advances it if global
                    looseQuoteRegex.lastIndex = 0;

                    if (isMatch) {
                        return (
                            <mark key={i} className="bg-yellow-200 text-slate-900 px-0.5 rounded-sm border-b-2 border-yellow-400 font-medium">
                                {part}
                            </mark>
                        );
                    }
                    return <React.Fragment key={i}>{part}</React.Fragment>;
                })}
            </div>
        );
    };

    const [viewMode, setViewMode] = useState<'text' | 'pdf'>('text');

    // Internal Resizing State
    const [panelWidth, setPanelWidth] = useState(400);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            // Calculate new width based on mouse X relative to... 
            // Actually simpler: The panel is on the left.
            // But this component is inside a right-aligned sidebar.
            // Wait, the structure is [Analyst Panel] [Document Panel].
            // If the whole sidebar is width W.
            // Analyst Panel width is set. Document Panel is flex-1.
            // Mouse X is global.
            // We need to find the left edge of the sidebar or just use movement delta?
            // Delta is safer.
            // Or better: The width is `e.clientX - sidebarLeft`. 
            // Actually, since the sidebar is right-aligned, let's look at the implementation.
            // In App.tsx sidebar is flex row.
            // VerificationSidebar is flex row.
            // Left Panel is the one we are resizing.
            // Its width increases as we drag RIGHT.

            // However, the `e.movementX` approach is easiest.
            setPanelWidth(prev => {
                const newWidth = prev + e.movementX;
                if (newWidth < 300) return 300;
                if (newWidth > 800) return 800;
                return newWidth;
            });
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const renderAnswerPanel = () => (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                        <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                            {cell ? 'Analyst Review' : 'Document Preview'}
                        </span>
                        <span className="text-sm font-semibold text-slate-900 truncate max-w-[200px]" title={document?.name}>
                            {document?.name}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* View Toggle */}
            <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex justify-center">
                <div className="bg-slate-200 p-1 rounded-lg flex items-center gap-1">
                    <button
                        onClick={() => { setViewMode('text'); onExpand(true); }}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'text' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Extracted Text
                    </button>
                    <button
                        onClick={() => { setViewMode('pdf'); onExpand(true); }}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'pdf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Original PDF
                    </button>
                </div>
            </div>

            {/* Body */}
            {cell && column ? (
                <div className="p-6 flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between mb-6">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded">
                            {column.name}
                        </span>
                        {/* Status Badges */}
                        <div className="flex gap-2">
                            {cell.status === 'validation_failed' && (
                                <span className="text-[10px] px-2.5 py-1 rounded-full font-bold border bg-red-50 text-red-700 border-red-200 flex items-center gap-1">
                                    <ShieldAlert className="w-3 h-3" /> Logic Error
                                </span>
                            )}
                            {cell.status === 'verified' && (
                                <span className="text-[10px] px-2.5 py-1 rounded-full font-bold border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
                                    <Check className="w-3 h-3" /> Verified
                                </span>
                            )}
                            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${cell.confidence === 'High' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                cell.confidence === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                    'bg-red-50 text-red-700 border-red-200'
                                }`}>
                                {cell.confidence} Confidence
                            </span>
                        </div>
                    </div>

                    <div className="mb-8">
                        <div className="text-lg text-slate-900 leading-relaxed font-medium">
                            {cell.value}
                        </div>
                    </div>

                    {/* Validation Errors Section */}
                    {cell.validationErrors && cell.validationErrors.length > 0 && (
                        <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-red-100 border-b border-red-200 flex items-center gap-2">
                                <ShieldAlert className="w-4 h-4 text-red-600" />
                                <span className="text-xs font-bold text-red-900 uppercase tracking-wider">Formal Logic Violations</span>
                            </div>
                            <div className="p-4 space-y-2">
                                {cell.validationErrors.map((error, idx) => (
                                    <div key={idx} className="text-sm text-red-800 flex items-start gap-2">
                                        <span className="text-red-500 font-bold">•</span>
                                        <span>{error}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Consensus Review Section */}
                    {cell.consensus && cell.consensus.length > 0 && (
                        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-200 bg-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4 text-indigo-600" />
                                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Review Consensus</span>
                                </div>
                                {cell.status === 'disagreement' && (
                                    <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                                        Disagreement
                                    </span>
                                )}
                            </div>
                            <div className="p-4 space-y-4">
                                {/* Vote Summary */}
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="font-medium text-slate-600">Votes:</span>
                                    <div className="flex gap-4">
                                        {['yes', 'no', 'unknown'].map(voteType => {
                                            const count = cell.consensus?.filter(c => c.vote === voteType).length || 0;
                                            if (count === 0) return null;
                                            return (
                                                <span key={voteType} className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${voteType === 'yes' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    voteType === 'no' ? 'bg-red-50 text-red-700 border-red-200' :
                                                        'bg-slate-50 text-slate-600 border-slate-200'
                                                    }`}>
                                                    {count} {voteType}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Detailed Consensus List */}
                                <div className="space-y-3">
                                    {cell.consensus.map((c, idx) => (
                                        <div key={idx} className="text-xs bg-white p-2 rounded border border-slate-100 shadow-sm">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-semibold text-slate-700">{c.modelId}</span>
                                                <span className={`uppercase font-bold ${c.vote === 'yes' ? 'text-emerald-600' : c.vote === 'no' ? 'text-red-600' : 'text-slate-400'
                                                    }`}>{c.value}</span>
                                            </div>
                                            <p className="text-slate-600 italic">"{c.reasoning}"</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Resolution Actions */}
                                {cell.status === 'disagreement' && onVerify && (
                                    <div className="flex gap-2 pt-2">
                                        <button
                                            onClick={() => {
                                                // We need a way to override value. For now, we assume this sets verified status
                                                // Ideally we pass value back to onVerify
                                                // Since onVerify signature is void, we might need to update that later.
                                                // For now, let's just use onVerify for confirmation.
                                                onVerify();
                                            }}
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded transition-colors"
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                            Confirm {cell.value}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">AI Reasoning</h4>
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <p className="text-sm text-slate-600 leading-relaxed inline">
                                    {cell.reasoning}
                                </p>

                                {/* Inline Citation Chip */}
                                {cell.quote && (
                                    <button
                                        onClick={handleCitationClick}
                                        className="inline-flex items-center justify-center ml-1.5 align-middle px-1.5 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-[10px] font-bold rounded cursor-pointer border border-indigo-200 hover:border-indigo-300 transition-all transform active:scale-95"
                                        title="View in Document"
                                    >
                                        {cell.page ? `p.${cell.page}` : 'Src'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="p-6 flex flex-col items-center justify-center flex-1 text-center">
                    <FileText className="w-12 h-12 text-slate-200 mb-4" />
                    <p className="text-sm text-slate-500">Document Preview Mode</p>
                    {!isExpanded && (
                        <button onClick={() => onExpand(true)} className="mt-4 text-indigo-600 text-xs font-bold hover:underline">
                            Open Document Viewer
                        </button>
                    )}
                </div>
            )}
        </div>
    );

    // Create a stable blob URL from stored base64 data for reliable PDF rendering
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfLoadError, setPdfLoadError] = useState(false);

    useEffect(() => {
        if (viewMode !== 'pdf' || !document) {
            return;
        }

        setPdfLoadError(false);
        let url: string | null = null;

        if (document.originalFileBase64) {
            // Create blob URL from stored base64 data (reliable, doesn't depend on File reference)
            try {
                const byteString = atob(document.originalFileBase64);
                const bytes = new Uint8Array(byteString.length);
                for (let i = 0; i < byteString.length; i++) {
                    bytes[i] = byteString.charCodeAt(i);
                }
                const mimeType = document.originalMimeType || 'application/pdf';
                const blob = new Blob([bytes], { type: mimeType });
                url = URL.createObjectURL(blob);
                setPdfBlobUrl(url);
            } catch (e) {
                console.error('Failed to create PDF blob URL from stored data:', e);
                // Fall back to legacy fileUrl
                setPdfBlobUrl(document.fileUrl || null);
            }
        } else if (document.fileUrl) {
            // Legacy fallback: use the original blob URL
            setPdfBlobUrl(document.fileUrl);
        } else {
            setPdfBlobUrl(null);
        }

        return () => {
            // Only revoke URLs we created from base64 (not the legacy fileUrl)
            if (url && document.originalFileBase64) {
                URL.revokeObjectURL(url);
            }
        };
    }, [viewMode, document?.id, document?.originalFileBase64, document?.fileUrl]);

    const handlePdfDownload = () => {
        if (!pdfBlobUrl || !document) return;
        const a = window.document.createElement('a');
        a.href = pdfBlobUrl;
        a.download = document.name;
        a.click();
    };

    const renderDocumentPanel = () => {
        if (viewMode === 'pdf') {
            return (
                <div className="h-full flex flex-col bg-slate-800 border-l border-slate-200 overflow-hidden relative">
                    {pdfBlobUrl && !pdfLoadError ? (() => {
                        // Construct Highlighting Fragment
                        // Format: #page=N&search="phrase"
                        const fragments: string[] = [];

                        if (cell?.page && cell.page > 0) {
                            fragments.push(`page=${cell.page}`);
                        }

                        if (cell?.quote) {
                            // Clean quote for search: remove newlines, extra spaces
                            const cleanQuote = cell.quote
                                .replace(/\s+/g, ' ')
                                .trim()
                                .substring(0, 100); // Limit length to avoid URL issues

                            if (cleanQuote) {
                                // Encode for URL but keep quotes for phrase search
                                fragments.push(`search="${encodeURIComponent(cleanQuote)}"`);
                            }
                        }

                        const hash = fragments.length > 0 ? `#${fragments.join('&')}` : '';
                        const fullUrl = `${pdfBlobUrl}${hash}`;

                        return (
                            <object
                                key={`${document?.id}-${hash}`}
                                data={fullUrl}
                                type="application/pdf"
                                className="w-full h-full border-0"
                                title="Original PDF"
                            >
                                {/* Fallback: try embed, then show error with download link */}
                                <embed
                                    src={fullUrl}
                                    type="application/pdf"
                                    className="w-full h-full"
                                />
                            </object>
                        );
                    })() : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                            <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
                            {pdfLoadError ? (
                                <>
                                    <p className="mb-2">Unable to display PDF in browser.</p>
                                    {pdfBlobUrl && (
                                        <button
                                            onClick={handlePdfDownload}
                                            className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
                                        >
                                            Download PDF Instead
                                        </button>
                                    )}
                                    <p className="text-xs mt-3 text-slate-500">
                                        Tip: Switch to "Extracted Text" view to see the document content.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p>Original file not available.</p>
                                    <p className="text-xs mt-2">Only newly uploaded files support PDF view.</p>
                                </>
                            )}
                        </div>
                    )}

                    {/* Disclaimer Overlay */}
                    {pdfBlobUrl && !pdfLoadError && (
                        <div className="absolute top-4 right-4 bg-black/75 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-xs font-medium z-10 pointer-events-none">
                            Original PDF View
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="h-full flex flex-col bg-slate-100 border-l border-slate-200 overflow-hidden">
                <div className="flex-1 bg-slate-200 relative flex flex-col min-h-0">
                    <div
                        ref={scrollContainerRef}
                        className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth"
                    >
                        <div className="max-w-[800px] w-full bg-white shadow-lg min-h-[800px] p-8 md:p-12 relative mx-auto text-left">
                            {renderHighlightedContent()}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    if (!document) return null;

    return (
        <div className="h-full w-full flex">
            {/* Left Panel (Analyst) - Always Visible */}
            {/* Left Panel (Analyst) - Resizable if Expanded, Fixed/Full if not? */}
            {/* If NOT expanded, it takes full width of the sidebar (which is small). 
                If Expanded, it takes `panelWidth` 
            */}
            <div
                className={`flex-shrink-0 bg-white z-20 shadow-xl flex flex-col relative ${isResizing ? '' : 'transition-all duration-300'}`}
                style={{ width: isExpanded ? panelWidth : '100%' }}
            >
                {renderAnswerPanel()}

                {/* Drag Handle (Only visible when expanded) */}
                {isExpanded && (
                    <div
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-indigo-300 transition-colors z-50 group translate-x-1/2"
                        onMouseDown={(e) => { setIsResizing(true); e.preventDefault(); }}
                    >
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-1 bg-slate-200 rounded-full group-hover:bg-indigo-400 transition-colors" />
                    </div>
                )}
            </div>

            {/* Right Panel (Document) - Conditionally Visible */}
            {isExpanded && (
                <div className="flex-1 animate-in slide-in-from-right duration-300 min-w-0">
                    {renderDocumentPanel()}
                </div>
            )}
        </div>
    );
};