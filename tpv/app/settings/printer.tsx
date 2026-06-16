import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Divider,
  IconButton,
  List,
  Portal,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import {
  clearPairedPrinter,
  connectPrinter,
  getPairedPrinter,
  isPrinterConnected,
  printTest,
  scanPrinters,
  setAlias,
  setPairedPrinter,
  type PrinterDevice,
} from '../../services/printer';

/** Etiqueta a mostrar: alias del usuario si existe, si no el nombre Bluetooth. */
function labelOf(d: PrinterDevice): string {
  return d.alias && d.alias.trim() ? d.alias : d.name;
}

export default function PrinterSettingsScreen(): React.JSX.Element {
  const [paired, setPaired]     = useState<PrinterDevice | null>(null);
  const [devices, setDevices]   = useState<PrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [connected, setConnected] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);

  // Edición de alias
  const [editTarget, setEditTarget] = useState<PrinterDevice | null>(null);
  const [aliasInput, setAliasInput] = useState('');

  const reloadPaired = useCallback(async () => {
    const p = await getPairedPrinter();
    setPaired(p);
    setConnected(p ? await isPrinterConnected() : false);
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
    if (connectingAddress) return; // ya hay una conexión en curso
    setConnectingAddress(device.address);
    try {
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
      Alert.alert('Impresora conectada', `${labelOf(device)}\n${device.address}`);
    } finally {
      setConnectingAddress(null);
    }
  }, [connectingAddress, reloadPaired]);

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
      await reloadPaired(); // refleja el estado real de conexión tras el intento
    }
  }, [reloadPaired]);

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

  const openEdit = useCallback((d: PrinterDevice) => {
    setEditTarget(d);
    setAliasInput(d.alias ?? '');
  }, []);

  const saveAlias = useCallback(async () => {
    if (!editTarget) return;
    const target = editTarget;
    const value = aliasInput.trim();
    await setAlias(target.address, value);
    setEditTarget(null);
    setDevices((prev) =>
      prev.map((x) =>
        x.address === target.address ? { ...x, alias: value || undefined } : x,
      ),
    );
    await reloadPaired();
  }, [editTarget, aliasInput, reloadPaired]);

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
                <Text style={styles.currentName}>{labelOf(paired)}</Text>
                <Text style={styles.currentAddress}>{paired.address}</Text>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: connected ? '#43A047' : '#BDBDBD' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      { color: connected ? '#43A047' : '#999' },
                    ]}
                  >
                    {connected ? 'Conectada' : 'Desconectada'}
                  </Text>
                </View>
              </View>
              <IconButton
                icon="pencil"
                size={22}
                onPress={() => openEdit(paired)}
                accessibilityLabel="Editar nombre"
              />
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
                {testing ? 'Conectando…' : 'Imprimir prueba'}
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
          disabled={scanning || connectingAddress !== null}
          style={styles.scanBtn}
          buttonColor="#1E88E5"
        >
          Buscar emparejadas
        </Button>

        {devices.length > 0 && <Divider />}

        {devices.map((d, idx) => {
          const isConnecting = connectingAddress === d.address;
          const isPaired = paired?.address === d.address;
          return (
            <React.Fragment key={d.address}>
              {idx > 0 && <Divider />}
              <List.Item
                title={labelOf(d)}
                description={isConnecting ? 'Conectando…' : d.address}
                disabled={connectingAddress !== null}
                left={(props) => <List.Icon {...props} icon="printer" />}
                right={() => (
                  <View style={styles.itemRight}>
                    {isConnecting ? (
                      <ActivityIndicator size={20} style={styles.itemRightIcon} />
                    ) : isPaired ? (
                      <List.Icon icon="check-circle" color="#43A047" />
                    ) : null}
                    <IconButton
                      icon="pencil"
                      size={20}
                      disabled={connectingAddress !== null}
                      onPress={() => openEdit(d)}
                      accessibilityLabel="Editar nombre"
                    />
                  </View>
                )}
                onPress={() => void handleSelect(d)}
              />
            </React.Fragment>
          );
        })}
      </Surface>

      <Text style={styles.hint}>
        Las impresoras térmicas Bluetooth deben emparejarse primero desde los
        Ajustes Bluetooth de Android. Aquí solo se muestran los dispositivos
        ya emparejados con el teléfono. Usa el lápiz para ponerles un nombre
        propio (ej. “Cocina”, “Barra”) y distinguirlas.
      </Text>

      {/* ── Diálogo de edición de alias ───────────────────────────────── */}
      <Portal>
        <Dialog visible={editTarget !== null} onDismiss={() => setEditTarget(null)}>
          <Dialog.Title>Nombre de la impresora</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogMac}>{editTarget?.address}</Text>
            <TextInput
              mode="outlined"
              label="Nombre"
              value={aliasInput}
              onChangeText={setAliasInput}
              placeholder={editTarget?.name}
              autoFocus
            />
            <Text style={styles.dialogHint}>
              Déjalo vacío para volver al nombre original del dispositivo.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditTarget(null)}>Cancelar</Button>
            <Button onPress={() => void saveAlias()}>Guardar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
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

  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemRightIcon: {
    marginHorizontal: 12,
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

  dialogMac: {
    fontSize: 13,
    color: '#666',
    marginBottom: 10,
  },
  dialogHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    lineHeight: 16,
  },
});
