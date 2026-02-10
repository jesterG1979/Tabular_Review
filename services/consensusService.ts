import { ExtractionCell, ConsensusDetail, DocumentFile, Column } from '../types';
import { extractColumnData } from './geminiService';
import { extractColumnDataWithClaude } from './claudeService';

const normalizeVote = (value: string): 'yes' | 'no' | 'unknown' => {
    if (!value) return 'unknown';
    const v = value.toLowerCase().trim();
    if (v.startsWith('yes') || v === 'true') return 'yes';
    if (v.startsWith('no') || v === 'false') return 'no';
    return 'unknown';
};

export const runConsensusExtraction = async (
    doc: DocumentFile,
    col: Column,
    availableModels: string[]
): Promise<ExtractionCell> => {
    // 1. Determine Agent Strategy
    const agentsToRun: { model: string; provider: 'gemini' | 'claude' }[] = [];

    // We want 3 agents. Round robin.
    for (let i = 0; i < 3; i++) {
        const modelKey = availableModels[i % availableModels.length];
        const provider = modelKey.includes('claude') ? 'claude' : 'gemini';
        agentsToRun.push({ model: modelKey, provider });
    }

    console.log(`[CONSENSUS] Running 3 agents for consensus on ${doc.name} - ${col.name}`, agentsToRun);

    // 2. Parallel Execution
    const promises = agentsToRun.map(async (agent, idx) => {
        try {
            let result;
            if (agent.provider === 'gemini') {
                result = await extractColumnData(doc, col, agent.model);
            } else {
                result = await extractColumnDataWithClaude(doc, col, agent.model);
            }
            return { ...result, modelId: `Agent ${idx + 1} (${agent.model})`, error: null };
        } catch (e: any) {
            console.error(`Agent ${idx + 1} failed`, e);
            const errorMsg = e.message || String(e);
            return {
                value: `Error: ${errorMsg.substring(0, 50)}`, // Show error in value for debugging
                confidence: 'Low' as const,
                quote: '',
                reasoning: `Agent failed: ${errorMsg}`,
                page: 0,
                modelId: `Agent ${idx + 1} (${agent.model})`, // Keep model info
                error: e
            };
        }
    });

    const results = await Promise.all(promises);

    // 3. Process Results & Vote
    const consensusDetails: ConsensusDetail[] = results.map(r => ({
        value: r.value,
        confidence: r.confidence,
        quote: r.quote,
        reasoning: r.reasoning,
        modelId: r.modelId,
        vote: normalizeVote(r.value),
        page: r.page
    }));

    const voteCounts = { yes: 0, no: 0, unknown: 0 };
    let validVotes = 0;

    consensusDetails.forEach(d => {
        // Only count valid votes (ignore errors/unknowns if possible)
        if (d.vote !== 'unknown') {
            voteCounts[d.vote]++;
            validVotes++;
        } else {
            // Check if it's an explicit error
            if (d.value.startsWith('Error')) {
                // Do not count as 'unknown' vote in the traditional sense, treating as abstention
            } else {
                voteCounts.unknown++;
            }
        }
    });

    // 4. Determine Winner
    let winnerVote: 'yes' | 'no' | 'unknown' = 'unknown';

    // Logic: Majority of VALID votes.
    // If we have 3 agents, and 1 fails. We have 2 valid votes.
    // If 2 Yes, 0 No -> Yes.
    // If 1 Yes, 1 No -> Tie (Unknown/Review).
    // If 1 Yes, 0 No -> Yes (but low confidence).

    if (voteCounts.yes > voteCounts.no) winnerVote = 'yes';
    else if (voteCounts.no > voteCounts.yes) winnerVote = 'no';
    else {
        // Tie or 0 valid votes
        winnerVote = 'unknown';
    }

    // Find a representative for the winner
    // If winner is 'unknown', try to find a non-error unknown? Or just the first one.
    // If winner is 'yes' or 'no', pick the first agent that voted that way.

    let winner = consensusDetails.find(d => d.vote === winnerVote);

    // FALLBACK: If NO winner (all errors or tie undefined), default to first non-error if exists
    if (!winner) {
        if (validVotes === 0) {
            // All errors?
            winner = consensusDetails[0];
        } else {
            // Tie
            winner = consensusDetails.find(d => d.vote !== 'unknown') || consensusDetails[0];
        }
    }

    const isUnanimous = validVotes > 0 && (voteCounts.yes === validVotes || voteCounts.no === validVotes);

    // Downgrade status if we had errors or low valid votes
    const hasErrors = results.some(r => r.error);
    const confidence = isUnanimous && !hasErrors ? 'High' : 'Low';

    // 5. Construct Final Cell
    return {
        value: winner.value,
        confidence: confidence,
        quote: winner.quote,
        page: winner.page || 0,
        reasoning: winner.reasoning + (hasErrors ? " (Note: Some agents failed)" : ""),
        status: (isUnanimous && !hasErrors) ? 'verified' : 'disagreement',
        consensus: consensusDetails
    };
};
