import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Pantalla principal — selección de productos y toma de pedidos
// TODO: implement in next phase
export default function HomeScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Selección de productos</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
