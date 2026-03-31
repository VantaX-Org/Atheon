import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Clean LLM text that may contain raw JSON or markdown code fences.
 * The backend strips code fences before JSON.parse, but if parsing fails
 * the raw text (possibly still with fences or raw JSON) reaches the frontend.
 * This helper extracts readable text from such responses.
 */
export function cleanLlmText(text: string | undefined | null): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // If the cleaned text looks like a JSON object, try to extract the summary/text field
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      // Try common LLM response fields in priority order
      const summaryField = parsed.executiveSummary || parsed.summary || parsed.insights
        || parsed.narrative || parsed.text || parsed.content || parsed.response;
      if (typeof summaryField === 'string') return summaryField;
      // If no string field found, format the object nicely
      return formatJsonAsText(parsed);
    } catch {
      // Not valid JSON, return as-is
    }
  }

  return cleaned;
}

/**
 * Format a parsed JSON object into readable text sections.
 * Used when AI Insights returns structured data that should be displayed as text.
 */
export function formatJsonAsText(obj: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata fields
    if (['generatedAt', 'poweredBy', 'domain', 'traceability'].includes(key)) continue;

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();

    if (typeof value === 'string') {
      parts.push(`${label}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (typeof value[0] === 'string') {
        parts.push(`${label}:\n${value.map(v => `  • ${v}`).join('\n')}`);
      } else if (typeof value[0] === 'object') {
        const items = value.map(item => {
          const vals = Object.values(item as Record<string, unknown>).filter(v => typeof v === 'string');
          return `  • ${vals.join(' — ')}`;
        });
        parts.push(`${label}:\n${items.join('\n')}`);
      }
    } else if (typeof value === 'number') {
      parts.push(`${label}: ${value}`);
    }
  }

  return parts.join('\n\n');
}
