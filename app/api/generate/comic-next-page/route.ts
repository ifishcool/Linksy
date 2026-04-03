import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const log = createLogger('ComicNextPage API');

export const maxDuration = 180;

type AgentInfo = { id: string; name: string; role: string; persona?: string };

type RequestBody = {
  requirement: string;
  language: 'zh-CN' | 'en-US';
  pageIndex: number;
  previousPages?: Array<{ pageIndex: number; title: string; summary?: string }>;
  agents?: AgentInfo[];
};

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
    const pageIndex = Math.max(1, Number(body.pageIndex || 1));
    const minPagesBeforeStop = 6;

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'requirement is required');
    }
    if (!language) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'language is required');
    }

    const { model: languageModel, modelString } = resolveModelFromHeaders(req);

    const previousPages = Array.isArray(body.previousPages) ? body.previousPages : [];
    const previousSummary = previousPages.length
      ? previousPages
          .map((p) => `- Page ${p.pageIndex}: ${p.title}${p.summary ? ` | ${p.summary}` : ''}`)
          .join('\n')
      : 'None';

    const agents = Array.isArray(body.agents) ? body.agents : [];
    const agentContext = agents.length
      ? `Agents for collaboration context:\n${agents
          .map((a) => `- ${a.role}: ${a.name}${a.persona ? ` — ${a.persona}` : ''}`)
          .join('\n')}`
      : '';

    const system =
      'You are a comic director. Decide whether to continue with next page and, if continue, produce one page storyboard. Return ONLY valid JSON.';

    const user = `Task: Generate page ${pageIndex} for an educational comic.

User requirement:
${requirement}

Language: ${language}
Previous pages summary:
${previousSummary}

${agentContext}

Rules:
- Decide if story should continue.
- This comic should be detailed and multi-page. Do NOT try to finish everything in one page.
- Use step-by-step teaching progression across pages (concept breakdown, examples, practice, recap).
- Each page should cover one clear sub-topic and push the learning process forward.
- Target finishing the whole teaching storyline within 20 pages total.
- If pageIndex is approaching 20, compress remaining points and move toward wrap-up.
- If objective is complete, set shouldContinue=false and provide stopReason.
- If shouldContinue=true, provide exactly one page with 5-8 panels.
- This page will be rendered as ONE single image with dynamic manga-style layout.
- Prefer non-uniform panel shapes/sizes (not rigid square grid), and include at least one diagonal/angled split panel.
- Keep style, cast, and tone consistent with previous pages.
- Style direction: pure 2D cute Chinese cartoon-comic style with Japanese manga-style storytelling rhythm, colorful palette, flat/cel coloring, clean line art, expressive faces.
- Characters must be adorable little animal students (cartoon style), NOT real human students.
- Avoid copyrighted characters.
- Keep caption/dialogue concise and readable.
- Ensure dialogue appears in clear comic speech bubbles in relevant panels.
- Avoid photorealistic style, avoid 3D rendering, avoid CGI look.
- Use aspectRatio "3:4" for each panel.
- For page 1 to page ${minPagesBeforeStop - 1}, MUST continue and provide a full page output.

Return JSON exactly:
{
  "shouldContinue": true,
  "stopReason": "string (optional)",
  "page": {
    "title": "string",
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
  }
}`;

    log.info(`Deciding and generating comic page ${pageIndex} [model=${modelString}]`);

    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      'comic-next-page',
    );

    const raw = stripCodeFences(result.text);
    let parsed: {
      shouldContinue?: boolean;
      stopReason?: string;
      page?: { title?: string; panels?: RawPanel[] };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return apiError('PARSE_FAILED', 500, 'Failed to parse next comic page JSON');
    }

    // Ensure early pages continue for detailed multi-page explanation
    const shouldContinue = pageIndex < minPagesBeforeStop ? true : Boolean(parsed.shouldContinue);

    if (!shouldContinue) {
      return apiSuccess({
        shouldContinue: false,
        stopReason: parsed.stopReason || 'AI decided story is complete',
      });
    }

    const page = parsed.page;
    const rawPanels = Array.isArray(page?.panels) ? page!.panels : [];
    if (rawPanels.length === 0) {
      return apiError('GENERATION_FAILED', 500, 'No panels returned for next page');
    }

    const panels = rawPanels.slice(0, 8).map((p, i) => ({
      index: typeof p.index === 'number' ? p.index : i + 1,
      title: String(p.title || `Panel ${i + 1}`),
      prompt: String(p.prompt || ''),
      caption: p.caption != null ? String(p.caption) : undefined,
      dialogue: p.dialogue != null ? String(p.dialogue) : undefined,
      aspectRatio: String(p.aspectRatio || '3:4'),
    }));

    if (panels.length < 5) {
      return apiError('GENERATION_FAILED', 500, 'Generated panel count is less than 5');
    }
    if (panels.some((p) => !p.prompt)) {
      return apiError('GENERATION_FAILED', 500, 'Some generated panels are missing prompt');
    }

    return apiSuccess({
      shouldContinue: true,
      page: {
        title: String(page?.title || `Page ${pageIndex}`),
        panels,
      },
    });
  } catch (error) {
    log.error('Comic next page generation error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
