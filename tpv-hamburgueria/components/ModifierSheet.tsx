import React from 'react';
import { View } from 'react-native';
import type { Modifier, Product } from '../lib/types';

interface Props {
  product: Product | null;
  visible: boolean;
  onConfirm: (selectedModifiers: string[]) => void;
  onDismiss: () => void;
}

// TODO: implement bottom sheet for burger modifiers
export default function ModifierSheet(_props: Props): React.JSX.Element {
  return <View />;
}
