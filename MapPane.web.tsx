import { Text, View } from 'react-native';
import type { MapPaneProps } from './MapPane.native';

// Web placeholder — react-native-maps is native-only. The real map renders on
// the phone (Expo Go). This keeps the web preview working.
export default function MapPane({ style }: MapPaneProps) {
  return (
    <View
      style={[
        { backgroundColor: '#1E222B', borderWidth: 1, borderColor: '#2A2F3A', alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Text style={{ color: '#9098A6', fontSize: 13, textAlign: 'center', paddingHorizontal: 20 }}>
        🗺️  Live map renders on the phone{'\n'}(open VOYA in Expo Go to see it)
      </Text>
    </View>
  );
}
