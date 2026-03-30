import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { ActivityIndicator, PaperProvider } from 'react-native-paper';
import { initDb } from '../services/db';
import { useSessionStore } from '../stores/useSessionStore';

export default function RootLayout(): React.JSX.Element {
  const [dbReady, setDbReady] = useState(false);
  const loadTestMode = useSessionStore((s) => s.loadTestMode);

  useEffect(() => {
    initDb()
      .then(() => loadTestMode())
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('[DB] init failed:', err);
        // Still unblock UI so the error surfaces in screens
        setDbReady(true);
      });
  }, [loadTestMode]);

  if (!dbReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <PaperProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket' }} />
      </Stack>
    </PaperProvider>
  );
}
