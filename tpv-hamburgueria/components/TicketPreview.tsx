import React from 'react';
import { View } from 'react-native';
import type { Ticket } from '../lib/types';

interface Props {
  ticket: Ticket;
}

// TODO: implement ticket preview (all orders grouped by client)
export default function TicketPreview(_props: Props): React.JSX.Element {
  return <View />;
}
