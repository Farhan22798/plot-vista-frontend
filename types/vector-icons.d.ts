declare module 'react-native-vector-icons/MaterialIcons' {
  import * as React from 'react';

  export interface MaterialIconsProps {
    name: string;
    size?: number;
    color?: string;
    style?: React.ComponentProps<'Text'>['style'];
    allowFontScaling?: boolean;
  }

  export default class MaterialIcons extends React.Component<MaterialIconsProps> {}
}
