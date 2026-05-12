import React, { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native-paper';

type PaperTextInputProps = React.ComponentProps<typeof TextInput>;

interface StableTextInputProps extends Omit<PaperTextInputProps, 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (next: string) => void;
}

function StableTextInputInner({ value, onChangeText, ...rest }: StableTextInputProps): React.JSX.Element {
  const [localValue, setLocalValue] = useState(value);
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setLocalValue(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  function handleChange(next: string): void {
    setLocalValue(next);
    lastEmittedRef.current = next;
    onChangeText(next);
  }

  return <TextInput {...rest} value={localValue} onChangeText={handleChange} />;
}

const StableTextInput = React.memo(StableTextInputInner);
export default StableTextInput;
