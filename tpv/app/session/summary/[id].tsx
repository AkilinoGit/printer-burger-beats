import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Banner,
  Button,
  Divider,
  Surface,
  Text,
} from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';

import { getLocations, getSessions, getTicketsBySession } from '../../../services/db';
import { printSessionSummary } from '../../../services/printer';
import { formatPrice } from '../../../lib/utils';
import type { Location, Session, Ticket } from '../../../lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProductCategory = 'burger' | 'side' | 'drink' | 'custom';

interface ProductVariant {
  key:          string;
  priceProfile: string;
  mods:         string[];   // sorted relevant mod ids
  qty:          number;
  totalPrice:   number;
}

interface ProductGroup {
  productId:   string;
  productName: string;
  category:    ProductCategory;
  totalQty:    number;
  totalPrice:  number;
  variants:    ProductVariant[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: ProductCategory[] = ['burger', 'side', 'drink', 'custom'];

const PRODUCT_CATEGORY_MAP: Record<string, ProductCategory> = {
  'fat-furious':     'burger',
  'ben-muerde':      'burger',
  'doble-subwoofer': 'burger',
  'patatas':         'side',
  'alitas':          'side',
  'tekenos':         'side',
  'gyozas':          'side',
  'bebida':          'drink',
  'agua':            'drink',
  'burger-nino':     'custom',
  'otros':           'custom',
};

// IDs that are meaningful to show in variant sublabels.
// Modifier IDs in DB are stored as `${productId}-${modifierId}` for add/remove types.
// Radio option IDs are stored as-is (the optionId, not the modifierId).
const RELEVANT_MOD_IDS = new Set([
  // burger add/remove modifiers (productId-modifierId format)
  'fat-furious-mod_sin_gluten',     'fat-furious-sin-una-carne',    'fat-furious-extra-carne',
  'ben-muerde-mod_sin_gluten',      'ben-muerde-sin-una-carne',     'ben-muerde-extra-bacon',
  'doble-subwoofer-mod_sin_gluten', 'doble-subwoofer-sin-una-carne','doble-subwoofer-extra-bacon',
  'burger-nino-mod_sin_gluten',     'burger-nino-nino-bacon',       'burger-nino-nino-verdura',
  // patatas add modifiers (productId-modifierId format)
  'patatas-patatas-sin-nada', 'patatas-patatas-con-todo', 'patatas-patatas-ketchup',
  'patatas-patatas-mostaza-dulce', 'patatas-patatas-ali-oli',
  // radio option IDs (stored as-is, shared across alitas/tekenos/nino)
  'salsa-sin-nada', 'salsa-ketchup', 'salsa-ali-oli', 'salsa-mostaza',
  'salsa-fat', 'salsa-ben', 'salsa-doble', 'salsa-mango',
]);

const MOD_LABELS: Record<string, string> = {
  // burger modifiers
  'fat-furious-mod_sin_gluten':      'Sin Gluten',
  'fat-furious-sin-una-carne':       'Sin una carne',
  'fat-furious-extra-carne':         'Extra carne',
  'ben-muerde-mod_sin_gluten':       'Sin Gluten',
  'ben-muerde-sin-una-carne':        'Sin una carne',
  'ben-muerde-extra-bacon':          'Extra bacon',
  'doble-subwoofer-mod_sin_gluten':  'Sin Gluten',
  'doble-subwoofer-sin-una-carne':   'Sin una carne',
  'doble-subwoofer-extra-bacon':     'Extra bacon',
  'burger-nino-mod_sin_gluten':      'Sin Gluten',
  'burger-nino-nino-bacon':          'Bacon',
  'burger-nino-nino-verdura':        'Verdura',
  // patatas
  'patatas-patatas-sin-nada':        'Sin nada',
  'patatas-patatas-con-todo':        'Con todo',
  'patatas-patatas-ketchup':         'Ketchup',
  'patatas-patatas-mostaza-dulce':   'Mostaza dulce',
  'patatas-patatas-ali-oli':         'Ali Oli',
  // salsas radio (shared option IDs)
  'salsa-sin-nada':  'Sin nada',
  'salsa-ketchup':   'Ketchup',
  'salsa-ali-oli':   'Ali Oli',
  'salsa-mostaza':   'Mostaza',
  'salsa-fat':       'Fat',
  'salsa-ben':       'Ben',
  'salsa-doble':     'Doble',
  'salsa-mango':     'Mango',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ticketTotal(ticket: Ticket): number {
  return ticket.orders.reduce((sum, o) => sum + o.total, 0);
}

function variantLabel(priceProfile: string, mods: string[]): string {
  const parts: string[] = [];
  if (priceProfile === 'feriante')   parts.push('OFERTA');
  if (priceProfile === 'invitacion') parts.push('INVITACIÓN');
  for (const id of mods) {
    const l = MOD_LABELS[id];
    if (l) parts.push(l);
  }
  return parts.length > 0 ? parts.join(' + ') : 'Normal';
}

// ---------------------------------------------------------------------------
// Sauce summary
// ---------------------------------------------------------------------------

interface SauceTally {
  label: string;
  qty:   number;
}

// Patatas: which modifier IDs (with prefix) map to which sauce labels
const PATATAS_SAUCE_MAP: Record<string, string[]> = {
  'patatas-patatas-con-todo':      ['Ketchup', 'Ali Oli'],
  'patatas-patatas-ketchup':       ['Ketchup'],
  'patatas-patatas-mostaza-dulce': ['Mostaza'],
  'patatas-patatas-ali-oli':       ['Ali Oli'],
  // sin-nada → no sauce
};

// Burger products and their default sauce (counts unless sin-salsa is present)
const BURGER_DEFAULT_SAUCE: Record<string, string> = {
  'fat-furious':     'Fat',
  'ben-muerde':      'Ben',
  'doble-subwoofer': 'Doble',
};

// Radio option IDs → sauce label (shared by alitas, tekenos, burger-nino)
const RADIO_SAUCE_MAP: Record<string, string> = {
  'salsa-ketchup':  'Ketchup',
  'salsa-ali-oli':  'Ali Oli',
  'salsa-mostaza':  'Mostaza',
  'salsa-fat':      'Fat',
  'salsa-ben':      'Ben',
  'salsa-doble':    'Doble',
  'salsa-mango':    'Mango',
  // salsa-sin-nada → no sauce
};

// Products that use radio sauce
const RADIO_SAUCE_PRODUCTS = new Set(['alitas', 'tekenos', 'burger-nino']);

// Default sauce when no radio option is selected (Normal = su salsa habitual)
const DEFAULT_SAUCE_WHEN_NORMAL: Record<string, string> = {
  'alitas':  'Salsa Alitas',
  'tekenos': 'Mango',
  'gyozas':  'Soja',
};

function buildSauceSummary(tickets: Ticket[]): SauceTally[] {
  const tally = new Map<string, number>();

  function add(sauce: string, qty: number): void {
    tally.set(sauce, (tally.get(sauce) ?? 0) + qty);
  }

  for (const ticket of tickets) {
    for (const order of ticket.orders) {
      if (order.priceProfile === 'invitacion') continue;
      for (const item of order.items) {
        const mods = item.selectedModifiers;

        // Burgers with a default sauce
        if (BURGER_DEFAULT_SAUCE[item.productId]) {
          const hasSinSalsa = mods.some((id) => id.endsWith('-sin-salsa'));
          if (!hasSinSalsa) {
            add(BURGER_DEFAULT_SAUCE[item.productId], item.qty);
          }

        // Patatas: each selected add modifier maps to sauce(s)
        } else if (item.productId === 'patatas') {
          for (const modId of mods) {
            const sauces = PATATAS_SAUCE_MAP[modId];
            if (sauces) {
              for (const s of sauces) add(s, item.qty);
            }
          }

        // Alitas / Tekeños / Burger Niño: radio option
        } else if (RADIO_SAUCE_PRODUCTS.has(item.productId)) {
          const radioSauce = mods.map((id) => RADIO_SAUCE_MAP[id]).find(Boolean);
          if (radioSauce) {
            add(radioSauce, item.qty);
          } else if (!mods.includes('salsa-sin-nada')) {
            // No selection = Normal = su salsa por defecto
            const def = DEFAULT_SAUCE_WHEN_NORMAL[item.productId];
            if (def) add(def, item.qty);
          }

        // Gyozas: siempre soja salvo que no tenga salsa (no tiene radio, así que siempre)
        } else if (item.productId === 'gyozas') {
          const def = DEFAULT_SAUCE_WHEN_NORMAL['gyozas'];
          if (def) add(def, item.qty);
        }
      }
    }
  }

  // Order: Fat, Ben, Doble, Ketchup, Ali Oli, Mostaza, Mango
  const ORDER = ['Fat', 'Ben', 'Doble', 'Ketchup', 'Ali Oli', 'Mostaza', 'Mango'];
  return Array.from(tally.entries())
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'es');
    })
    .map(([label, qty]) => ({ label, qty }));
}

