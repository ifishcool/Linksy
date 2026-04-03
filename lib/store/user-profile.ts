/**
 * User Profile Store
 * Keeps avatar, nickname & bio in memory.
 * Persistence is handled by Supabase auth user_metadata.
 */

import { create } from 'zustand';

/** Predefined avatar options */
export const AVATAR_OPTIONS = [
  '/avatars/user.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/clown-2.png',
  '/avatars/curious-2.png',
  '/avatars/note-taker-2.png',
  '/avatars/thinker-2.png',
] as const;

export const DEFAULT_USER_AVATAR = AVATAR_OPTIONS[0];

export interface UserProfileState {
  /** Avatar path or uploaded data URL */
  avatar: string;
  nickname: string;
  bio: string;
  setAvatar: (avatar: string) => void;
  setNickname: (nickname: string) => void;
  setBio: (bio: string) => void;
  setProfile: (profile: Partial<Pick<UserProfileState, 'avatar' | 'nickname' | 'bio'>>) => void;
  resetProfile: () => void;
}

export const useUserProfileStore = create<UserProfileState>()((set) => ({
  avatar: DEFAULT_USER_AVATAR,
  nickname: '',
  bio: '',
  setAvatar: (avatar) => set({ avatar }),
  setNickname: (nickname) => set({ nickname }),
  setBio: (bio) => set({ bio }),
  setProfile: (profile) => set((state) => ({ ...state, ...profile })),
  resetProfile: () =>
    set({
      avatar: DEFAULT_USER_AVATAR,
      nickname: '',
      bio: '',
    }),
}));
