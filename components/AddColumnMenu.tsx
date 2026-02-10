import React, { useState } from 'react';
import { ColumnType, SmtRule } from '../types';
import { generatePromptHelper } from '../services/geminiService';
import { generatePromptHelperWithClaude } from '../services/claudeService';
import {
  X,
  HelpCircle,
  ChevronDown,
  Check,
  Sparkles,
  Loader2,
  Type,
  Hash,
  Calendar,
  CheckSquare,
  List,
  Trash2,
  ShieldAlert,
  Plus
} from './Icons';

const COLUMN_TYPES: { type: ColumnType; label: string; icon: React.FC<any> }[] = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'date', label: 'Date', icon: Calendar },
  { type: 'boolean', label: 'Yes/No', icon: CheckSquare },
  { type: 'list', label: 'List', icon: List },
];

import { MODELS } from '../constants/models';

interface AddColumnMenuProps {
  triggerRect: DOMRect;
  onClose: () => void;
  onSave: (col: { name: string; type: ColumnType; prompt: string; modelConfig: { provider: 'consensus' | 'specific'; modelId?: string }; smtRules: SmtRule[] }) => void;
  onDelete?: () => void;
  modelId: string;
  initialData?: { name: string; type: ColumnType; prompt: string; modelConfig?: { provider: 'consensus' | 'specific'; modelId?: string }; smtRules?: SmtRule[] };
}

