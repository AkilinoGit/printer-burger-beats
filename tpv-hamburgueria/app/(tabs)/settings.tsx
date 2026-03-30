import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Ajustes: modo prueba, sync manual, precios por sesión, impresora BT
// TODO: implement in next phase
export default function SettingsScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Ajustes</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
