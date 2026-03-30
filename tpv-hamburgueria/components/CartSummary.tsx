import React from 'react';
import { View } from 'react-native';
import type { OrderItem } from '../lib/types';

interface Props {
  items: OrderItem[];
  clientName: string;
  total: number;
}

// TODO: implement cart summary UI
export default function CartSummary(_props: Props): React.JSX.Element {
  return <View />;
}
