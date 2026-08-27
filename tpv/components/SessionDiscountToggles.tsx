// Interruptores excluyentes 15 / 30 de la jornada. Se usan al abrir la sesión
// (al final del diálogo de precios, fuera de la vista inicial) y al editarla.
// Deliberadamente sin título ni texto explicativo.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, Switch, Text, TouchableRipple } from 'react-native-paper';

import type { SessionDiscountPct } from '../lib/types';

const OPTIONS: Array<Exclude<SessionDiscountPct, 0>> = [15, 30];

interface Props {
  value: SessionDiscountPct;
  onChange: (pct: SessionDiscountPct) => void;
  disabled?: boolean;
}

export default function SessionDiscountToggles({ value, onChange, disabled }: Props): React.JSX.Element {
  return (
    <View style={styles.card}>
      {OPTIONS.map((pct, i) => (
        <React.Fragment key={pct}>
          {i > 0 && <Divider />}
          <TouchableRipple
            onPress={() => onChange(value === pct ? 0 : pct)}
            disabled={disabled}
            rippleColor="rgba(0,0,0,0.06)"
          >
            <View style={styles.row}>
              <Text style={styles.label}>{pct}</Text>
              <Switch
                value={value === pct}
                onValueChange={() => onChange(value === pct ? 0 : pct)}
                disabled={disabled}
                color="#43A047"
              />
            </View>
          </TouchableRipple>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e2e2',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: { fontSize: 16, fontWeight: '700', color: '#222' },
});
