'use client';

import { useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  DEFAULT_USER_AVATAR,
  useUserProfileStore,
} from '@/lib/store/user-profile';

const log = createLogger('UserProfileInit');
const LEGACY_PROFILE_STORAGE_KEY = 'user-profile-storage';

type ProfileSnapshot = {
  avatar: string;
  nickname: string;
  bio: string;
};

function normalizeProfile(input?: Partial<ProfileSnapshot> | null): ProfileSnapshot {
  return {
    avatar:
      typeof input?.avatar === 'string' && input.avatar.trim()
        ? input.avatar
        : DEFAULT_USER_AVATAR,
    nickname: typeof input?.nickname === 'string' ? input.nickname : '',
    bio: typeof input?.bio === 'string' ? input.bio : '',
  };
}

function readLegacyLocalProfile(): ProfileSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const source =
      parsed && typeof parsed === 'object' && 'state' in parsed
        ? ((parsed as { state?: Partial<ProfileSnapshot> }).state ?? undefined)
        : ((parsed as Partial<ProfileSnapshot>) ?? undefined);
    const normalized = normalizeProfile(source);
    const hasValue =
      normalized.avatar !== DEFAULT_USER_AVATAR ||
      normalized.nickname.trim().length > 0 ||
      normalized.bio.trim().length > 0;
    return hasValue ? normalized : null;
  } catch {
    return null;
  }
}

function clearLegacyLocalProfile() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getProfileFromUser(user: User | null): ProfileSnapshot {
  return normalizeProfile({
    avatar: user?.user_metadata?.avatar,
    nickname: user?.user_metadata?.nickname,
    bio: user?.user_metadata?.bio,
  });
}

function getProfileSignature(profile: ProfileSnapshot) {
  return JSON.stringify(profile);
}

export function UserProfileInit() {
  const supabaseClient = getSupabaseClient();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setProfile = useUserProfileStore((s) => s.setProfile);
  const resetProfile = useUserProfileStore((s) => s.resetProfile);

  const currentUserRef = useRef<User | null>(null);
  const lastSyncedRef = useRef<string>('');
  const readyToSaveRef = useRef(false);

  useEffect(() => {
    if (!supabaseClient) {
      resetProfile();
      return;
    }

    let active = true;

    const applyUser = async (user: User | null) => {
      if (!active) return;

      currentUserRef.current = user;
      readyToSaveRef.current = false;

      if (!user) {
        resetProfile();
        lastSyncedRef.current = '';
        clearLegacyLocalProfile();
        readyToSaveRef.current = true;
        return;
      }

      let normalized = getProfileFromUser(user);
      const legacyProfile = readLegacyLocalProfile();
      const cloudIsEmpty =
        normalized.avatar === DEFAULT_USER_AVATAR &&
        !normalized.nickname.trim() &&
        !normalized.bio.trim();

      if (legacyProfile && cloudIsEmpty) {
        normalized = legacyProfile;
        try {
          const { data, error } = await supabaseClient.auth.updateUser({
            data: {
              ...user.user_metadata,
              avatar: legacyProfile.avatar,
              nickname: legacyProfile.nickname,
              bio: legacyProfile.bio,
            },
          });
          if (!error && data.user) {
            currentUserRef.current = data.user;
          }
        } catch (error) {
          log.error('Failed to migrate legacy local profile:', error);
        }
      }

      setProfile(normalized);
      lastSyncedRef.current = getProfileSignature(normalized);
      clearLegacyLocalProfile();
      readyToSaveRef.current = true;
    };

    supabaseClient.auth.getUser().then(({ data, error }) => {
      if (error) log.error('Failed to load user for profile init:', error);
      void applyUser(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      void applyUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [resetProfile, setProfile, supabaseClient]);

  useEffect(() => {
    if (!supabaseClient || !currentUserRef.current || !readyToSaveRef.current) return;

    const normalized = normalizeProfile({ avatar, nickname, bio });
    const nextSignature = getProfileSignature(normalized);
    if (nextSignature === lastSyncedRef.current) return;

    const timer = window.setTimeout(async () => {
      const currentUser = currentUserRef.current;
      if (!currentUser) return;

      try {
        const { data, error } = await supabaseClient.auth.updateUser({
          data: {
            ...currentUser.user_metadata,
            avatar: normalized.avatar,
            nickname: normalized.nickname,
            bio: normalized.bio,
          },
        });
        if (error) {
          log.error('Failed to save user profile:', error);
          return;
        }
        if (data.user) {
          currentUserRef.current = data.user;
        }
        lastSyncedRef.current = nextSignature;
        clearLegacyLocalProfile();
      } catch (error) {
        log.error('Failed to save user profile:', error);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [avatar, bio, nickname, supabaseClient]);

  return null;
}
