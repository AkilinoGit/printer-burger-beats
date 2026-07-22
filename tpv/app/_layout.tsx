import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { ActivityIndicator, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { initDb } from '../services/db';
import { useSessionStore } from '../stores/useSessionStore';
import { useTextPresetsStore } from '../stores/useTextPresetsStore';
import { isSessionStale } from '../lib/utils';
import PrintOverlay from '../components/PrintOverlay';

const AUTO_CLOSE_CHECK_MS = 5 * 60 * 1000; // 5 minutes

export default function RootLayout(): React.JSX.Element {
  const [dbReady, setDbReady] = useState(false);
  const initSession    = useSessionStore((s) => s.initSession);
  const closeCurrentSession = useSessionStore((s) => s.closeCurrentSession);

  useEffect(() => {
    initDb()
      .then(() => initSession())
      .then(() => {
        // Carga presets de texto (mensajes de ticket + batería de nombres) para
        // que la impresión y el autorrelleno de nombre los tengan disponibles.
        void useTextPresetsStore.getState().load();
      })
      .then(async () => {
        // Option C: if the session loaded at startup is already stale (>20h),
        // close it before showing the app so the user starts fresh.
        // One retry after 800ms if the first attempt fails.
        const session = useSessionStore.getState().activeSession;
        if (session && isSessionStale(session.openedAt)) {
          try {
            await closeCurrentSession();
          } catch {
            try {
              await new Promise<void>((r) => setTimeout(r, 800));
              await closeCurrentSession();
            } catch {
              // Both attempts failed — Option A dialog in the sales screen will
              // warn the user and let them retry manually.
            }
          }
        }
      })
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('[DB] init failed:', err);
        setDbReady(true);
      });
  }, [initSession, closeCurrentSession]);

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
        <Stack.Screen name="session/edit/[id]" options={{ title: 'Editar sesión' }} />
        <Stack.Screen name="session/merge/[id]" options={{ title: 'Fusionar sesión' }} />
        <Stack.Screen name="session/summary/[id]" options={{ title: 'Resumen de sesión' }} />
        <Stack.Screen name="sessions-history" options={{ title: 'Historial de sesiones' }} />
        <Stack.Screen name="settings/printer" options={{ title: 'Ajustes de impresora' }} />
        <Stack.Screen name="settings/mensajes" options={{ title: 'Mensajes y nombres' }} />
      </Stack>
      <PrintOverlay />
    </PaperProvider>
  );
}