export const AddColumnMenu: React.FC<AddColumnMenuProps> = ({
  triggerRect,
  onClose,
  onSave,
  onDelete,
  modelId,
  initialData
}) => {
  const [name, setName] = useState(initialData?.name || '');
  const [type, setType] = useState<ColumnType>(initialData?.type || 'text');
  const [prompt, setPrompt] = useState(initialData?.prompt || '');
  const [modelConfig, setModelConfig] = useState<{ provider: 'consensus' | 'specific'; modelId?: string }>(
    initialData?.modelConfig || { provider: 'specific', modelId: MODELS[0].id }
  );
  const [smtRules, setSmtRules] = useState<SmtRule[]>(initialData?.smtRules || []);

  // New Rule State
  const [newRuleParams, setNewRuleParams] = useState<{ operator: SmtRule['operator']; value: string }>({
    operator: 'gt',
    value: ''
  });

  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  const selectedType = COLUMN_TYPES.find(t => t.type === type) || COLUMN_TYPES[0];

  // Calculate position
  // Default: Align the RIGHT edge of the menu with the RIGHT edge of the trigger (extends left)
  // This prevents it from going off-screen for columns on the right side.
  const MENU_WIDTH = 400;
  let top = triggerRect.bottom + 8;
  let left = triggerRect.right - MENU_WIDTH;

  // If that pushes it off-screen to the left (e.g. very first column on narrow screens), 
  // force it to the left edge plus a margin.
  if (left < 10) {
    left = 10;
  }

  const handleAiGeneratePrompt = async () => {
    if (!name) return;

    setIsGeneratingPrompt(true);
    try {
      // Determine which service to use based on model ID
      const isClaudeModel = modelId.startsWith('claude-');

      const suggestion = isClaudeModel
        ? await generatePromptHelperWithClaude(name, type, prompt || undefined, modelId)
        : await generatePromptHelper(name, type, prompt || undefined, modelId);

      setPrompt(suggestion);
    } catch (e) {
      console.error("Failed to generate prompt", e);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleAddRule = () => {
    if (!newRuleParams.value) return;

    const newRule: SmtRule = {
      id: `rule_${Date.now()}`,
      operator: newRuleParams.operator,
      value: newRuleParams.value,
      description: `${name} must be ${getOperatorLabel(newRuleParams.operator)} ${newRuleParams.value}`
    };

    setSmtRules([...smtRules, newRule]);
    setNewRuleParams({ ...newRuleParams, value: '' });
  };

  const handleRemoveRule = (ruleId: string) => {
    setSmtRules(smtRules.filter(r => r.id !== ruleId));
  };

  const getOperatorLabel = (op: string) => {
    switch (op) {
      case 'gt': return '>';
      case 'lt': return '<';
      case 'eq': return '=';
      case 'neq': return '!=';
      case 'ge': return '>=';
      case 'le': return '<=';
      default: return op;
    }
  };

  const handleSave = () => {
    if (name && prompt) {
      onSave({ name, type, prompt, modelConfig, smtRules });
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div
        className="fixed bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-50 w-[400px]"
        style={{ top, left }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-full transition-colors z-10"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Label Input */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-500">
              <HelpCircle className="w-3.5 h-3.5" />
              <label className="text-xs font-semibold">Label</label>
            </div>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400"
              placeholder="e.g. Persons mentioned"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && (!e.shiftKey && !newRuleParams.value) && handleSave()}
            />
          </div>

          {/* Model Dropdown */}
          <div className="space-y-1.5 relative">
            <label className="text-xs font-semibold text-slate-500 ml-1">Model / Method</label>
            <button
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              className="w-full flex items-center justify-between border border-slate-200 bg-slate-50/50 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <div className="flex items-center gap-2">
                {modelConfig.provider === 'consensus' ? (
                  <>
                    <div className="flex -space-x-1">
                      <span className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] text-indigo-700 font-bold ring-1 ring-white">3</span>
                    </div>
                    <span>Multi-Agent Consensus</span>
                  </>
                ) : (
                  <>
                    {(() => {
                      const m = MODELS.find(m => m.id === modelConfig.modelId);
                      return m ? (
                        <>
                          <m.icon className="w-4 h-4 text-slate-500" />
                          <span>{m.name}</span>
                        </>
                      ) : <span>Select Model...</span>
                    })()}
                  </>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>

            {isModelMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsModelMenuOpen(false)}></div>
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-100 shadow-xl rounded-lg overflow-hidden z-30 py-1 max-h-[250px] overflow-y-auto">
                  {/* Consensus Option */}
                  <button
                    onClick={() => { setModelConfig({ provider: 'consensus' }); setIsModelMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-sm text-slate-700 text-left"
                  >
                    <div className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] text-indigo-700 font-bold">3</div>
                    <div className="flex flex-col">
                      <span className="font-medium">Multi-Agent Consensus</span>
                      <span className="text-[10px] text-slate-400">Best for verification</span>
                    </div>
                    {modelConfig.provider === 'consensus' && <Check className="w-3.5 h-3.5 ml-auto text-indigo-600" />}
                  </button>

                  <div className="h-px bg-slate-100 my-1 mx-2"></div>

                  {/* Specific Models */}
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModelConfig({ provider: 'specific', modelId: m.id }); setIsModelMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-sm text-slate-700 text-left"
                    >
                      <m.icon className="w-4 h-4 text-slate-400" />
                      <div className="flex flex-col">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-[10px] text-slate-400">{m.description}</span>
                      </div>
                      {modelConfig.provider === 'specific' && modelConfig.modelId === m.id && <Check className="w-3.5 h-3.5 ml-auto text-indigo-600" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Format Dropdown */}
          <div className="space-y-1.5 relative">
            <label className="text-xs font-semibold text-slate-500 ml-1">Format</label>
            <button
              onClick={() => setIsTypeMenuOpen(!isTypeMenuOpen)}
              className="w-full flex items-center justify-between border border-slate-200 bg-slate-50/50 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <div className="flex items-center gap-2">
                <selectedType.icon className="w-4 h-4 text-slate-500" />
                <span>{selectedType.label}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>

            {isTypeMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsTypeMenuOpen(false)}></div>
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-100 shadow-xl rounded-lg overflow-hidden z-30 py-1 max-h-[200px] overflow-y-auto">
                  {COLUMN_TYPES.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => { setType(t.type); setIsTypeMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-sm text-slate-700 text-left"
                    >
                      <t.icon className="w-4 h-4 text-slate-400" />
                      <span>{t.label}</span>
                      {type === t.type && <Check className="w-3.5 h-3.5 ml-auto text-indigo-600" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Validation Rules Section */}
          {(type === 'number') && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-slate-500">
                <ShieldAlert className="w-3.5 h-3.5 text-indigo-500" />
                <label className="text-xs font-semibold text-indigo-700">SMT Validation Rules</label>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
                {/* List of existing rules */}
                {smtRules.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {smtRules.map(rule => (
                      <div key={rule.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-xs shadow-sm">
                        <span className="font-mono text-slate-600">
                          <span className="font-bold text-indigo-600">Value</span> {getOperatorLabel(rule.operator)} {rule.value}
                        </span>
                        <button
                          onClick={() => handleRemoveRule(rule.id)}
                          className="text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new rule */}
                <div className="flex gap-2">
                  <select
                    className="w-16 text-xs border border-slate-200 rounded px-1.5 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                    value={newRuleParams.operator}
                    onChange={(e) => setNewRuleParams({ ...newRuleParams, operator: e.target.value as any })}
                  >
                    <option value="gt">{'>'}</option>
                    <option value="lt">{'<'}</option>
                    <option value="eq">{'='}</option>
                    <option value="neq">{'!='}</option>
                    <option value="ge">{'>='}</option>
                    <option value="le">{'<='}</option>
                  </select>
                  <input
                    type="number"
                    className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="Value (e.g. 50)"
                    value={newRuleParams.value}
                    onChange={(e) => setNewRuleParams({ ...newRuleParams, value: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                  />
                  <button
                    onClick={handleAddRule}
                    disabled={!newRuleParams.value}
                    className="px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded border border-indigo-200 text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Prompt Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-slate-500">
              <HelpCircle className="w-3.5 h-3.5" />
              <label className="text-xs font-semibold">Prompt</label>
            </div>
            <div className="relative">
              <textarea
                className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none min-h-[100px] resize-none transition-all"
                placeholder="Describe what data to extract..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {/* AI Generate / Optimize Button */}
              <button
                onClick={handleAiGeneratePrompt}
                disabled={isGeneratingPrompt || !name}
                className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-medium text-slate-500 hover:text-indigo-600 hover:border-indigo-200 shadow-sm transition-colors disabled:opacity-50"
              >
                {isGeneratingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {prompt ? "Optimize" : "AI Generate"}
              </button>
            </div>
          </div>
        </div>

        <div className={`px-5 py-3 bg-slate-50 border-t border-slate-100 flex ${initialData ? 'justify-between' : 'justify-end'} gap-3`}>
          {initialData && onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-2 px-3 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg font-medium text-xs transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!name || !prompt}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium text-xs shadow-lg shadow-slate-900/10 transition-all active:scale-95"
          >
            {initialData ? 'Update Column' : 'Create Column'}
          </button>
        </div>
      </div>
    </>
  );
};