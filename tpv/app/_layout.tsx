import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { ActivityIndicator, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { initDb } from '../services/db';
import { useSessionStore } from '../stores/useSessionStore';

const AUTO_CLOSE_CHECK_MS = 5 * 60 * 1000; // 5 minutes

export default function RootLayout(): React.JSX.Element {
  const [dbReady, setDbReady] = useState(false);
  const initSession    = useSessionStore((s) => s.initSession);
  const closeCurrentSession = useSessionStore((s) => s.closeCurrentSession);

  useEffect(() => {
    initDb()
      .then(() => initSession())
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('[DB] init failed:', err);
        setDbReady(true);
      });
  }, [initSession]);

  // Background check: auto-close expired sessions every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const session = useSessionStore.getState().activeSession;
      if (!session?.autoCloseAt) return;
      if (new Date(session.autoCloseAt) <= new Date()) {
        closeCurrentSession().catch(() => {/* silently ignore */});
      }
    }, AUTO_CLOSE_CHECK_MS);
    return () => clearInterval(interval);
  }, [closeCurrentSession]);

  if (!dbReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <PaperProvider theme={MD3LightTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Sesión' }} />
        <Stack.Screen name="session/summary/[id]" options={{ title: 'Resumen de sesión' }} />
      </Stack>
    </PaperProvider>
  );
}
