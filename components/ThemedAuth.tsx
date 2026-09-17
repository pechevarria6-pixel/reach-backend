'use client';
import { SignIn, SignUp } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { clerkAppearance } from '@/lib/clerk-appearance';

// The shell stamps a stored theme onto <html> before first paint, and leaves
// the attribute off for the light default. Clerk draws its widget only in the
// browser, after this has run, so the widget never appears in the wrong
// palette first.
function useShellTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }, []);
  return theme;
}

export function ThemedSignIn() {
  return <SignIn appearance={clerkAppearance[useShellTheme()]} />;
}

export function ThemedSignUp() {
  return <SignUp appearance={clerkAppearance[useShellTheme()]} />;
}
