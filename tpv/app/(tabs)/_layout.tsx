import React from 'react';
import { Tabs } from 'expo-router';

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs>
      <Tabs.Screen name="index"    options={{ title: 'Venta' }} />
      <Tabs.Screen name="session"  options={{ title: 'Sesión' }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes' }} />
    </Tabs>
  );
}