function buildProductGroups(tickets: Ticket[]): ProductGroup[] {
  const productMap = new Map<string, ProductGroup>();
  const variantMap = new Map<string, ProductVariant>();

  for (const ticket of tickets) {
    for (const order of ticket.orders) {
      for (const item of order.items) {
        const mods      = item.selectedModifiers.filter((id) => RELEVANT_MOD_IDS.has(id)).sort();
        const vKey      = `${item.productId}|${order.priceProfile}|${mods.join(',')}`;
        const linePrice = order.priceProfile === 'invitacion'
          ? 0
          : (item.unitPrice + item.modifierPriceAdd) * item.qty;

        // product total
        const pg = productMap.get(item.productId);
        if (pg) {
          pg.totalQty   += item.qty;
          pg.totalPrice += linePrice;
        } else {
          productMap.set(item.productId, {
            productId:   item.productId,
            productName: item.customLabel ?? item.productName,
            category:    PRODUCT_CATEGORY_MAP[item.productId] ?? 'custom',
            totalQty:    item.qty,
            totalPrice:  linePrice,
            variants:    [],
          });
        }

        // variant total
        const vt = variantMap.get(vKey);
        if (vt) {
          vt.qty        += item.qty;
          vt.totalPrice += linePrice;
        } else {
          variantMap.set(vKey, { key: vKey, priceProfile: order.priceProfile, mods, qty: item.qty, totalPrice: linePrice });
        }
      }
    }
  }

  // attach variants to their product group
  for (const [vKey, vt] of variantMap) {
    productMap.get(vKey.split('|')[0])?.variants.push(vt);
  }

  // sort variants: normal first, then feriante/invitacion; fewer mods first within same profile
  const profileOrd: Record<string, number> = { normal: 0, feriante: 1, invitacion: 2 };
  for (const g of productMap.values()) {
    g.variants.sort((a, b) => {
      const pd = (profileOrd[a.priceProfile] ?? 0) - (profileOrd[b.priceProfile] ?? 0);
      return pd !== 0 ? pd : a.mods.length - b.mods.length;
    });
  }

  // sort groups by category then name
  return Array.from(productMap.values()).sort((a, b) => {
    const cd = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return cd !== 0 ? cd : a.productName.localeCompare(b.productName, 'es');
  });
}

