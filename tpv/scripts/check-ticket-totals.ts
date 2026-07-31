// Renderiza el ticket ESC/POS a texto plano para comprobar que los importes
// impresos cuadran con lo que cobra la caja (order.total).
import { buildTicketBuffer } from '../services/escpos';
import type { Order, Ticket } from '../lib/types';

const decode = (b: Uint8Array): string =>
  Buffer.from(b).toString('latin1').replace(/[\x00-\x09\x0B-\x1F]/g, '');

const item = (productId: string, qty: number, unitPrice: number) => ({
  id: 'i-' + productId, orderId: 'o1', productId, productName: productId.toUpperCase(),
  qty, unitPrice, modifierPriceAdd: 0, selectedModifiers: [], customLabel: null,
});

const mkTicket = (order: Partial<Order>, items: ReturnType<typeof item>[]): Ticket => ({
  id: 't1', sessionId: 's1', ticketNumber: 7, deviceId: 'd1',
  printedAt: null, syncStatus: 'pending', createdAt: new Date().toISOString(),
  editedAt: null, editCount: 0, source: 'web', webOrderId: 'w1',
  orders: [{
    id: 'o1', ticketId: 't1', clientName: 'ANA', priceProfile: 'normal',
    items, amountPaid: null, change: null, total: 0,
    createdAt: new Date().toISOString(), ...order,
  } as Order],
});

let pass = 0, fail = 0;
const chk = (label: string, cond: boolean, extra = '') => {
  if (cond) { console.log('  OK   ' + label); pass++; }
  else { console.log('  FAIL ' + label + (extra ? '\n' + extra : '')); fail++; }
};

const normalPrices = { alitas: 8 };

// 1. BESITOS: 2x8 = 16, menos 12 => 4
let txt = decode(buildTicketBuffer(
  mkTicket({ total: 4, discountAmount: 12, discountLabel: 'Descuento BESITOS' }, [item('alitas', 2, 8)]),
  false, {}, false, normalPrices,
));
console.log('--- BESITOS ---\n' + txt.split('\n').filter((l) => /TOTAL|DESCUENTO|BESITOS|ALITAS/.test(l)).join('\n'));
chk('imprime la resta del descuento fijo', /-12\.00/.test(txt), txt);
chk('el total impreso coincide con lo que cobra la caja (4.00)', /TOTAL CON DTO[.\-]*4\.00/.test(txt), txt);

// 2. FERIANTE: 2 alitas a 6 (normal 8) => 12, sin descuento fijo
txt = decode(buildTicketBuffer(
  mkTicket({ priceProfile: 'feriante', total: 12 }, [item('alitas', 2, 6)]),
  false, {}, false, normalPrices,
));
console.log('--- FERIANTE ---\n' + txt.split('\n').filter((l) => /TOTAL|DESCUENTO/.test(l)).join('\n'));
chk('feriante: descuento por linea', /-4\.00/.test(txt), txt);
chk('feriante: total 12.00', /TOTAL CON DTO[.\-]*12\.00/.test(txt), txt);

// 3. Los dos: feriante (12) menos 12 => 0
txt = decode(buildTicketBuffer(
  mkTicket({ priceProfile: 'feriante', total: 0, discountAmount: 12, discountLabel: 'Descuento BESITOS' }, [item('alitas', 2, 6)]),
  false, {}, false, normalPrices,
));
console.log('--- FERIANTE + BESITOS ---\n' + txt.split('\n').filter((l) => /TOTAL|DESCUENTO|BESITOS/.test(l)).join('\n'));
chk('combinado: total 0.00', /TOTAL CON DTO[.\-]*0\.00/.test(txt), txt);

// 4. Comentario para cocina
txt = decode(buildTicketBuffer(
  mkTicket({ total: 16, notes: 'sin cebolla y muy hecha' }, [item('alitas', 2, 8)]),
  false, {}, false, normalPrices,
));
chk('imprime la nota de cocina', /NOTA:/.test(txt) && /sin cebolla/.test(txt), txt);
chk('sin descuento no imprime TOTAL CON DTO', !/TOTAL CON DTO/.test(txt), txt);

// 5. Pedido web marcado como tal
chk('cabecera PEDIDO WEB', /PEDIDO WEB/.test(txt), txt);

console.log(`\nRESULTADO: ${pass} OK / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
