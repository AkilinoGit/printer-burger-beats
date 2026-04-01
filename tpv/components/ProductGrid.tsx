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

type Category = Product['category'];

const CATEGORY_ORDER: Category[] = ['burger', 'side', 'drink', 'custom'];
const CATEGORY_LABEL: Record<Category, string> = {
  burger: 'HAMBURGUESAS',
  side:   'ACOMPAÑANTES',
  drink:  'BEBIDAS',
  custom: 'OTROS',
};
const CATEGORY_COLOR: Record<Category, string> = {
  burger: '#E53935',
  side:   '#FB8C00',
  drink:  '#1E88E5',
  custom: '#43A047',
};

export default function ProductGrid({ products, onSelect, onLongPress }: Props): React.JSX.Element {
  const priceProfile  = useCartStore((s) => s.priceProfile);
  const setPriceProfile = useCartStore((s) => s.setPriceProfile);

  const byCategory = CATEGORY_ORDER.reduce<Record<Category, Product[]>>(
    (acc, cat) => {
      acc[cat] = products.filter((p) => p.category === cat && p.isActive);
      return acc;
    },
    { burger: [], side: [], drink: [], custom: [] },
  );

  function handleOfertaPress(profile: PriceProfile): void {
    setPriceProfile(priceProfile === profile ? 'normal' : profile);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {CATEGORY_ORDER.map((cat) => {
        const group = byCategory[cat];
        if (group.length === 0) return null;
        return (
          <View key={cat} style={styles.section}>
            <Text style={[styles.categoryLabel, { color: CATEGORY_COLOR[cat] }]}>
              {CATEGORY_LABEL[cat]}
            </Text>
            <View style={styles.grid}>
              {group.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  accentColor={CATEGORY_COLOR[cat]}
                  onPress={() => onSelect(product)}
                  onLongPress={() => onLongPress(product)}
                />
              ))}
            </View>
          </View>
        );
      })}

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
        </View>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

interface TileProps {
  product: Product;
  accentColor: string;
  onPress: () => void;
  onLongPress: () => void;
}

function ProductTile({ product, accentColor, onPress, onLongPress }: TileProps): React.JSX.Element {
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
}

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
