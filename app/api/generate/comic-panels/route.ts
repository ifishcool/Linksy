import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const log = createLogger('ComicPanels API');

export const maxDuration = 180;

type AgentInfo = { id: string; name: string; role: string; persona?: string };

type RequestBody = {
  requirement: string;
  language: 'zh-CN' | 'en-US' | 'ja-JP' | 'ru-RU';
  panelCount?: number;
  agents?: AgentInfo[];
};

function getLanguageRule(language: RequestBody['language']): string {
  const label =
    language === 'zh-CN'
      ? 'Chinese (Simplified)'
      : language === 'ja-JP'
        ? 'Japanese'
        : language === 'ru-RU'
          ? 'Russian'
          : 'English (US)';

  return [
    `Current generation language code: ${language}`,
    `Current generation language label: ${label}`,
    `All natural-language content MUST be written in ${label}, including panel title, captions, and dialogues.`,
    'Do not mix multiple languages unless the user explicitly asks for bilingual content.',
  ].join('\n');
}

type RawPanel = {
  index?: number;
  title?: string;
  prompt?: string;
  caption?: string;
  dialogue?: string;
  aspectRatio?: string;
};

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const requirement = body.requirement?.trim();
    const language = body.language;
    const panelCount = Math.min(Math.max(body.panelCount ?? 6, 5), 8);

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'requirement is required');
    }
    if (!language) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'language is required');
    }

    const { model: languageModel, modelString } = resolveModelFromHeaders(req);

    const agents = Array.isArray(body.agents) ? body.agents : [];
    const agentContext = agents.length
      ? `Agents (use them to improve story and make prompts vivid; do NOT mention agent names in captions):\n${agents
          .map((a) => `- ${a.role}: ${a.name}${a.persona ? ` — ${a.persona}` : ''}`)
          .join('\n')}`
      : '';

    const system =
      'You are a professional comic storyboard writer and prompt engineer for text-to-image models. Return ONLY valid JSON. No markdown.';

    const user = `Create a single-page multi-panel comic storyboard based on the user requirement.

User requirement:
${requirement}

Language: ${language}
${getLanguageRule(language)}
Panel count: ${panelCount}

Rules:
- Output exactly ${panelCount} panels.
- Panels will be rendered inside ONE final image with dynamic manga-style layout.
- Prefer non-uniform panel shapes/sizes (not rigid square grid), and include at least one diagonal/angled split panel.
- Each panel must be self-contained and visually distinct from neighboring panels.
- Provide a short title per panel.
- Provide an image prompt per panel (describe characters, environment, composition, camera angle, lighting, style, and how this panel fits irregular page layout).
- Use a consistent cast and style across panels.
- Keep captions/dialogue short.
- Characters must be adorable little animal students in 2D cartoon style, NOT real human students.
- Ensure dialogue panels include clear speech bubble intent in the prompt.
- Do NOT include any copyrighted characters.
- Preferred style: pure 2D cute Chinese cartoon-comic style with Japanese manga-style pacing, colorful palette, flat/cel coloring, clean line art, expressive faces, high readability.
- Avoid photorealistic style, avoid 3D rendering, avoid CGI look.
- Use aspectRatio "3:4".

${agentContext}

Return JSON with this structure:
{
  "panels": [
    {
      "index": 1,
      "title": "string",
      "prompt": "string",
      "caption": "string (optional)",
      "dialogue": "string (optional)",
      "aspectRatio": "3:4"
    }
  ]
}`;

    log.info(`Generating comic panels [model=${modelString}] count=${panelCount}`);

    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      'comic-panels',
    );

    const raw = stripCodeFences(result.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return apiError('PARSE_FAILED', 500, 'Failed to parse comic panels JSON');
    }

    const panels = (parsed as { panels?: unknown }).panels;
    if (!Array.isArray(panels) || panels.length === 0) {
      return apiError('GENERATION_FAILED', 500, 'No panels returned');
    }

    const normalized = (panels as RawPanel[]).slice(0, panelCount).map((p, i) => ({
      index: typeof p?.index === 'number' ? p.index : i + 1,
      title: String(p?.title || `Panel ${i + 1}`),
      prompt: String(p?.prompt || ''),
      caption: p?.caption != null ? String(p.caption) : undefined,
      dialogue: p?.dialogue != null ? String(p.dialogue) : undefined,
      aspectRatio: String(p?.aspectRatio || '3:4'),
    }));

    if (normalized.some((p) => !p.prompt)) {
      return apiError('GENERATION_FAILED', 500, 'Some panels are missing prompt');
    }

    return apiSuccess({ panels: normalized });
  } catch (error) {
    log.error('Comic panels generation error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
