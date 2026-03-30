import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

// Revisión del ticket activo — COBRAR / AÑADIR OTRO / IMPRIMIR
// TODO: implement in next phase
export default function TicketScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text>Ticket {id}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
