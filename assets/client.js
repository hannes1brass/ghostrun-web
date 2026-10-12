// Shared Supabase client for the login page and the personal page.
// The publishable key is meant to be public; RLS protects the data.
(function () {
  'use strict';
  const SUPABASE_URL = 'https://mrxylbwvetmeyruqlglp.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_OjiYXgKzG9k6A20s7tQofA_DQIEfny9';
  // PKCE: Google redirects back with ?code=..., which supabase-js exchanges for a session.
  window.ghostrunClient = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
  });
})();
