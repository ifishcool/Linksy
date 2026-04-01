/**
 * Supabase Client Configuration
 *
 * Provides a singleton Supabase client for the browser
 * with proper TypeScript types and error handling
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are not set. Please check your .env.local file.');
}

// Create singleton client
let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseClient() {
  if (!supabaseInstance && supabaseUrl && supabaseAnonKey) {
    supabaseInstance = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 2,
        },
      },
      global: {
        headers: {
          'x-application-name': 'linksy-classroom',
        },
      },
    });
  }
  return supabaseInstance;
}

// Export default client for convenience
export const supabase = getSupabaseClient();

// Helper to check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}
