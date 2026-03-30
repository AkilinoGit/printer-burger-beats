import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Gestión de sesión del día (apertura, cierre, location activo)
// TODO: implement in next phase
export default function SessionScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Sesión del día</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
