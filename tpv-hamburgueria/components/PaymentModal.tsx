import React from 'react';
import { View } from 'react-native';

interface Props {
  visible: boolean;
  total: number;
  onConfirm: (amountPaid: number, change: number) => void;
  onDismiss: () => void;
}

// TODO: implement payment modal (input amount paid, show change)
export default function PaymentModal(_props: Props): React.JSX.Element {
  return <View />;
}
