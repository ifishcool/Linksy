'use client';

import { useState, useCallback, useRef } from 'react';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { db, mediaFileKey } from '@/lib/utils/database';
import type {
  AudioFileRecord,
  MediaFileRecord,
  GeneratedAgentRecord,
} from '@/lib/utils/database';
import type { ClassroomManifest, ManifestScene } from '@/lib/export/classroom-zip-types';
import { rewriteAudioRefsToIds } from '@/lib/export/classroom-zip-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('ImportClassroom');

export type ImportPhase = 'idle' | 'parsing' | 'validating' | 'writingMedia' | 'writingCourse' | 'done';

export function useImportClassroom(onSuccess?: () => void) {
  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Reset input so selecting the same file twice still fires change
      event.target.value = '';

      setImporting(true);
      setPhase('parsing');
      const toastId = toast.loading(t('import.parsing'));

      const fail = (messageKey: string) => {
        toast.error(t(messageKey), { id: toastId });
        setImporting(false);
        setPhase('idle');
      };

      try {
        if (file.size > 200 * 1024 * 1024) {
          log.warn(`Importing large ZIP file (~${(file.size / 1024 / 1024).toFixed(0)}MB)`);
        }

        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(file);

        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
          fail('import.error.invalidManifest');
          return;
        }

        setPhase('validating');
        toast.loading(t('import.validating'), { id: toastId });

        const manifestText = await manifestFile.async('text');
        let manifest: ClassroomManifest;
        try {
          manifest = JSON.parse(manifestText);
        } catch {
          fail('import.error.invalidManifest');
          return;
        }

        if (!manifest.stage || !Array.isArray(manifest.scenes)) {
          fail('import.error.missingData');
          return;
        }

        const newStageId = nanoid();
        const now = Date.now();

        const newAgentIds: string[] = (manifest.agents ?? []).map(() => nanoid());

        const audioRefToNewId: Record<string, string> = {};
        const mediaRefToNewId: Record<string, string> = {};

        for (const [zipPath, entry] of Object.entries(manifest.mediaIndex ?? {})) {
          if (entry.type === 'audio' && !entry.missing) {
            audioRefToNewId[zipPath] = nanoid();
          } else if ((entry.type === 'generated' || entry.type === 'image') && !entry.missing) {
            const filename = zipPath.split('/').pop() ?? '';
            const elementId = filename.replace(/\.\w+$/, '');
            mediaRefToNewId[zipPath] = mediaFileKey(newStageId, elementId);
          }
        }

        setPhase('writingMedia');
        toast.loading(t('import.writingMedia'), { id: toastId });

        // Persist audio files
        for (const [zipPath, newId] of Object.entries(audioRefToNewId)) {
          const zipEntry = zip.file(zipPath);
          if (!zipEntry) continue;
          const blob = await zipEntry.async('blob');
          const meta = manifest.mediaIndex?.[zipPath];
          const record: AudioFileRecord = {
            id: newId,
            blob,
            format: meta?.format || 'mp3',
            duration: meta?.duration,
            voice: meta?.voice,
            createdAt: now,
          };
          await db.audioFiles.put(record);
        }

        // Persist generated media
        for (const [zipPath, newId] of Object.entries(mediaRefToNewId)) {
          const zipEntry = zip.file(zipPath);
          if (!zipEntry) continue;
          const blob = await zipEntry.async('blob');
          const meta = manifest.mediaIndex?.[zipPath];
          const record: MediaFileRecord = {
            id: newId,
            stageId: newStageId,
            type: meta?.mimeType?.startsWith('video/') ? 'video' : 'image',
            blob,
            mimeType: meta?.mimeType || 'image/jpeg',
            size: meta?.size || blob.size,
            prompt: meta?.prompt || '',
            params: '',
            createdAt: now,
          };

          const posterPath = zipPath.replace(/\.\w+$/, '.poster.jpg');
          const posterEntry = zip.file(posterPath);
          if (posterEntry) {
            record.poster = await posterEntry.async('blob');
          }

          await db.mediaFiles.put(record);
        }

        setPhase('writingCourse');
        toast.loading(t('import.writingCourse'), { id: toastId });

        // Write stage shell
        await db.stages.put({
          id: newStageId,
          name: manifest.stage.name || 'Imported Classroom',
          description: manifest.stage.description,
          language: manifest.stage.language,
          style: manifest.stage.style,
          createdAt: manifest.stage.createdAt || now,
          updatedAt: now,
          agentIds: newAgentIds.length > 0 ? newAgentIds : undefined,
        });

        if (manifest.agents?.length) {
          const agentRecords: GeneratedAgentRecord[] = manifest.agents.map((agent, index) => ({
            id: newAgentIds[index],
            stageId: newStageId,
            name: agent.name,
            role: agent.role,
            persona: agent.persona,
            avatar: agent.avatar,
            color: agent.color,
            priority: agent.priority,
            createdAt: now,
          }));
          await db.generatedAgents.bulkPut(agentRecords);
        }

        const sceneRecords = manifest.scenes.map((scene: ManifestScene, index) => {
          const newSceneId = nanoid();
          const actions = scene.actions
            ? rewriteAudioRefsToIds(scene.actions, audioRefToNewId)
            : undefined;

          return {
            id: newSceneId,
            stageId: newStageId,
            type: scene.type,
            title: scene.title,
            order: scene.order ?? index,
            content: scene.content,
            actions,
            whiteboard: scene.whiteboards,
            // Preserve multi-agent metadata if present
            ...(scene.multiAgent
              ? {
                  multiAgent: {
                    enabled: scene.multiAgent.enabled,
                    agentIds: (scene.multiAgent.agentIndices ?? [])
                      .map((idx) => newAgentIds[idx])
                      .filter(Boolean),
                    directorPrompt: scene.multiAgent.directorPrompt,
                  },
                }
              : {}),
            createdAt: now,
            updatedAt: now,
          };
        });
        await db.scenes.bulkPut(sceneRecords);

        setPhase('done');
        toast.success(t('import.success'), { id: toastId });
        onSuccess?.();
      } catch (error) {
        log.error('Classroom ZIP import failed:', error);
        const isQuotaError = error instanceof DOMException && error.name === 'QuotaExceededError';
        toast.error(t(isQuotaError ? 'import.error.storageFull' : 'import.error.invalidZip'), {
          id: toastId,
        });
      } finally {
        setImporting(false);
        setPhase('idle');
      }
    },
    [t, onSuccess],
  );

  return {
    importing,
    phase,
    fileInputRef,
    triggerFileSelect,
    handleFileChange,
  };
}
