'use client';

import { useState, useCallback } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store/stage';
import { useI18n } from '@/lib/hooks/use-i18n';
import { db, getGeneratedAgentsByStageId } from '@/lib/utils/database';
import {
  CLASSROOM_ZIP_EXTENSION,
  CLASSROOM_ZIP_FORMAT_VERSION,
  type ClassroomManifest,
  type ManifestAgent,
  type ManifestScene,
  type ManifestStage,
  type MediaIndexEntry,
} from '@/lib/export/classroom-zip-types';
import { collectAudioFiles, collectMediaFiles, actionsToManifest } from '@/lib/export/classroom-zip-utils';
import type { SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';

const log = createLogger('ExportClassroom');

export function useExportClassroom() {
  const [exporting, setExporting] = useState(false);
  const { t } = useI18n();

  const exportClassroomZip = useCallback(async () => {
    const { stage, scenes } = useStageStore.getState();
    if (!stage?.id || scenes.length === 0) return;

    setExporting(true);
    const toastId = toast.loading(t('export.exporting'));

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 1. Read the latest stage metadata from IndexedDB (may differ from in-memory cache)
      const freshStage = await db.stages.get(stage.id);
      const latestName = freshStage?.name || stage.name;

      // 2. Collect generated agents from IndexedDB
      const agentRecords = await getGeneratedAgentsByStageId(stage.id);

      // 3. Collect audio & media assets
      const audioFiles = await collectAudioFiles(scenes);
      const mediaFiles = await collectMediaFiles(stage.id);

      // 4. Build audioId → zipPath map for manifest conversion
      const audioIdToPath = new Map<string, string>();
      for (const af of audioFiles) {
        audioIdToPath.set(af.record.id, af.zipPath);
      }

      // 5. Assemble manifest data
      const manifestStage: ManifestStage = {
        name: latestName,
        description: stage.description,
        language: stage.language,
        style: stage.style,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      };

      const manifestAgents: ManifestAgent[] = agentRecords.map((agent) => ({
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        avatar: agent.avatar,
        color: agent.color,
        priority: agent.priority,
      }));

      // Include embedded generated agents when DB has none (e.g. freshly generated classroom)
      if (manifestAgents.length === 0 && stage.generatedAgentConfigs?.length) {
        for (const agent of stage.generatedAgentConfigs) {
          manifestAgents.push({
            name: agent.name,
            role: agent.role,
            persona: agent.persona,
            avatar: agent.avatar,
            color: agent.color,
            priority: agent.priority,
          });
        }
      }

      const agentIdToIndex = new Map<string, number>();
      agentRecords.forEach((agent, index) => agentIdToIndex.set(agent.id, index));
      if (stage.generatedAgentConfigs?.length && agentRecords.length === 0) {
        stage.generatedAgentConfigs.forEach((agent, index) => agentIdToIndex.set(agent.id, index));
      }

      const manifestScenes: ManifestScene[] = scenes.map((scene) => ({
        type: scene.type,
        title: scene.title,
        order: scene.order,
        content: scene.content,
        actions: scene.actions ? actionsToManifest(scene.actions, audioIdToPath) : undefined,
        whiteboards: scene.whiteboards,
        ...(scene.multiAgent?.enabled
          ? {
              multiAgent: {
                enabled: true,
                agentIndices: (scene.multiAgent.agentIds ?? [])
                  .map((id) => agentIdToIndex.get(id))
                  .filter((idx): idx is number => idx !== undefined),
                directorPrompt: scene.multiAgent.directorPrompt,
              },
            }
          : {}),
      }));

      const mediaIndex: Record<string, MediaIndexEntry> = {};
      for (const af of audioFiles) {
        mediaIndex[af.zipPath] = {
          type: 'audio',
          format: af.record.format,
          duration: af.record.duration,
          voice: af.record.voice,
        };
      }
      for (const mf of mediaFiles) {
        mediaIndex[mf.zipPath] = {
          type: 'generated',
          mimeType: mf.record.mimeType,
          size: mf.record.size,
          prompt: mf.record.prompt,
        };
      }

      // Flag missing audio references so importer can warn the user
      for (const scene of scenes) {
        for (const action of scene.actions ?? []) {
          if (action.type === 'speech') {
            const audioId = (action as SpeechAction).audioId;
            if (audioId && !audioIdToPath.has(audioId)) {
              const missingPath = `audio/${audioId}.mp3`;
              mediaIndex[missingPath] = { type: 'audio', missing: true };
            }
          }
        }
      }

      const manifest: ClassroomManifest = {
        formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: process.env.npm_package_version || '0.0.0',
        stage: manifestStage,
        agents: manifestAgents,
        scenes: manifestScenes,
        mediaIndex,
      };

      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      for (const af of audioFiles) {
        zip.file(af.zipPath, af.record.blob);
      }
      for (const mf of mediaFiles) {
        zip.file(mf.zipPath, mf.record.blob);
        if (mf.record.poster) {
          zip.file(mf.zipPath.replace(/\.\w+$/, '.poster.jpg'), mf.record.poster);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const safeName = latestName.replace(/[\\/:*?"<>|]/g, '_') || 'classroom';
      saveAs(zipBlob, `${safeName}${CLASSROOM_ZIP_EXTENSION}`);

      toast.success(t('export.exportSuccess'), { id: toastId });
    } catch (error) {
      log.error('Classroom ZIP export failed:', error);
      toast.error(t('export.exportFailed'), { id: toastId });
    } finally {
      setExporting(false);
    }
  }, [t]);

  return { exporting, exportClassroomZip };
}
