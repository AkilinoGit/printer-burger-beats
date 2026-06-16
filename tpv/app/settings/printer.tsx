import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  List,
  Surface,
  Text,
} from 'react-native-paper';

import {
  clearPairedPrinter,
  connectPrinter,
  getPairedPrinter,
  printTest,
  scanPrinters,
  setPairedPrinter,
  type PrinterDevice,
} from '../../services/printer';

export default function PrinterSettingsScreen(): React.JSX.Element {
  const [paired, setPaired]     = useState<PrinterDevice | null>(null);
  const [devices, setDevices]   = useState<PrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting]   = useState(false);
  const [loading, setLoading]   = useState(true);

  const reloadPaired = useCallback(async () => {
    const p = await getPairedPrinter();
    setPaired(p);
  }, []);

  useEffect(() => {
    void (async () => {
      await reloadPaired();
      setLoading(false);
    })();
  }, [reloadPaired]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await scanPrinters();
      if (!result.ok) {
        if (result.blocked) {
          Alert.alert(
            'Permisos bloqueados',
            'Has denegado los permisos Bluetooth de forma permanente.\n\nAbre los Ajustes del sistema → Permisos → Dispositivos cercanos (o Ubicación en Android 11 o anterior) y concédelos manualmente.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Abrir Ajustes', onPress: () => void Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert('Error', result.error ?? 'No se pudieron listar dispositivos.');
        }
        setDevices([]);
        return;
      }
      setDevices(result.devices);
      if (result.devices.length === 0) {
        Alert.alert(
          'Sin dispositivos',
          'No se encontraron impresoras emparejadas.\n\nPrimero empareja la impresora desde los Ajustes Bluetooth de Android y vuelve aquí.',
        );
      }
    } finally {
      setScanning(false);
    }
  }, []);

  const handleSelect = useCallback(async (device: PrinterDevice) => {
    const connectResult = await connectPrinter(device.address);
    if (!connectResult.ok) {
      Alert.alert(
        'No se pudo conectar',
        connectResult.error ?? 'Comprueba que la impresora está encendida y al alcance.',
      );
      return;
    }
    await setPairedPrinter(device);
    await reloadPaired();
    Alert.alert('Impresora seleccionada', `${device.name}\n${device.address}`);
  }, [reloadPaired]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const result = await printTest();
      if (result.ok) {
        Alert.alert('OK', 'Prueba enviada a la impresora.');
      } else if (!result.cancelled) {
        Alert.alert('Error al imprimir', result.error ?? 'Fallo desconocido.');
      }
    } finally {
      setTesting(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    Alert.alert(
      'Quitar impresora',
      '¿Olvidar la impresora actual? Tendrás que volver a seleccionarla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            await clearPairedPrinter();
            await reloadPaired();
          },
        },
      ],
    );
  }, [reloadPaired]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>

      {/* ── Estado actual ─────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>IMPRESORA ACTUAL</Text>
      <Surface style={styles.card} elevation={1}>
        {paired ? (
          <>
            <View style={styles.currentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.currentName}>{paired.name}</Text>
                <Text style={styles.currentAddress}>{paired.address}</Text>
              </View>
            </View>
            <Divider />
            <View style={styles.currentActions}>
              <Button
                mode="contained"
                icon="printer-check"
                onPress={() => void handleTest()}
                loading={testing}
                disabled={testing}
                buttonColor="#43A047"
                style={styles.actionBtn}
              >
                Imprimir prueba
              </Button>
              <Button
                mode="outlined"
                icon="link-off"
                onPress={() => void handleClear()}
                textColor="#E53935"
                style={styles.actionBtn}
              >
                Quitar
              </Button>
            </View>
          </>
        ) : (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>
              No hay impresora seleccionada. Empareja una desde los Ajustes
              Bluetooth de Android y luego pulsa “Buscar emparejadas”.
            </Text>
          </View>
        )}
      </Surface>

      {/* ── Selección ─────────────────────────────────────────────────── */}
      <Text variant="labelLarge" style={styles.sectionLabel}>SELECCIONAR IMPRESORA</Text>
      <Surface style={styles.card} elevation={1}>
        <Button
          mode="contained"
          icon="bluetooth"
          onPress={() => void handleScan()}
          loading={scanning}
          disabled={scanning}
          style={styles.scanBtn}
          buttonColor="#1E88E5"
        >
          Buscar emparejadas
        </Button>

        {devices.length > 0 && <Divider />}

        {devices.map((d, idx) => (
          <React.Fragment key={d.address}>
            {idx > 0 && <Divider />}
            <List.Item
              title={d.name}
              description={d.address}
              left={(props) => <List.Icon {...props} icon="printer" />}
              right={() =>
                paired?.address === d.address ? (
                  <List.Icon icon="check-circle" color="#43A047" />
                ) : null
              }
              onPress={() => void handleSelect(d)}
            />
          </React.Fragment>
        ))}
      </Surface>

      <Text style={styles.hint}>
        Las impresoras térmicas Bluetooth deben emparejarse primero desde los
        Ajustes Bluetooth de Android. Aquí solo se muestran los dispositivos
        ya emparejados con el teléfono.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#f5f5f5' },
  scrollContent: { padding: 16, paddingBottom: 48, gap: 8 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },

  card: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },

  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  currentName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  currentAddress: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  currentActions: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
  },

  emptyRow: { padding: 16 },
  emptyText: { fontSize: 14, color: '#666', lineHeight: 20 },

  scanBtn: {
    borderRadius: 8,
    margin: 12,
  },

  hint: {
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 6,
    paddingTop: 8,
    lineHeight: 17,
  },
});
