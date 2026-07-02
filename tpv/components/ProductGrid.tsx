import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatPrice } from '../lib/utils';
import type { PriceProfile, Product } from '../lib/types';
import { useCartStore } from '../stores/useCartStore';


interface Props {
  products: Product[];
  onSelect: (product: Product) => void;
  onLongPress: (product: Product) => void;
}

// Paleta de colores para las categorías, asignada por su orden de aparición.
// Los 4 primeros coinciden con la paleta clásica burger (HAMBURGUESAS,
// ACOMPAÑANTES, BEBIDAS, OTROS) para no cambiar el aspecto actual.
const CATEGORY_PALETTE = [
  '#E53935', '#FB8C00', '#1E88E5', '#43A047',
  '#00897B', '#8E24AA', '#C2185B', '#5D4037', '#3949AB', '#F4511E',
];

interface CategoryGroup {
  label: string;   // el propio valor de `category` — es el encabezado
  order: number;   // categoryOrder (menor primero)
  color: string;
  products: Product[];
}

/**
 * Agrupa los productos activos por `category` (texto libre). El valor de
 * `category` ES el encabezado de la sección; se muestran tantas secciones como
 * categorías distintas aparezcan. Se ordenan por `categoryOrder` (menor primero)
 * y, a igualdad, por orden de aparición. El color se asigna por posición.
 */
function buildCategories(products: Product[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  let appearance = 0;
  for (const p of products) {
    if (!p.isActive) continue;
    const label = p.category;
    let group = map.get(label);
    if (!group) {
      group = { label, order: p.categoryOrder ?? appearance++, color: '', products: [] };
      map.set(label, group);
    }
    group.products.push(p);
  }
  const groups = [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  // El color se asigna tras ordenar, según la posición final de la categoría.
  groups.forEach((g, i) => { g.color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]; });
  return groups;
}

export default React.memo(function ProductGrid({ products, onSelect, onLongPress }: Props): React.JSX.Element {
  const priceProfile    = useCartStore((s) => s.priceProfile);
  const setPriceProfile = useCartStore((s) => s.setPriceProfile);
  const takeAway        = useCartStore((s) => s.takeAway);
  const toggleTakeAway  = useCartStore((s) => s.toggleTakeAway);

  const categories = buildCategories(products);

  function handleOfertaPress(profile: PriceProfile): void {
    setPriceProfile(priceProfile === profile ? 'normal' : profile);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {categories.map((category) => (
        <View key={category.label} style={styles.section}>
          <Text style={[styles.categoryLabel, { color: category.color }]}>
            {category.label}
          </Text>
          <View style={styles.grid}>
            {category.products.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                accentColor={category.color}
                onPress={() => onSelect(product)}
                onLongPress={() => onLongPress(product)}
              />
            ))}
          </View>
        </View>
      ))}

      {/* OFERTAS */}
      <View style={styles.section}>
        <Text style={[styles.categoryLabel, { color: '#7B1FA2' }]}>OFERTAS</Text>
        <View style={styles.grid}>
          <OfertaTile
            label="OFERTA FERIANTE"
            icon="tag-multiple"
            color="#1E88E5"
            active={priceProfile === 'feriante'}
            onPress={() => handleOfertaPress('feriante')}
          />
          <OfertaTile
            label="INVITACIÓN"
            icon="gift"
            color="#43A047"
            active={priceProfile === 'invitacion'}
            onPress={() => handleOfertaPress('invitacion')}
          />
          <OfertaTile
            label="PARA LLEVAR"
            icon="bag-personal"
            color="#F57C00"
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
  onPress: () => void;
  onLongPress: () => void;
}

const ProductTile = React.memo(function ProductTile({ product, accentColor, onPress, onLongPress }: TileProps): React.JSX.Element {
  return (
    <Surface style={styles.tile} elevation={2}>
      <TouchableRipple
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.tileRipple}
        borderless
        rippleColor={accentColor + '33'}
      >
        <View style={styles.tileInner}>
          {product.modifiers.length > 0 && (
            <View style={[styles.modifierDot, { backgroundColor: accentColor }]} />
          )}
          <Text style={styles.tileName} numberOfLines={2}>
            {product.name}
          </Text>
          {!product.isCustom && (
            <Text style={[styles.tilePrice, { color: accentColor }]}>
              {formatPrice(product.basePrice)}
            </Text>
          )}
          {product.isCustom && (
            <Text style={[styles.tilePriceFree, { color: accentColor }]}>precio libre</Text>
          )}
        </View>
      </TouchableRipple>
    </Surface>
  );
});

// ---------------------------------------------------------------------------

interface OfertaTileProps {
  label: string;
  icon: string;
  color: string;
  active: boolean;
  onPress: () => void;
}

function OfertaTile({ label, icon, color, active, onPress }: OfertaTileProps): React.JSX.Element {
  return (
    <Surface
      style={[
        styles.tile,
        styles.ofertaTile,
        active && { backgroundColor: color, borderColor: color },
      ]}
      elevation={active ? 4 : 2}
    >
      <TouchableRipple
        onPress={onPress}
        style={styles.tileRipple}
        borderless
        rippleColor={color + '44'}
      >
        <View style={[styles.tileInner, styles.ofertaInner]}>
          <MaterialCommunityIcons
            name={icon}
            size={28}
            color={active ? '#fff' : color}
          />
          <Text style={[styles.ofertaLabel, { color: active ? '#fff' : color }]}>
            {label}
          </Text>
          {active && (
            <Text style={styles.ofertaActiveTag}>ACTIVO</Text>
          )}
        </View>
      </TouchableRipple>
    </Surface>
  );
}

// ---------------------------------------------------------------------------

const TILE_SIZE = 150;

const styles = StyleSheet.create({
  scroll: {
    padding: 12,
    paddingBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tileRipple: {
    flex: 1,
    borderRadius: 12,
  },
  tileInner: {
    flex: 1,
    padding: 12,
    justifyContent: 'flex-end',
  },
  modifierDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
    lineHeight: 19,
  },
  tilePrice: {
    fontSize: 14,
    fontWeight: '600',
  },
  tilePriceFree: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  ofertaTile: {
    borderWidth: 2,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  ofertaInner: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  ofertaLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  ofertaActiveTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffffcc',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
