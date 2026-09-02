import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatPrice } from '../lib/utils';
import type { PriceProfile, Product } from '../lib/types';
import { buildColoredCategories } from './productGridCommon';
import { useCartStore } from '../stores/useCartStore';

/**
 * Vista COMPACTA de la carta (la alternativa a la clásica de `ProductGrid`).
 *
 * Objetivo: ver el máximo de productos sin scroll. Frente a la clásica (baldosas
 * cuadradas fijas de 150 px → 2 columnas en un móvil normal) esta calcula el nº
 * de columnas a partir del ancho real de la pantalla y usa baldosas anchas y
 * bajas, con el nombre arriba y el precio abajo, sin hueco muerto.
 *
 * El área táctil sigue siendo cómoda (~108 x 66 dp, muy por encima de los 48 dp
 * recomendados) y el comportamiento es idéntico al de la clásica: pulsar añade,
 * mantener pulsado abre los modifiers.
 */

interface Props {
  products: Product[];
  onSelect: (product: Product) => void;
  onLongPress: (product: Product) => void;
}

const H_PADDING      = 10;  // padding horizontal del scroll
const GAP            = 8;   // separación entre baldosas
const MIN_TILE_WIDTH = 100; // ancho mínimo antes de quitar una columna
const TILE_HEIGHT    = 66;

interface GridMetrics {
  columns: number;
  tileWidth: number;
}

/** Nº de columnas y ancho de baldosa para el ancho real de pantalla. */
function useGridMetrics(): GridMetrics {
  const { width } = useWindowDimensions();
  return React.useMemo(() => {
    const usable = width - H_PADDING * 2;
    // Mínimo 3 columnas: en el móvil de trabajo entran 3 holgadas donde la vista
    // clásica solo mostraba 2.
    const columns   = Math.max(3, Math.floor((usable + GAP) / (MIN_TILE_WIDTH + GAP)));
    const tileWidth = Math.floor((usable - GAP * (columns - 1)) / columns);
    return { columns, tileWidth };
  }, [width]);
}

export default React.memo(function ProductGridCompact({ products, onSelect, onLongPress }: Props): React.JSX.Element {
  const priceProfile    = useCartStore((s) => s.priceProfile);
  const setPriceProfile = useCartStore((s) => s.setPriceProfile);
  const takeAway        = useCartStore((s) => s.takeAway);
  const toggleTakeAway  = useCartStore((s) => s.toggleTakeAway);

  const { tileWidth } = useGridMetrics();
  const categories = buildColoredCategories(products);

  function handleOfertaPress(profile: PriceProfile): void {
    setPriceProfile(priceProfile === profile ? 'normal' : profile);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {categories.map((category) => (
        <View key={category.label} style={styles.section}>
          <View style={styles.categoryHeader}>
            <View style={[styles.categoryBar, { backgroundColor: category.color }]} />
            <Text style={[styles.categoryLabel, { color: category.color }]} numberOfLines={1}>
              {category.label}
            </Text>
          </View>
          <View style={styles.grid}>
            {category.products.map((product) => (
              <CompactTile
                key={product.id}
                product={product}
                accentColor={category.color}
                width={tileWidth}
                onPress={() => onSelect(product)}
                onLongPress={() => onLongPress(product)}
              />
            ))}
          </View>
        </View>
      ))}

      {/* OFERTAS */}
      <View style={styles.section}>
        <View style={styles.categoryHeader}>
          <View style={[styles.categoryBar, { backgroundColor: '#7B1FA2' }]} />
          <Text style={[styles.categoryLabel, { color: '#7B1FA2' }]}>OFERTAS</Text>
        </View>
        <View style={styles.grid}>
          <CompactOfertaTile
            label="FERIANTE"
            icon="tag-multiple"
            color="#1E88E5"
            width={tileWidth}
            active={priceProfile === 'feriante'}
            onPress={() => handleOfertaPress('feriante')}
          />
          <CompactOfertaTile
            label="INVITACIÓN"
            icon="gift"
            color="#43A047"
            width={tileWidth}
            active={priceProfile === 'invitacion'}
            onPress={() => handleOfertaPress('invitacion')}
          />
          <CompactOfertaTile
            label="PARA LLEVAR"
            icon="bag-personal"
            color="#F57C00"
            width={tileWidth}
            active={takeAway}
            onPress={toggleTakeAway}
          />
        </View>
      </View>
    </ScrollView>
  );
});

// ---------------------------------------------------------------------------

interface TileProps {
  product: Product;
  accentColor: string;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
}

const CompactTile = React.memo(function CompactTile({
  product, accentColor, width, onPress, onLongPress,
}: TileProps): React.JSX.Element {
  return (
    <Surface style={[styles.tile, { width, borderLeftColor: accentColor }]} elevation={1}>
      <TouchableRipple
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.tileRipple}
        rippleColor={accentColor + '33'}
      >
        <View style={styles.tileInner}>
          <Text style={styles.tileName} numberOfLines={2}>
            {product.name}
          </Text>
          {product.isCustom ? (
            <Text style={[styles.tilePriceFree, { color: accentColor }]} numberOfLines={1}>
              precio libre
            </Text>
          ) : (
            <Text style={[styles.tilePrice, { color: accentColor }]} numberOfLines={1}>
              {formatPrice(product.basePrice)}
            </Text>
          )}
        </View>
      </TouchableRipple>
    </Surface>
  );
});

// ---------------------------------------------------------------------------

type MaterialCommunityIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface CompactOfertaTileProps {
  label: string;
  icon: MaterialCommunityIconName;
  color: string;
  width: number;
  active: boolean;
  onPress: () => void;
}

function CompactOfertaTile({
  label, icon, color, width, active, onPress,
}: CompactOfertaTileProps): React.JSX.Element {
  const fg = active ? '#fff' : color;
  return (
    <Surface
      style={[
        styles.tile,
        styles.ofertaTile,
        { width, borderLeftColor: color },
        active && { backgroundColor: color },
      ]}
      elevation={active ? 3 : 1}
    >
      <TouchableRipple onPress={onPress} style={styles.tileRipple} rippleColor={color + '44'}>
        <View style={[styles.tileInner, styles.ofertaInner]}>
          <MaterialCommunityIcons name={icon} size={20} color={fg} />
          <Text style={[styles.ofertaLabel, { color: fg }]} numberOfLines={2}>
            {label}
          </Text>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: H_PADDING,
    paddingTop: 8,
    paddingBottom: 16,
  },
  section: {
    marginBottom: 12,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  categoryBar: {
    width: 3,
    height: 12,
    borderRadius: 2,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    height: TILE_HEIGHT,
    borderRadius: 8,
    borderLeftWidth: 4,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  tileRipple: {
    flex: 1,
  },
  tileInner: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 5,
    justifyContent: 'space-between',
  },
  tileName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 15,
  },
  tilePrice: {
    fontSize: 13,
    fontWeight: '700',
  },
  tilePriceFree: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  ofertaTile: {
    backgroundColor: '#fafafa',
  },
  ofertaInner: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  ofertaLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
    lineHeight: 12,
  },
});