// ---------------------------------------------------------------------------
// ProductGroupCard
// ---------------------------------------------------------------------------

function ProductGroupCard({ group }: { group: ProductGroup }): React.JSX.Element {
  // Always show variants for sides (patatas, alitas, etc.) since every
  // combination of sauces/extras is meaningful even when there is only one.
  // For other categories, only show when there are multiple variants or a
  // non-plain-normal single variant.
  const showVariants = group.variants.length > 0 && (
    group.category === 'side' ||
    group.variants.length > 1 || (
      group.variants[0].priceProfile !== 'normal' ||
      group.variants[0].mods.length > 0
    )
  );

  return (
    <Surface style={cardStyles.card} elevation={1}>
      {/* Main product row */}
      <View style={cardStyles.mainRow}>
        <Text style={cardStyles.mainQty}>x{group.totalQty}</Text>
        <Text style={cardStyles.mainName} numberOfLines={2}>{group.productName}</Text>
        <Text style={cardStyles.mainPrice}>{formatPrice(group.totalPrice)}</Text>
      </View>

      {/* Variant sublíneas */}
      {showVariants && group.variants.map((v) => (
        <View key={v.key} style={cardStyles.variantRow}>
          <Text style={cardStyles.variantQty}>x{v.qty}</Text>
          <Text style={cardStyles.variantLabel}>{variantLabel(v.priceProfile, v.mods)}</Text>
          <Text style={cardStyles.variantPrice}>{formatPrice(v.totalPrice)}</Text>
        </View>
      ))}
    </Surface>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius:      10,
    backgroundColor:   '#fff',
    paddingHorizontal: 14,
    paddingVertical:   10,
    gap:               4,
  },
  mainRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mainQty:    { fontSize: 17, fontWeight: '800', color: '#111', minWidth: 38 },
  mainName:   { flex: 1, fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  mainPrice:  { fontSize: 16, fontWeight: '700', color: '#1565C0', textAlign: 'right' },
  variantRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 38, gap: 8 },
  variantQty:   { fontSize: 13, fontWeight: '600', color: '#666', minWidth: 28 },
  variantLabel: { flex: 1, fontSize: 13, color: '#666' },
  variantPrice: { fontSize: 13, fontWeight: '600', color: '#999', textAlign: 'right' },
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SessionSummaryScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [session,  setSession]  = useState<Session | null>(null);
  const [tickets,  setTickets]  = useState<Ticket[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) { setError('ID de sesión no válido'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [allSessions, locs] = await Promise.all([getSessions(), getLocations()]);
      const found = allSessions.find((s) => s.id === id) ?? null;
      if (!found) { setError('Sesión no encontrada'); setLoading(false); return; }
      setSession(found);
      setLocation(locs.find((l) => l.id === found.locationId) ?? null);
      setTickets(await getTicketsBySession(found.id));
    } catch (e: unknown) {
      setError(`No se pudo cargar: ${e instanceof Error ? e.message : 'Error desconocido'}`);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handlePrint(): Promise<void> {
    if (!session) return;
    setPrinting(true);
    try {
      const result = await printSessionSummary(session, tickets, location?.name ?? '—');
      if (!result.ok) {
        Alert.alert('Error de impresión', result.error ?? 'No se pudo conectar con la impresora');
      }
    } finally {
      setPrinting(false);
    }
  }

  // ── loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  }
  if (error ?? !session) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Sesión no encontrada'}</Text>
      </View>
    );
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const isOpen     = session.status === 'open';
  const grandTotal = tickets.reduce((sum, t) => sum + ticketTotal(t), 0);
  const groups     = buildProductGroups(tickets);
  const sauces     = buildSauceSummary(tickets);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Active session banner */}
        {isOpen && (
          <Banner visible icon="information" style={styles.banner}>
            SESIÓN EN CURSO — resumen hasta ahora
          </Banner>
        )}

        {/* Summary header card */}
        <Surface style={[styles.headerCard, isOpen && styles.headerCardOpen]} elevation={2}>
          <Text style={styles.locationName}>{location?.name ?? '—'}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Apertura</Text>
              <Text style={styles.metaValue}>{formatDateTime(session.openedAt ?? session.createdAt)}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Tickets</Text>
              <Text style={styles.metaValue}>{tickets.length}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Total</Text>
              <Text style={[styles.metaValue, styles.totalBlue]}>{formatPrice(grandTotal)}</Text>
            </View>
          </View>
          {isOpen ? (
            <Text style={styles.note}>La sesión se cierra automáticamente mañana a las 12:00</Text>
          ) : session.closedAt != null ? (
            <Text style={styles.note}>Cerrada el {formatDateTime(session.closedAt)}</Text>
          ) : null}
        </Surface>

        {/* Product groups */}
        <Text style={styles.sectionLabel}>RESUMEN POR PRODUCTO</Text>

        {groups.length === 0 ? (
          <Text style={styles.emptyText}>No hay productos en esta sesión</Text>
        ) : (
          <>
            {groups.map((g) => (
              <ProductGroupCard key={g.productId} group={g} />
            ))}

            <Divider style={styles.divider} />

            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>TOTAL</Text>
              <Text style={styles.grandTotalAmount}>{formatPrice(grandTotal)}</Text>
            </View>
          </>
        )}

        {/* Sauce summary */}
        {sauces.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RESUMEN DE SALSAS</Text>
            <Surface style={styles.saucesCard} elevation={1}>
              {sauces.map((s) => (
                <View key={s.label} style={styles.sauceRow}>
                  <Text style={styles.sauceLabel}>{s.label}</Text>
                  <Text style={styles.sauceQty}>x{s.qty}</Text>
                </View>
              ))}
            </Surface>
          </>
        )}

        {/* Print button */}
        <Button
          mode="contained"
          icon="printer"
          onPress={() => void handlePrint()}
          loading={printing}
          disabled={printing}
          buttonColor="#E53935"
          contentStyle={styles.printBtnContent}
          labelStyle={styles.printBtnLabel}
          style={styles.printBtn}
        >
          Imprimir resumen
        </Button>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f5f5f5' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, color: '#C62828', textAlign: 'center' },
  scroll:  { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  banner: { backgroundColor: '#FFF9C4', marginBottom: 4 },

  headerCard: {
    borderRadius: 14, padding: 18,
    backgroundColor: '#fff', gap: 12,
  },
  headerCardOpen: { borderLeftWidth: 4, borderLeftColor: '#43A047' },
  locationName: { fontSize: 24, fontWeight: '800', color: '#111' },
  metaRow:  { flexDirection: 'row', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' },
  metaCol:  { gap: 2, minWidth: 70 },
  metaLabel: {
    fontSize: 11, color: '#888', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  metaValue:  { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  totalBlue:  { color: '#1565C0' },
  note: { fontSize: 12, color: '#888', fontStyle: 'italic' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    color: '#888', marginTop: 4, marginBottom: 2,
  },
  emptyText: {
    textAlign: 'center', color: '#bbb', fontStyle: 'italic',
    paddingVertical: 24, fontSize: 15,
  },

  divider:         { marginVertical: 8 },
  grandTotalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  grandTotalLabel: { fontSize: 14, fontWeight: '800', color: '#444', letterSpacing: 1 },
  grandTotalAmount:{ fontSize: 22, fontWeight: '900', color: '#1565C0' },

  printBtn:        { borderRadius: 10, marginTop: 8 },
  printBtnContent: { height: 56 },
  printBtnLabel:   { fontSize: 16, fontWeight: '700' },

  saucesCard: {
    borderRadius: 10, backgroundColor: '#fff',
    paddingHorizontal: 14, paddingVertical: 8,
  },
  sauceRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  sauceLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  sauceQty:   { fontSize: 15, fontWeight: '800', color: '#1565C0' },
});
