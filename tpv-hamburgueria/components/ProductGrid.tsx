import React from 'react';
import { View } from 'react-native';
import type { Product } from '../lib/types';

interface Props {
  products: Product[];
  onSelect: (product: Product) => void;
}

// TODO: implement grid UI with react-native-paper
export default function ProductGrid(_props: Props): React.JSX.Element {
  return <View />;
}
