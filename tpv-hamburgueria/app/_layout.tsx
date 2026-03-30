import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket' }} />
    </Stack>
  );
}
